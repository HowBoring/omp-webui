import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService, type PeerScope } from "@deepseek-ai/dsh-typert-protocol";
import type { HistoryClient } from "../contracts/generated/history-client.ts";
import type { HistoryCut, HistoryOpen, HistoryItem } from "../contracts/generated/omp-wire.ts";
import { treeRequest, type TreeRequest, type TreeResult, type TreeNode, type TreePosition } from "../contracts/tree.ts";

/** The port cannot write, open a worker, send input, read files or fetch binary content. */
export type TreeHistory = Pick<HistoryClient, "open" | "page" | "close">;
export interface TreeAccess {
  epoch: string; sourceId: string; sessionId: string; workerId: string; contextId: string; history: TreeHistory;
}
interface Entry { node: TreeNode; text: string; partIndex: number; partCount: number }
interface Snapshot {
  owner: PeerScope; access: TreeAccess; opened: HistoryOpen; cursor: string | undefined;
  nodes: Map<string, Entry>; cursors: Set<string>; parts: number; bytes: number; complete: boolean;
  activePath: string[]; busy: boolean;
}
const MAX_SNAPSHOTS = 8, MAX_NODES = 20_000, MAX_BYTES = 16 * 1024 * 1024, MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const structural = new Set(["model_usage", "thinking_level_change", "model_change", "service_tier_change", "label",
  "title_change", "ttsr_injection", "session_init", "mode_change"]);
const hidden = new Set(["custom", "credential_pin"]);
const readable = new Set(["message", "custom_message", "compaction", "branch_summary", "reset_boundary"]);
const roles = new Set(["user", "assistant", "toolResult", "custom", "hookMessage", "developer", "fileMention",
  "branchSummary", "compactionSummary", "bashExecution", "pythonExecution"]);
function fail(code: string): never { throw Error(code); }
const fingerprint = (cut: HistoryCut): string => JSON.stringify([cut.sourceId, cut.sessionId, cut.workerId,
  cut.contextId, cut.contentRevision, cut.nativeRevision, cut.retainedRevision, cut.leafId, cut.observationSeq,
  cut.durability, cut.sourceBindingStatus, cut.catalogBinding?.sourceId, cut.catalogBinding?.instanceId,
  cut.catalogBinding?.nativeSessionId, cut.catalogBinding?.reference]);
const position = (cut: HistoryCut): TreePosition => ({ sourceId: cut.sourceId, sessionId: cut.sessionId,
  workerId: cut.workerId, contextId: cut.contextId, contentRevision: cut.contentRevision,
  retainedRevision: cut.retainedRevision, nativeRevision: cut.nativeRevision, observationSeq: cut.observationSeq,
  leafId: cut.leafId, durability: "not_attested" });

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
      const access = this.authorize(invocation.peer, sessionId);
      if (access.sessionId !== sessionId || !access.epoch) fail("tree_authority_unavailable");
      return { owner: invocation.peer, access: { ...access } };
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
      // Strict native cursor reread checks current source version/leaf even when selection uses cached text.
      const verified = await snapshot.access.history.page(snapshot.opened.cursor);
      this.recheck(snapshot);
      if (verified.snapshot !== snapshot.opened.snapshot || verified.scope !== "tree"
        || fingerprint(verified.cut) !== fingerprint(snapshot.opened.cut)) fail("tree_source_changed");
      const entry = snapshot.nodes.get(options.entryId);
      if (!entry) return { status: "error", code: "tree_entry_unavailable" };
      return { status: "preview", node: entry.node, position: position(snapshot.opened.cut), text: entry.text,
        attachments: "original_association_unproven", modelInput: "not_an_input_audit" };
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
      if (opened.count > 60000) fail("tree_cache_budget");
      const snapshot: Snapshot = { ...binding, opened, cursor: opened.cursor, nodes: new Map(), cursors: new Set(),
        parts: 0, bytes: 0, complete: false, activePath: [], busy: false };
      this.recheck(snapshot);
      if (opened.scope !== "tree" || opened.handoff !== "current" || opened.cursor !== opened.cursors.tree
        || opened.cut.sourceId !== binding.access.sourceId || opened.cut.sessionId !== sessionId
        || opened.cut.workerId !== binding.access.workerId || opened.cut.contextId !== binding.access.contextId) {
        fail("tree_binding_changed");
      }
      const id = crypto.randomUUID(); this.snapshots.set(id, snapshot);
      return { status: "opened", snapshot: id, cursor: opened.cursor, position: position(opened.cut),
        expiresAt: opened.expiresAt, nativeParts: opened.count };
    } catch (error) {
      if (opened) await binding.access.history.close(opened.snapshot).catch(() => {});
      throw error;
    } finally { this.pending--; }
  }
  private async page(snapshot: Snapshot, cursor: string): Promise<TreeResult> {
    if (cursor !== snapshot.cursor || snapshot.cursors.has(cursor)) fail("tree_stale_cursor");
    const page = await snapshot.access.history.page(cursor);
    this.recheck(snapshot);
    if (page.snapshot !== snapshot.opened.snapshot || page.scope !== "tree"
      || fingerprint(page.cut) !== fingerprint(snapshot.opened.cut)) fail("tree_source_changed");
    if ((page.items.length === 0 && page.nextCursor) || page.items.length > 1024 || (page.nextCursor && (page.nextCursor === cursor
      || snapshot.cursors.has(page.nextCursor)))) fail("tree_invalid_page");
    snapshot.cursors.add(cursor);
    const nodes: TreeNode[] = [];
    for (const item of page.items) {
      const entry = this.adopt(snapshot, item);
      if (entry.partIndex + 1 === entry.partCount) nodes.push(entry.node);
    }
    snapshot.cursor = page.nextCursor;
    if (!page.nextCursor) {
      if (snapshot.parts !== snapshot.opened.count || [...snapshot.nodes.values()].some(entry =>
        entry.partIndex + 1 !== entry.partCount)) fail("tree_incomplete_parts");
      snapshot.activePath = this.continuity(snapshot); snapshot.complete = true;
    }
    return { status: "page", nodes, position: position(snapshot.opened.cut),
      continuity: snapshot.complete ? "complete" : "partial", activePath: snapshot.activePath,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
  }
  private adopt(snapshot: Snapshot, item: HistoryItem): Entry {
    const id = item.entryId ?? item.id, index = item.partIndex ?? 0, count = item.partCount ?? 1;
    if (id.length > 256 || !id || index < 0 || count < 1 || index >= count) fail("tree_invalid_parts");
    const node = this.node(item, id), prior = snapshot.nodes.get(id);
    if (prior ? index !== prior.partIndex + 1 || count !== prior.partCount
      || JSON.stringify(prior.node) !== JSON.stringify(node) : index !== 0) fail("tree_invalid_parts");
    const text = node.contentState === "readable" ? item.text
      : node.contentState === "hidden" ? "[Internal native record; content hidden]" : "[Native structural record]";
    const entry = prior ?? { node, text: "", partIndex: -1, partCount: count };
    entry.text += prior && node.contentState !== "readable" ? "" : text;
    entry.partIndex = index;
    snapshot.nodes.set(id, entry); snapshot.parts++;
    snapshot.bytes += new TextEncoder().encode(JSON.stringify({ node, text })).byteLength;
    const total = [...this.snapshots.values()].reduce((sum, value) => sum + value.bytes, 0);
    if (snapshot.nodes.size > MAX_NODES || snapshot.parts > 60000 || snapshot.bytes > MAX_BYTES
      || total > MAX_TOTAL_BYTES || entry.text.length > 2 * 1024 * 1024) fail("tree_cache_budget");
    return entry;
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
