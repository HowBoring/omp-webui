import type { TreeRequest, TreeResult, TreeNode, TreePosition } from "../contracts/tree.ts";
export type TreeReader = (request: TreeRequest) => Promise<TreeResult>;
type Preview = Extract<TreeResult, { status: "preview" }>;
export interface TreeView {
  phase: "idle" | "loading" | "partial" | "complete" | "blocked";
  pending: boolean; pages: TreeNode[][]; activePath: string[]; visiblePage: number;
  position?: TreePosition; selectedId?: string; preview?: Preview; error?: string; expiresAt?: number;
}
const empty = (): TreeView => ({ phase: "idle", pending: false, pages: [], activePath: [], visiblePage: 0 });

/** Public presentation controller. It never receives a write-capable Remote or a Conversation controller. */
export class TreeBrowser {
  private state = empty();
  private readonly listeners = new Set<() => void>();
  private snapshot: string | undefined;
  private cursor: string | undefined;
  private generation = 0;
  private disposed = false;
  constructor(readonly sessionId: string, private readonly read: TreeReader) {}
  readonly getSnapshot = (): TreeView => this.state;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  private publish(state: TreeView): void {
    this.state = state; for (const listener of this.listeners) listener();
  }
  private release(): void {
    const snapshot = this.snapshot; this.snapshot = undefined; this.cursor = undefined;
    if (snapshot) void this.read({ operation: "close", snapshot }).catch(() => {});
  }
  /** Authority/projection/connection owners must invalidate synchronously before rendering a new binding. */
  invalidate(code: string): void {
    this.generation++; this.release();
    this.publish({ ...empty(), phase: "blocked", error: code });
  }
  /** Release the Native snapshot without discarding the visible index; callers reopen after a write. */
  async suspend(): Promise<void> {
    this.generation++;
    const snapshot = this.snapshot; this.snapshot = undefined; this.cursor = undefined;
    if (snapshot) await this.read({ operation: "close", snapshot }).catch(() => {});
  }
  async open(): Promise<void> {
    if (this.disposed) return;
    this.generation++; this.release();
    const generation = this.generation;
    this.publish({ ...empty(), phase: "loading", pending: true });
    try {
      const result = await this.read({ operation: "open", sessionId: this.sessionId });
      if (this.disposed || generation !== this.generation) {
        if (result.status === "opened") void this.read({ operation: "close", snapshot: result.snapshot }).catch(() => {});
        return;
      }
      if (result.status !== "opened") { this.refuse(result); return; }
      this.snapshot = result.snapshot; this.cursor = result.cursor;
      this.publish({ ...empty(), phase: "partial", position: result.position, expiresAt: result.expiresAt });
      await this.nextPage();
    } catch { if (generation === this.generation && !this.disposed) this.invalidate("tree_remote_unavailable"); }
  }
  private refuse(result: TreeResult): void {
    this.invalidate(result.status === "error" ? result.code : "tree_unexpected_response");
  }
  async nextPage(): Promise<void> {
    if (this.disposed || this.state.pending || !this.snapshot || !this.cursor) return;
    const generation = this.generation, snapshot = this.snapshot, cursor = this.cursor;
    this.publish({ ...this.state, pending: true });
    try {
      const result = await this.read({ operation: "page", snapshot, cursor });
      if (generation !== this.generation || this.disposed) return;
      if (result.status !== "page") { this.refuse(result); return; }
      this.cursor = result.nextCursor;
      this.publish({ ...this.state, pending: false, phase: result.continuity === "complete" ? "complete" : "partial",
        pages: [...this.state.pages, result.nodes], visiblePage: this.state.pages.length,
        activePath: result.activePath, position: result.position });
    } catch { if (generation === this.generation && !this.disposed) this.invalidate("tree_remote_unavailable"); }
  }
  async select(entryId: string): Promise<void> {
    if (this.disposed || this.state.pending || this.state.phase !== "complete" || !this.snapshot) return;
    const generation = this.generation, snapshot = this.snapshot;
    // Clear the previous preview immediately; a slow response cannot mislabel it as the new selection.
    const { preview: _preview, error: _error, ...state } = this.state;
    this.publish({ ...state, selectedId: entryId, pending: true });
    try {
      const result = await this.read({ operation: "preview", snapshot, entryId });
      if (generation !== this.generation || this.disposed) return;
      if (result.status === "error" && result.code === "tree_preview_budget") {
        this.publish({ ...this.state, pending: false, error: result.code });
        return;
      }
      if (result.status !== "preview") { this.refuse(result); return; }
      this.publish({ ...this.state, pending: false, preview: result });
    } catch { if (generation === this.generation && !this.disposed) this.invalidate("tree_remote_unavailable"); }
  }
  showPage(index: number): void {
    if (!this.disposed && Number.isInteger(index) && index >= 0 && index < this.state.pages.length) {
      this.publish({ ...this.state, visiblePage: index });
    }
  }
  dispose(): void { this.disposed = true; this.generation++; this.release(); this.listeners.clear(); this.state = empty(); }
}
