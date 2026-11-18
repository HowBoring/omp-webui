import { createHash } from "node:crypto";

interface BranchCopySource {
  sourceId: string;
  instanceId: string;
  nativeSessionId: string;
}

export interface BranchCopyCut {
  source: BranchCopySource;
  entryId: string;
  parentId: string | null;
  targetRevision: string;
  contextRevision: string;
}

export interface BranchCopyEntry {
  id: string;
  type: string;
  parentId: string | null;
  activeLeafId?: string | null;
  customType?: string;
}

/** Narrow, read-only Native SessionManager index surface. */
export interface BranchCopyIndex {
  getEntry(id: string): BranchCopyEntry | undefined;
  getLabel(id: string): string | undefined;
  getLeafId(): string | null;
}

type EncodeEntry = (entry: BranchCopyEntry) => string | undefined;

export class BranchCopyError extends Error {
  constructor(readonly code: "BRANCH_COPY_CUT_REQUIRED" | "BRANCH_COPY_INVALID_PATH" |
    "BRANCH_COPY_INVALID_ENTRY" | "BRANCH_COPY_LIMIT") {
    super(code);
    this.name = "BranchCopyError";
  }
}

const maxPathEntries = 10_000;
const maxEntryBytes = 64 * 1024 * 1024;
const maxCopyBytes = 128 * 1024 * 1024;
const maxLabelBytes = 16 * 1024;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function entryId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("\0");
}

function parentPath(cut: BranchCopyCut, index: BranchCopyIndex): BranchCopyEntry[] {
  const path: BranchCopyEntry[] = [];
  const seen = new Set([cut.entryId]);
  for (let id = cut.parentId; id !== null;) {
    if (path.length === maxPathEntries) throw new BranchCopyError("BRANCH_COPY_LIMIT");
    const entry = entryId(id) && index.getEntry(id);
    if (!entry || entry.id !== id || seen.has(id)) throw new BranchCopyError("BRANCH_COPY_INVALID_PATH");
    if (entry.type === "custom" && entry.customType?.startsWith("omp.native-control/")) {
      throw new BranchCopyError("BRANCH_COPY_INVALID_ENTRY");
    }
    path.push(entry);
    seen.add(id);
    id = entry.parentId;
  }
  return path.reverse();
}

