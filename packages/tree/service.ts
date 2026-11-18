import { createHash } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService, type PeerScope } from "@deepseek-ai/dsh-typert-protocol";
import type { HistoryClient } from "../contracts/generated/history-client.ts";
import type { HistoryCut, HistoryOpen, HistoryItem, HistoryPage } from "../contracts/generated/omp-wire.ts";
import { treeRequest, type TreeRequest, type TreeResult, type TreeNode, type TreePosition } from "../contracts/tree.ts";

/** The port cannot write, open a worker, send input, read files or fetch binary content. */
export type TreeHistory = Pick<HistoryClient, "open" | "page" | "close">;
export interface TreeAccess {
  epoch: string; sourceId: string; sessionId: string; workerId: string; contextId: string; history: TreeHistory;
}
interface PageLocation { cursor: string; nextCursor: string | undefined; itemCount: number }
interface PartLocation { page: PageLocation; offset: number; textDigest: string | undefined }
interface Entry { node: TreeNode; parts: PartLocation[]; partCount: number; pageCount: number; textUnits: number }
interface Snapshot {
  owner: PeerScope; access: TreeAccess; opened: Pick<HistoryOpen, "snapshot" | "cut" | "cursor" | "count" | "expiresAt">;
  cursor: string | undefined; nodes: Map<string, Entry>; cursors: Set<string>;
  parts: number; indexBytes: number; complete: boolean;
  activePath: string[]; busy: boolean;
}
const MAX_SNAPSHOTS = 8, MAX_NODES = 20_000, MAX_PARTS = 60_000;
const MAX_INDEX_BYTES = 16 * 1024 * 1024, MAX_TOTAL_INDEX_BYTES = 32 * 1024 * 1024;
const MAX_PREVIEW_TEXT_UNITS = 2 * 1024 * 1024;
const MAX_CATALOG_REFERENCE_UNITS = 4096;
// Current Native splits at 32 Ki UTF-16 units. Even one part per page fits this reread budget.
const MAX_PREVIEW_PAGES = 64;
const PAGE_INDEX_OVERHEAD = 32, PART_INDEX_OVERHEAD = 32;
const structural = new Set(["model_usage", "thinking_level_change", "model_change", "service_tier_change", "label",
  "title_change", "ttsr_injection", "session_init", "mode_change"]);
const hidden = new Set(["custom", "credential_pin"]);
const readable = new Set(["message", "custom_message", "compaction", "branch_summary", "reset_boundary"]);
const roles = new Set(["user", "assistant", "toolResult", "custom", "hookMessage", "developer", "fileMention",
  "branchSummary", "compactionSummary", "bashExecution", "pythonExecution"]);
function fail(code: string): never { throw Error(code); }
function validToken(value: string): boolean { return value.length > 0 && value.length <= 256; }
// Native splits at UTF-16 boundaries, which can leave an unpaired surrogate in a part.
function textDigest(text: string): string { return createHash("sha256").update(text, "utf16le").digest("hex"); }
function sameNode(first: TreeNode, second: TreeNode): boolean {
  return first.id === second.id && first.parentId === second.parentId && first.kind === second.kind
    && first.active === second.active && first.contentState === second.contentState && first.role === second.role
    && first.boundary === second.boundary;
}
const fingerprint = (cut: HistoryCut): string => JSON.stringify([cut.sourceId, cut.sessionId, cut.workerId,
  cut.contextId, cut.contentRevision, cut.nativeRevision, cut.retainedRevision, cut.leafId, cut.observationSeq,
  cut.durability, cut.sourceBindingStatus, cut.catalogBinding?.sourceId, cut.catalogBinding?.instanceId,
  cut.catalogBinding?.nativeSessionId, cut.catalogBinding?.reference]);
const position = (cut: HistoryCut): TreePosition => ({ sourceId: cut.sourceId, sessionId: cut.sessionId,
  workerId: cut.workerId, contextId: cut.contextId, contentRevision: cut.contentRevision,
  retainedRevision: cut.retainedRevision, nativeRevision: cut.nativeRevision, observationSeq: cut.observationSeq,
  leafId: cut.leafId, durability: "not_attested" });

