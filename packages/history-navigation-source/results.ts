import type { NavigationResult } from "../contracts/candidates/durable-navigation-v1/omp-wire.ts";
import type { HistoryNavigationSourceResult } from "../contracts/history-navigation-source.ts";
import type { NavigationOperationMetadata, NavigationScope } from "./ports.ts";

const fail = (): never => { throw Error("navigation_reply_mismatch"); };
const sameTarget = (left: NavigationResult["target"], right: NavigationResult["target"]) =>
  left.sourceId === right.sourceId && left.instanceId === right.instanceId && left.nativeSessionId === right.nativeSessionId;
const bounded = (value: string | undefined) => value !== undefined && value.length > 0 && value.length <= 256;
/** Structural validation is performed by the actual generated client before these semantic checks. */
export function validateFacts(result: NavigationResult, record: NavigationOperationMetadata): void {
  const preview = record.confirmation;
  if (!sameTarget(result.target, record.scope) || result.navigationId !== record.navigationId) fail();
  if (record.persistence === "committed" && (result.persistence !== "committed"
    || result.commitId !== record.commitId || result.actualLeafId !== record.actualLeafId
    || result.outcome !== record.outcome)) fail();
  if (!result.found) {
    if (result.admission !== "absent" || result.terminal || result.origin || result.commitId
      || result.actualLeafId !== undefined || result.editorText !== undefined || result.draftStatus !== undefined
      || result.persistence === "committed" || result.reservation === "committed"
      || !["absent", "unknown"].includes(result.outcome)
      || (result.outcome === "absent" && (result.reservation !== "absent" || result.persistence !== "unresolved"))) fail();
    if ([result.requestedTargetId, result.targetParentId, result.targetRevision, result.contextRevision,
      result.draftOriginEntryId, result.draftContentRevision, result.draftUnavailableReason,
      result.summaryEntryId, result.summaryOrigin].some(value => value !== undefined)) fail();
    return;
  }
  if (result.admission !== "local" || !result.origin || !sameTarget(result.origin, record.scope)
    || result.origin.navigationId !== record.navigationId || result.reservation !== "committed"
    || result.requestedTargetId !== preview.entryId || result.targetParentId !== preview.targetParentId
    || result.targetRevision !== preview.targetRevision || result.contextRevision !== preview.contextRevision
    || ["absent", "unknown"].includes(result.outcome)) fail();
  if (result.persistence === "committed") {
    if (!result.terminal || result.outcome === "reserved" || !bounded(result.commitId)
      || result.actualLeafId === undefined || (result.actualLeafId !== null && !bounded(result.actualLeafId))) fail();
  } else if (result.terminal || result.commitId || result.actualLeafId !== undefined) fail();
  if (result.draftStatus === "inline") {
    if (result.persistence !== "committed" || result.editorText === undefined || result.draftUnavailableReason
      || result.draftOriginEntryId !== preview.entryId || result.draftContentRevision !== preview.targetRevision
      || new TextEncoder().encode(result.editorText).byteLength > 65536) fail();
  } else if (result.editorText !== undefined || (result.draftStatus === "reference_only"
    && (!bounded(result.draftUnavailableReason) || result.draftOriginEntryId !== preview.entryId
      || result.draftContentRevision !== preview.targetRevision))) fail();
  if (result.draftStatus === undefined && [result.draftOriginEntryId, result.draftContentRevision,
    result.draftUnavailableReason].some(value => value !== undefined)) fail();
  if ((result.summaryEntryId === undefined) !== (result.summaryOrigin === undefined)) fail();
}

export function resultMetadata(record: NavigationOperationMetadata, result: NavigationResult): NavigationOperationMetadata {
  return Object.freeze({ ...record, state: result.persistence === "committed" ? "resolved"
    : record.state === "not_dispatched" && !result.found ? "not_dispatched" : "unknown",
    outcome: result.outcome, persistence: result.persistence,
    ...(result.commitId ? { commitId: result.commitId } : {}),
    ...(result.actualLeafId !== undefined ? { actualLeafId: result.actualLeafId } : {}) });
}
export function operationView(record: NavigationOperationMetadata,
  projection: "ready" | "failed" | "invalidated" | "unchanged", result?: NavigationResult): HistoryNavigationSourceResult {
  return { status: "operation", navigationId: record.navigationId,
    outcome: record.outcome ?? "unknown", persistence: record.persistence ?? "unknown", projection,
    ...(record.commitId ? { commitId: record.commitId } : {}),
    ...(record.actualLeafId !== undefined ? { actualLeafId: record.actualLeafId } : {}),
    ...(result?.code && result.code.length <= 96 && /^(?:[A-Z][A-Z0-9_]*|ask_reanswer_unsupported)$/.test(result.code)
      ? { nativeCode: result.code } : {}),
    ...(result?.draftStatus === "inline" && result.editorText !== undefined ? {
      draft: { kind: "conflict_safe_draft_offer", text: result.editorText,
        originEntryId: record.confirmation.entryId, contentRevision: record.confirmation.targetRevision,
        policy: "explicit_choice_never_overwrite_or_send", originals: "unavailable", renewOriginals: false },
    } : result?.draftStatus === "reference_only" ? { draftUnavailable: result.draftUnavailableReason ?? "unavailable" } : {}),
  };
}
/** Native identity is stable across manual worker reopen; query never grants mutation authority. */
export function sameRecoveryScope(left: NavigationScope, right: NavigationScope): boolean {
  return ["browser", "grant", "directory", "sourceId", "instanceId", "nativeSessionId", "sessionId"]
    .every(key => left[key as keyof NavigationScope] === right[key as keyof NavigationScope]);
}