function encodeRow(entry: BranchCopyEntry, encode: EncodeEntry) {
  let json: string | undefined;
  try {
    json = encode(entry);
  } catch {
    throw new BranchCopyError("BRANCH_COPY_INVALID_ENTRY");
  }
  if (json === undefined || json.includes("\n") || json.includes("\r")) throw new BranchCopyError("BRANCH_COPY_INVALID_ENTRY");
  if (Buffer.byteLength(json) + 1 > maxEntryBytes) throw new BranchCopyError("BRANCH_COPY_LIMIT");
  let body: unknown;
  try {
    body = JSON.parse(json);
  } catch {
    throw new BranchCopyError("BRANCH_COPY_INVALID_ENTRY");
  }
  if (!isRecord(body) || body.id !== entry.id || body.type !== entry.type || body.parentId !== entry.parentId ||
    body.activeLeafId !== entry.activeLeafId || body.customType !== entry.customType) {
    throw new BranchCopyError("BRANCH_COPY_INVALID_ENTRY");
  }
  return { json, body };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Preserve labels in the parent chain, even when their target is on a different branch. */
function retainLabelEffect(body: Record<string, unknown>, retainedIds: Set<string>, labels: Map<string, string>): boolean {
  if (body.type !== "label") return false;
  const { targetId, label } = body;
  if (!entryId(targetId) || (label != null && typeof label !== "string")) {
    throw new BranchCopyError("BRANCH_COPY_INVALID_ENTRY");
  }
  if (!label) {
    labels.delete(targetId);
    return false;
  }
  if (retainedIds.has(targetId)) {
    labels.set(targetId, label);
    return false;
  }
  // An off-cut target must never leave an effective label in the new index.
  delete body.label;
  return true;
}

function copyRow(entry: BranchCopyEntry, retainedIds: Set<string>, labels: Map<string, string>, encode: EncodeEntry) {
  const { activeLeafId } = entry;
  if (activeLeafId !== undefined && activeLeafId !== null && !entryId(activeLeafId)) {
    throw new BranchCopyError("BRANCH_COPY_INVALID_ENTRY");
  }
  const { json, body } = encodeRow(entry, encode);
  const clearedLabelEffect = retainLabelEffect(body, retainedIds, labels);
  const transformed = activeLeafId !== undefined || clearedLabelEffect;
  const sourceEntryRevision = hash(json);
  let destinationJson = json;
  if (transformed) {
    delete body.activeLeafId;
    destinationJson = JSON.stringify(body);
    if (Buffer.byteLength(destinationJson) + 1 > maxEntryBytes) throw new BranchCopyError("BRANCH_COPY_LIMIT");
  }
  return Object.freeze({
    sourceEntryId: entry.id,
    destinationEntryId: entry.id,
    relation: transformed ? "native_transformed" as const : "copied" as const,
    sourceParentId: entry.parentId,
    destinationParentId: entry.parentId,
    ...(activeLeafId === undefined ? {} : { removedActiveLeafId: activeLeafId }),
    ...(clearedLabelEffect ? { clearedLabelEffect: true as const } : {}),
    sourceEntryRevision,
    destinationEntryRevision: transformed ? hash(destinationJson) : sourceEntryRevision,
    destinationJson,
  });
}

function labelOverlay(index: BranchCopyIndex, targetId: string, copiedLabel: string | undefined, leafId: string) {
  const label = index.getLabel(targetId) || null;
  if (label === (copiedLabel ?? null)) return;
  if (label !== null && typeof label !== "string") throw new BranchCopyError("BRANCH_COPY_INVALID_ENTRY");
  if (label !== null && Buffer.byteLength(label) > maxLabelBytes) throw new BranchCopyError("BRANCH_COPY_LIMIT");
  // Native labels update the resolved map globally. Keep this metadata off the selected path.
  return Object.freeze({ targetId, label, parentId: leafId, activeLeafId: leafId });
}

function readEntries(cut: BranchCopyCut, index: BranchCopyIndex, encode: EncodeEntry) {
  const path = parentPath(cut, index);
  const retainedIds = new Set(path.map(entry => entry.id));
  const copiedLabels = new Map<string, string>();
  const entries: ReturnType<typeof copyRow>[] = [];
  const labels: NonNullable<ReturnType<typeof labelOverlay>>[] = [];
  let bytes = 0;
  for (const entry of path) {
    const row = copyRow(entry, retainedIds, copiedLabels, encode);
    bytes += Buffer.byteLength(row.destinationJson) + 1;
    if (bytes > maxCopyBytes) throw new BranchCopyError("BRANCH_COPY_LIMIT");
    entries.push(row);
  }
  if (cut.parentId !== null) {
    for (const id of retainedIds) {
      const label = labelOverlay(index, id, copiedLabels.get(id), cut.parentId);
      if (!label) continue;
      bytes += Buffer.byteLength(JSON.stringify(label)) + 1;
      if (bytes > maxCopyBytes) throw new BranchCopyError("BRANCH_COPY_LIMIT");
      labels.push(label);
    }
  }
  return { entries, labels };
}

/** Internal Native plan for an already revalidated cut. Entry bodies are private Native data. */
export function buildBranchCopyIntent(cut: BranchCopyCut, index: BranchCopyIndex, encode: EncodeEntry) {
  const sourceLeafId = index.getLeafId();
  if (sourceLeafId !== null && !entryId(sourceLeafId)) throw new BranchCopyError("BRANCH_COPY_INVALID_PATH");
  const { entries, labels } = readEntries(cut, index, encode);
  const { sourceId, instanceId, nativeSessionId } = cut.source;
  const facts = {
    version: "branch-copy-intent-v1" as const,
    source: Object.freeze({ sourceId, instanceId, nativeSessionId }),
    userEntryId: cut.entryId,
    parentId: cut.parentId,
    targetRevision: cut.targetRevision,
    contextRevision: cut.contextRevision,
    sourceLeafId,
    retainedLeafId: cut.parentId,
    labels: Object.freeze(labels),
  };
  const lineage = entries.map(({ destinationJson: _destinationJson, ...entry }) => entry);
  const copyRevision = hash(JSON.stringify({ ...facts, entries: lineage }));
  return Object.freeze({ ...facts, copyRevision, entries: Object.freeze(entries) });
}

export type BranchCopyIntent = ReturnType<typeof buildBranchCopyIntent>;
