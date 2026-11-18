import validateReceipt from "../contracts/candidates/attachment-association-v1/attachment-receipt.js";
import validateSubmission from "../contracts/candidates/attachment-association-v1/submission-result.js";
import type { AttachmentReceipt, PreparedAttachmentLink, PreparedEntryPart, SubmissionRelation, SubmissionResult,
  SubmissionTarget } from "../contracts/candidates/attachment-association-v1/omp-wire.ts";

export interface OriginalSubmissionAttempt {
  clientSubmissionId: string;
  preparationId: string;
  draftRevision: string;
  authorityGeneration: string;
}

type PreparationObject = Omit<PreparedAttachmentLink, "entryPart" | "entryPartUnavailable">;
export interface OriginalPreparation {
  receiptId: string;
  resultDigest: string;
  draftRevision: string;
  authorityGeneration: string;
  attachments: PreparationObject[];
}
export interface OriginalEntryAssociation {
  objectId: string;
  entryId: string;
  entryPart: PreparedEntryPart;
}

const nativeId = /^[A-Za-z0-9_-]{1,96}$/;
const digest = /^[a-f0-9]{64}$/;
const sameTarget = (actual: SubmissionTarget, expected: SubmissionTarget) => actual.sourceId === expected.sourceId
  && actual.instanceId === expected.instanceId && actual.nativeSessionId === expected.nativeSessionId;
const isReceipt = (value: unknown): value is AttachmentReceipt => validateReceipt(value);
const isSubmission = (value: unknown): value is SubmissionResult => validateSubmission(value);

export function originalPreparation(value: unknown, attempt: OriginalSubmissionAttempt, target: SubmissionTarget,
  draftId: string, objectIds: readonly string[]): { evidence: OriginalPreparation; expiresAt: number } | undefined {
  if (!nativeId.test(attempt.clientSubmissionId) || !isReceipt(value) || value.status !== "ready"
    || !sameTarget(value.binding, target) || value.draftId !== draftId || value.preparationId !== attempt.preparationId
    || value.draftRevision !== attempt.draftRevision || value.authorityGeneration !== attempt.authorityGeneration
    || !nativeId.test(value.receiptId) || !digest.test(value.resultDigest) || !Number.isSafeInteger(value.expiresAt)
    || value.items.length !== objectIds.length || value.items.length < 1 || value.items.length > 8) return;

  const attachments: PreparationObject[] = [];
  for (const [index, item] of value.items.entries()) {
    if (item.status !== "ready" || item.originalId !== objectIds[index] || !digest.test(item.originalSha256)
      || !digest.test(item.preparedSha256) || !nativeId.test(item.preparedId)) return;
    attachments.push({ originalId: item.originalId, originalSha256: item.originalSha256, preparedId: item.preparedId,
      preparedSha256: item.preparedSha256, representationKind: item.representation.kind });
  }
  if (new Set(objectIds).size !== objectIds.length
    || new Set(attachments.map(item => item.preparedId)).size !== attachments.length) return;
  const { receiptId, resultDigest, draftRevision, authorityGeneration, expiresAt } = value;
  return { evidence: { receiptId, resultDigest, draftRevision, authorityGeneration, attachments }, expiresAt };
}

function sameObject(left: PreparationObject, right: PreparationObject): boolean {
  return left.originalId === right.originalId && left.originalSha256 === right.originalSha256
    && left.preparedId === right.preparedId && left.preparedSha256 === right.preparedSha256
    && left.representationKind === right.representationKind;
}

function matchingPreparation(value: SubmissionResult["preparation"], saved: string): OriginalPreparation | undefined {
  if (!value || value.attachments.length > 8
    || value.attachments.some(item => item.entryPart !== undefined || item.entryPartUnavailable !== undefined)) return;
  const { receiptId, resultDigest, draftRevision, authorityGeneration } = value;
  const attachments = value.attachments.map(item => ({ originalId: item.originalId, originalSha256: item.originalSha256,
    preparedId: item.preparedId, preparedSha256: item.preparedSha256, representationKind: item.representationKind }));
  const preparation = { receiptId, resultDigest, draftRevision, authorityGeneration, attachments };
  if (JSON.stringify(preparation) === saved) return preparation;
}

const committedEntry = (relation: SubmissionRelation) => relation.status === "observed"
  && relation.persistence === "committed" && relation.availability === "retained";

/** Validates a complete first page from the trusted, already correlated public submission_query transport. */
export function originalEntryAssociations(value: unknown, target: SubmissionTarget, clientSubmissionId: string,
  savedPreparation: string): OriginalEntryAssociation[] | undefined {
  if (!isSubmission(value) || !value.found || value.duplicate || value.admission !== "local" || !value.origin
    || !sameTarget(value.target, target) || !sameTarget(value.origin, target)
    || value.clientSubmissionId !== clientSubmissionId || value.origin.clientSubmissionId !== clientSubmissionId
    || value.reservation !== "committed" || value.persistence !== "committed" || !value.terminal
    || value.inputOutcome !== "generated" || value.operationOutcome === "unknown" || value.nextOffset !== null
    || value.relations.length > 128) return;

  const expected = matchingPreparation(value.preparation, savedPreparation);
  const inputs = value.relations.filter(relation => relation.role === "input");
  if (!expected || inputs.length !== 1 || !inputs[0]?.entryId || !committedEntry(inputs[0])) return;
  return associationLinks(value.relations, expected);
}

function associationLinks(relations: SubmissionRelation[], expected: OriginalPreparation) {
  const entries = new Set<string>(), ids = new Set<string>(), parts = new Set<string>();
  const associations = new Map<string, OriginalEntryAssociation>();
  for (const relation of relations) {
    if (ids.has(relation.relationId)) return;
    ids.add(relation.relationId);
    if (relation.entryId !== undefined) {
      if (!nativeId.test(relation.entryId) || relation.relationId !== `entry:${relation.entryId}`
        || entries.has(relation.entryId)) return;
      entries.add(relation.entryId);
    }
    for (const link of relation.attachments ?? []) {
      const prepared = expected.attachments.find(item => item.originalId === link.originalId);
      const role = link.representationKind === "image" ? "input" : "prepared";
      const kind = link.representationKind === "image" ? "content" : "files";
      const { entryId } = relation, { entryPart } = link;
      if (!entryId || !prepared || !sameObject(link, prepared) || !committedEntry(relation)
        || relation.role !== role || entryPart?.kind !== kind || link.entryPartUnavailable !== undefined
        || associations.has(link.originalId)) return;
      const partKey = JSON.stringify([entryId, kind, entryPart.index]);
      if (parts.has(partKey)) return;
      parts.add(partKey);
      associations.set(link.originalId, { objectId: link.originalId, entryId,
        entryPart: { kind, index: entryPart.index } });
    }
  }
  if (associations.size !== expected.attachments.length) return;
  return expected.attachments.map(item => associations.get(item.originalId)!);
}