function retainedCut(cut: HistoryCut): HistoryCut {
  const { sourceId, sessionId, workerId, contextId, contentRevision, retainedRevision, leafId,
    catalogBinding, sourceBindingStatus } = cut;
  const tokens = [sourceId, sessionId, workerId, contextId, contentRevision, retainedRevision];
  if (leafId !== null) tokens.push(leafId);
  if (catalogBinding) tokens.push(catalogBinding.sourceId, catalogBinding.instanceId, catalogBinding.nativeSessionId);
  if (!tokens.every(validToken) || (catalogBinding && (!catalogBinding.reference
    || catalogBinding.reference.length > MAX_CATALOG_REFERENCE_UNITS))) fail("tree_cache_budget");
  return { ...position(cut), sourceBindingStatus, ...(catalogBinding ? { catalogBinding: {
    sourceId: catalogBinding.sourceId, instanceId: catalogBinding.instanceId,
    nativeSessionId: catalogBinding.nativeSessionId, reference: catalogBinding.reference,
  } } : {}) };
}

/** Disposable bounded read-only adapter. It is intentionally unregistered in the product Host. */
export class ReadonlyTree extends TypertRemoteService {
  private readonly snapshots = new Map<string, Snapshot>();
  private pending = 0;
  /** Callback must synchronously recheck browser, grant, exact native target, broker binding and external occupation. */
  constructor(ctx: Context, private readonly authorize: (peer: PeerScope, sessionId: string) => TreeAccess) {
    super(ctx, "ompTree");
    ctx.effect(() => async () => { await Promise.all([...this.snapshots.keys()].map(id => this.drop(id))); });
  }
  private access(sessionId: string): { owner: PeerScope; access: TreeAccess } {
    const invocation = this.ctx.invocation;
    if (!invocation || invocation.signal.aborted || invocation.peer.signal.aborted) fail("tree_authority_unavailable");
    try {
      const { epoch, sourceId, sessionId: admittedSessionId, workerId, contextId, history }
        = this.authorize(invocation.peer, sessionId);
      if (admittedSessionId !== sessionId || !validToken(epoch)) fail("tree_authority_unavailable");
      return { owner: invocation.peer, access: { epoch, sourceId, sessionId, workerId, contextId, history } };
    } catch { return fail("tree_authority_unavailable"); }
  }
  private recheck(snapshot: Snapshot): void {
    const current = this.access(snapshot.access.sessionId);
    if (current.owner !== snapshot.owner || current.access.history !== snapshot.access.history
      || ["epoch", "sourceId", "sessionId", "workerId", "contextId"].some(key =>
        current.access[key as keyof TreeAccess] !== snapshot.access[key as keyof TreeAccess])) fail("tree_binding_changed");
    if (Date.now() >= snapshot.opened.expiresAt) fail("tree_snapshot_expired");
  }
  private async drop(id: string): Promise<void> {
    const snapshot = this.snapshots.get(id);
    this.snapshots.delete(id);
    if (snapshot) await snapshot.access.history.close(snapshot.opened.snapshot).catch(() => {});
  }
  @Remote("read") async read(options: TreeRequest): Promise<TreeResult> {
    let snapshot: Snapshot | undefined;
    let acquired = false;
    try {
      treeRequest.parse(options);
      if (options.operation === "open") return await this.open(options.sessionId);
      snapshot = this.snapshots.get(options.snapshot);
      if (!snapshot) fail("tree_snapshot_unavailable");
      this.recheck(snapshot);
      if (snapshot.busy) return { status: "error", code: "tree_read_busy" };
      snapshot.busy = true; acquired = true;
      if (options.operation === "close") { await this.drop(options.snapshot); return { status: "closed" }; }
      if (options.operation === "page") return await this.page(snapshot, options.cursor);
      if (!snapshot.complete) return { status: "error", code: "tree_incomplete" };
      return await this.preview(snapshot, options.entryId);
    } catch (error) {
      if (options.operation !== "open" && snapshot?.owner === this.ctx.invocation?.peer) {
        await this.drop(options.snapshot);
      }
      const code = error instanceof Error && /^(tree_[a-z_]+|history_[a-z_]+)$/.test(error.message)
        && error.message.length <= 96 ? error.message : "tree_read_failed";
      return { status: "error", code };
    } finally { if (snapshot && acquired) snapshot.busy = false; }
  }
  private async open(sessionId: string): Promise<TreeResult> {
    const binding = this.access(sessionId);
    for (const [id, value] of this.snapshots) {
      if (value.owner.signal.aborted || Date.now() >= value.opened.expiresAt) await this.drop(id);
    }
    if (this.snapshots.size + this.pending >= MAX_SNAPSHOTS) fail("tree_snapshot_budget");
    this.pending++;
    let opened: HistoryOpen | undefined;
    try {
      opened = await binding.access.history.open("tree", "current");
      if (opened.count > MAX_PARTS) fail("tree_cache_budget");
      if (!validToken(opened.cursor)) fail("tree_invalid_page");
      const { snapshot: nativeId, cursor, count, expiresAt } = opened;
      if (!validToken(nativeId)) fail("tree_cache_budget");
      const retained = { snapshot: nativeId, cursor, cut: retainedCut(opened.cut), count, expiresAt };
      const indexBytes = Buffer.byteLength(JSON.stringify(retained)) + Buffer.byteLength(binding.access.epoch);
      const snapshot: Snapshot = { ...binding, opened: retained, cursor, nodes: new Map(), cursors: new Set(),
        parts: 0, indexBytes, complete: false, activePath: [], busy: false };
      this.recheck(snapshot);
      if (opened.scope !== "tree" || opened.handoff !== "current" || opened.cursor !== opened.cursors.tree
        || opened.cut.sourceId !== binding.access.sourceId || opened.cut.sessionId !== sessionId
        || opened.cut.workerId !== binding.access.workerId || opened.cut.contextId !== binding.access.contextId) {
        fail("tree_binding_changed");
      }
      this.checkIndexBudget(snapshot);
      const id = crypto.randomUUID(); this.snapshots.set(id, snapshot);
      return { status: "opened", snapshot: id, cursor, position: position(retained.cut), expiresAt, nativeParts: count };
    } catch (error) {
      if (opened) await binding.access.history.close(opened.snapshot).catch(() => {});
      throw error;
    } finally { this.pending--; }
  }
  private checkPage(snapshot: Snapshot, page: HistoryPage): void {
    this.recheck(snapshot);
    if (page.snapshot !== snapshot.opened.snapshot || page.scope !== "tree"
      || page.expiresAt !== snapshot.opened.expiresAt
      || fingerprint(page.cut) !== fingerprint(snapshot.opened.cut)) fail("tree_source_changed");
    if (page.items.length > 1024 || (page.nextCursor !== undefined
      && (!validToken(page.nextCursor) || page.items.length === 0))) fail("tree_invalid_page");
  }
  private async page(snapshot: Snapshot, cursor: string): Promise<TreeResult> {
    if (cursor !== snapshot.cursor || snapshot.cursors.has(cursor)) fail("tree_stale_cursor");
    const page = await snapshot.access.history.page(cursor);
    this.checkPage(snapshot, page);
    if (page.nextCursor && (page.nextCursor === cursor || snapshot.cursors.has(page.nextCursor))) {
      fail("tree_invalid_page");
    }
    snapshot.cursors.add(cursor);
    const location = { cursor, nextCursor: page.nextCursor, itemCount: page.items.length };
    snapshot.indexBytes += Buffer.byteLength(page.nextCursor ?? "") + PAGE_INDEX_OVERHEAD;
    const nodes: TreeNode[] = [];
    for (const [offset, item] of page.items.entries()) {
      const entry = this.adopt(snapshot, item, location, offset);
      if (entry.parts.length === entry.partCount) nodes.push(entry.node);
    }
    this.checkIndexBudget(snapshot);
    snapshot.cursor = page.nextCursor;
    if (!page.nextCursor) {
      if (snapshot.parts !== snapshot.opened.count || [...snapshot.nodes.values()].some(entry =>
        entry.parts.length !== entry.partCount)) fail("tree_incomplete_parts");
      snapshot.activePath = this.continuity(snapshot); snapshot.complete = true;
    }
    return { status: "page", nodes, position: position(snapshot.opened.cut),
      continuity: snapshot.complete ? "complete" : "partial", activePath: snapshot.activePath,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
  }
  private adopt(snapshot: Snapshot, item: HistoryItem, page: PageLocation, offset: number): Entry {
    const id = item.entryId ?? item.id, index = item.partIndex ?? 0, count = item.partCount ?? 1;
    if (!validToken(id) || index < 0 || count < 1 || index >= count
      || (item.parentId !== null && !validToken(item.parentId))) fail("tree_invalid_parts");
    const node = this.node(item, id), prior = snapshot.nodes.get(id);
    const entry = prior ?? { node, parts: [], partCount: count, pageCount: 0, textUnits: 0 };
    if (index !== entry.parts.length || count !== entry.partCount || !sameNode(entry.node, node)) {
      fail("tree_invalid_parts");
    }
    if (node.contentState === "readable") entry.textUnits += item.text.length;
    if (entry.parts.at(-1)?.page !== page) entry.pageCount++;
    const digest = node.contentState === "readable" && this.previewFits(entry) ? textDigest(item.text) : undefined;
    entry.parts.push({ page, offset, textDigest: digest });
    snapshot.indexBytes += PART_INDEX_OVERHEAD + (digest?.length ?? 0);
    if (!prior) {
      snapshot.nodes.set(id, entry);
      snapshot.indexBytes += Buffer.byteLength(JSON.stringify(node));
    }
    snapshot.parts++;
    return entry;
  }
  private checkIndexBudget(snapshot: Snapshot): void {
    let total = snapshot.indexBytes;
    for (const current of this.snapshots.values()) if (current !== snapshot) total += current.indexBytes;
    if (snapshot.nodes.size > MAX_NODES || snapshot.parts > MAX_PARTS || snapshot.indexBytes > MAX_INDEX_BYTES
      || total > MAX_TOTAL_INDEX_BYTES) fail("tree_cache_budget");
  }
  private previewFits(entry: Entry): boolean {
    return entry.textUnits <= MAX_PREVIEW_TEXT_UNITS && entry.pageCount <= MAX_PREVIEW_PAGES;
  }
  private async preview(snapshot: Snapshot, id: string): Promise<TreeResult> {
    const entry = snapshot.nodes.get(id);
    if (!entry) {
      const page = await snapshot.access.history.page(snapshot.opened.cursor);
      this.checkPage(snapshot, page);
      return { status: "error", code: "tree_entry_unavailable" };
    }
    if (!this.previewFits(entry)) return { status: "error", code: "tree_preview_budget" };
    const text: string[] = [];
    for (let index = 0; index < entry.parts.length;) {
      const location = entry.parts[index]!.page;
      const page = await snapshot.access.history.page(location.cursor);
      this.checkPage(snapshot, page);
      if (page.nextCursor !== location.nextCursor || page.items.length !== location.itemCount) {
        fail("tree_source_changed");
      }
      do {
        const part = entry.parts[index]!;
        const item = page.items[part.offset]!;
        if ((item.partIndex ?? 0) !== index || (item.partCount ?? 1) !== entry.partCount
          || !sameNode(entry.node, this.node(item, item.entryId ?? item.id))) fail("tree_source_changed");
        if (part.textDigest !== undefined) {
          if (textDigest(item.text) !== part.textDigest) fail("tree_source_changed");
          text.push(item.text);
        }
        index++;
      } while (entry.parts[index]?.page === location);
    }
    return { status: "preview", node: entry.node, position: position(snapshot.opened.cut),
      text: entry.node.contentState === "readable" ? text.join("") : entry.node.contentState === "hidden"
        ? "[Internal native record; content hidden]" : "[Native structural record]",
      attachments: "original_association_unproven", modelInput: "not_an_input_audit" };
  }
  private node(item: HistoryItem, id: string): TreeNode {
    if (!readable.has(item.kind) && !structural.has(item.kind) && !hidden.has(item.kind)) fail("tree_unsupported_content");
    if (item.role !== undefined && !roles.has(item.role)) fail("tree_unsupported_content");
    const expected = item.kind === "compaction" ? "compaction" : item.kind === "reset_boundary" ? "reset"
      : item.kind === "branch_summary" ? "branch" : undefined;
    if (item.boundary !== expected) fail("tree_unsupported_boundary");
    return { id, parentId: item.parentId, kind: item.kind, active: item.active,
      contentState: hidden.has(item.kind) || (item.kind === "message" && !item.role) ? "hidden"
        : structural.has(item.kind) ? "structural" : "readable",
      ...(item.role ? { role: item.role } : {}), ...(expected ? { boundary: expected } : {}) };
  }
  private continuity(snapshot: Snapshot): string[] {
    const done = new Set<string>();
    for (const id of snapshot.nodes.keys()) {
      const path = new Set<string>(); let cursor: string | null = id;
      while (cursor !== null && !done.has(cursor)) {
        if (path.has(cursor)) fail("tree_parent_cycle");
        const entry = snapshot.nodes.get(cursor);
        if (!entry) fail("tree_parent_missing");
        path.add(cursor); cursor = entry.node.parentId;
      }
      for (const entry of path) done.add(entry);
    }
    const path: string[] = []; let leaf = snapshot.opened.cut.leafId;
    while (leaf !== null) {
      const entry = snapshot.nodes.get(leaf); if (!entry) fail("tree_leaf_missing");
      path.push(leaf); leaf = entry.node.parentId;
    }
    const active = new Set(path);
    if ([...snapshot.nodes.values()].some(entry => entry.node.active !== active.has(entry.node.id))) {
      fail("tree_active_path_mismatch");
    }
    return path.reverse();
  }
}
