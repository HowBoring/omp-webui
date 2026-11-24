import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { brandString } from "@deepseek-ai/dsh-brand";
import { Remote, RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import type {
  WorkspaceArchiveSessionRequest, WorkspaceCreateRequest, WorkspaceDeleteRequest,
  WorkspaceFollowFrame, WorkspaceId, WorkspaceInsertBeforeRequest, WorkspaceInsertSessionBeforeRequest,
  WorkspacePinSessionRequest, WorkspaceRenameRequest, WorkspaceUnarchiveSessionRequest,
  WorkspaceView,
} from "@deepseek-ai/dsh-api-workspace-controller/types";
import type { BrowserAccess } from "../access/index.ts";
import { sessionCaller, type SessionsService } from "../sessions/service.ts";
import type { SessionSupervisor } from "../sessions/supervisor.ts";
import type { DirectoryGrants } from "./grants.ts";

const workspaceId = (path: string): WorkspaceId =>
  brandString<WorkspaceId>(`omp-${createHash("sha256").update(path).digest("hex").slice(0, 32)}`);
const iso = (value: number | string | undefined): string =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value)).toISOString()
    : new Date(typeof value === "number" && Number.isFinite(value) ? value : Date.now()).toISOString();

/**
 * Stock Workspace face over the external Direct Session Harness catalog and the WebUI's existing
 * directory grants: workspace ids derive from authorized directories, session grouping derives from
 * native session cwd. Title/hide/order/archive/pin edits live for this Host process only; they are
 * real replies, never fabricated native state.
 */
export class StockWorkspaceService extends TypertRemoteService {
  private readonly paths = new Map<string, string>();
  private readonly titles = new Map<string, string>();
  private readonly hidden = new Set<string>();
  private readonly extra = new Set<string>();
  private readonly order: string[] = [];
  private readonly archived = new Set<string>();
  private readonly pinned: string[] = [];
  private readonly sessionOrder = new Map<string, string[]>();
  private version = 0;
  constructor(ctx: Context, private readonly grants: DirectoryGrants, private readonly sessions: SessionsService,
    private readonly supervisor: SessionSupervisor) {
    super(ctx, "workspaceController", { namespace: "workspace" });
  }
  /** The authorized canonical path behind one stock workspace id, for `session/create`. */
  pathOf(id: string): string | undefined { return this.paths.get(id); }
  /** Wake every connected stock Workspace view after this Host changed which sessions exist. */
  changed(): void { this.version++; }
  private identity(): BrowserAccess {
    const identity = sessionCaller.getStore();
    if (!identity) throw new Error("SESSION_AUTH_REQUIRED");
    return identity;
  }
  private async roots(): Promise<Map<string, { grantedAt: string }>> {
    const roots = new Map<string, { grantedAt: string }>();
    for (const grant of this.grants.list()) {
      if (grant.status !== "valid") continue;
      roots.set(grant.path, { grantedAt: grant.grantedAt });
    }
    for (const requested of this.extra) {
      const reviewed = this.grants.authorize(requested);
      if (reviewed.status === "authorized" && reviewed.canonical) roots.set(reviewed.canonical, { grantedAt: new Date(0).toISOString() });
    }
    return roots;
  }
  private shape(path: string, grantedAt: string, ids: string[], seen: { createdAt?: string; updatedAt?: number }): WorkspaceView {
    const id = workspaceId(path);
    this.paths.set(id, path);
    const ordered = this.sessionOrder.get(id);
    const sessions = (ordered ?? []).filter(value => ids.includes(value));
    for (const value of ids) if (!sessions.includes(value)) sessions.push(value);
    return { workspaceId: id, path, title: this.titles.get(path) ?? (basename(path) || path), sessionIds: sessions.map(SessionId),
      createdAt: iso(seen.createdAt ?? grantedAt), updatedAt: iso(seen.updatedAt ?? grantedAt) };
  }
  /** Complete stock baseline: real authorized workspaces plus the native sessions grouped under them. */
  async baseline(): Promise<{ items: WorkspaceView[]; archivedSessionIds: SessionId[]; pinnedSessionIds: SessionId[] }> {
    const roots = await this.roots();
    const descriptors = await this.sessions.nativeCatalog();
    const listed = await this.supervisor.listed(this.identity()).catch(() => undefined);
    const sessions = new Map<string, { createdAt?: string; updatedAt?: number }>();
    const grouped = new Map<string, string[]>();
    const add = (cwd: string, id: string, createdAt?: string, updatedAt?: number) => {
      let container: string | undefined;
      for (const path of roots.keys()) {
        if (cwd === path || cwd.startsWith(`${path}/`)) {
          if (container === undefined || path.length > container.length) container = path;
        }
      }
      if (container === undefined) return;
      const ids = grouped.get(container) ?? [];
      if (!ids.includes(id)) ids.push(id);
      grouped.set(container, ids);
      const seen = sessions.get(container) ?? {};
      if (createdAt !== undefined && (seen.createdAt === undefined || createdAt < seen.createdAt)) seen.createdAt = createdAt;
      if (updatedAt !== undefined && (seen.updatedAt === undefined || updatedAt > seen.updatedAt)) seen.updatedAt = updatedAt;
      sessions.set(container, seen);
    };
    for (const descriptor of descriptors) {
      const canonical = descriptor.cwd.canonical;
      if (!canonical) continue;
      add(canonical, descriptor.nativeSessionId, descriptor.createdAt,
        Number.isFinite(Date.parse(descriptor.modifiedAt)) ? Date.parse(descriptor.modifiedAt) : undefined);
    }
    if (listed?.view.registration.cwd) {
      add(listed.view.registration.cwd, listed.view.registration.nativeSessionId,
        listed.view.registration.registeredAt, Date.parse(listed.view.registration.observedAt));
    }
    const items: WorkspaceView[] = [];
    for (const [path, meta] of roots) {
      if (this.hidden.has(path)) continue;
      const ids = grouped.get(path) ?? [];
      ids.sort((left, right) => {
        const leftUpdated = descriptors.find(value => value.nativeSessionId === left)?.modifiedAt ?? "";
        const rightUpdated = descriptors.find(value => value.nativeSessionId === right)?.modifiedAt ?? "";
        return rightUpdated.localeCompare(leftUpdated);
      });
      items.push(this.shape(path, meta.grantedAt, ids, sessions.get(path) ?? {}));
    }
    const rank = new Map(this.order.map((id, index) => [id, index]));
    items.sort((left, right) => (rank.get(left.workspaceId) ?? this.order.length + items.indexOf(left))
      - (rank.get(right.workspaceId) ?? this.order.length + items.indexOf(right)));
    return { items, archivedSessionIds: [...this.archived].map(SessionId), pinnedSessionIds: this.pinned.map(SessionId) };
  }
  private async viewOf(id: string): Promise<WorkspaceView> {
    const baseline = await this.baseline();
    const found = baseline.items.find(item => item.workspaceId === id);
    if (!found) throw new RemoteError("workspace/invalid-path", "This Workspace is no longer available.", { path: this.paths.get(id) ?? id });
    return found;
  }
  @Remote("create") async create(request: WorkspaceCreateRequest): Promise<{ workspace: WorkspaceView; created: boolean }> {
    const reviewed = this.grants.authorize(request.path);
    if (reviewed.status !== "authorized" || !reviewed.canonical) {
      throw new RemoteError("workspace/invalid-path", "Grant this directory to the WebUI before adding it as a Workspace.",
        { path: request.path });
    }
    const path = reviewed.canonical, id = workspaceId(path);
    const existing = (await this.baseline()).items.find(item => item.workspaceId === id);
    this.extra.add(path);
    if (this.hidden.delete(path)) this.version++;
    this.paths.set(id, path);
    return { workspace: existing ?? await this.viewOf(id), created: existing === undefined };
  }
  @Remote("initializeDefault") async initializeDefault(): Promise<{ workspace: WorkspaceView } | undefined> {
    const baseline = await this.baseline();
    return baseline.items[0] === undefined ? undefined : { workspace: baseline.items[0] };
  }
  @Remote("rename") async rename(request: WorkspaceRenameRequest): Promise<{ workspace: WorkspaceView }> {
    const path = this.paths.get(request.workspaceId);
    if (path === undefined) throw new RemoteError("workspace/name-conflict", "Unknown Workspace.", { name: request.title });
    const title = request.title.trim();
    if (title.length === 0 || title.length > 200) throw new RemoteError("workspace/name-conflict", "A title is required.", { name: request.title });
    this.titles.set(path, title); this.version++;
    return { workspace: await this.viewOf(request.workspaceId) };
  }
  @Remote("delete") async delete(request: WorkspaceDeleteRequest): Promise<{ deleted: true }> {
    const path = this.paths.get(request.workspaceId);
    if (path !== undefined) this.hidden.add(path);
    this.version++;
    return { deleted: true };
  }
  @Remote("insertBefore") async insertBefore(request: WorkspaceInsertBeforeRequest): Promise<{ workspaceIds: WorkspaceId[] }> {
    const current = (await this.baseline()).items.map(item => item.workspaceId).filter(id => id !== request.workspaceId);
    const before = request.beforeWorkspaceId === undefined ? current.length : current.indexOf(request.beforeWorkspaceId);
    current.splice(before < 0 ? current.length : before, 0, request.workspaceId);
    this.order.splice(0, this.order.length, ...current);
    this.version++;
    return { workspaceIds: current };
  }
  @Remote("insertSessionBefore") async insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<{ workspace: WorkspaceView }> {
    const workspace = await this.viewOf(request.workspaceId);
    const ids = workspace.sessionIds.map(String).filter(id => id !== request.sessionId);
    const before = request.beforeSessionId === undefined ? ids.length : ids.indexOf(request.beforeSessionId);
    if (request.beforeSessionId !== undefined && before < 0) {
      throw new RemoteError("workspace/move-invalid", "That Session is not in this Workspace.", { workspaceId: request.workspaceId,
        sessionId: request.sessionId, ...(request.beforeSessionId === undefined ? {} : { beforeSessionId: request.beforeSessionId }) });
    }
    ids.splice(before, 0, request.sessionId);
    this.sessionOrder.set(request.workspaceId, ids);
    this.version++;
    return { workspace: await this.viewOf(request.workspaceId) };
  }
  @Remote("archiveSession") async archiveSession(request: WorkspaceArchiveSessionRequest): Promise<{ archivedSessionIds: SessionId[] }> {
    const listed = await this.supervisor.listed(this.identity()).catch(() => undefined);
    if (listed?.view.registration.nativeSessionId === request.sessionId && listed.running) {
      throw new RemoteError("workspace/session-active", "Stop the running turn before archiving this Session.",
        { sessionId: SessionId(request.sessionId), activity: [] });
    }
    this.archived.add(request.sessionId); this.version++;
    return { archivedSessionIds: [...this.archived].map(SessionId) };
  }
  @Remote("unarchiveSession") unarchiveSession(request: WorkspaceUnarchiveSessionRequest): { archivedSessionIds: SessionId[] } {
    this.archived.delete(request.sessionId); this.version++;
    return { archivedSessionIds: [...this.archived].map(SessionId) };
  }
  @Remote("pinSession") pinSession(request: WorkspacePinSessionRequest): { pinnedSessionIds: SessionId[] } {
    this.pinned.splice(0, this.pinned.length, request.sessionId, ...this.pinned.filter(id => id !== request.sessionId));
    this.version++;
    return { pinnedSessionIds: this.pinned.map(SessionId) };
  }
  @Remote("unpinSession") unpinSession(request: WorkspacePinSessionRequest): { pinnedSessionIds: SessionId[] } {
    this.pinned.splice(0, this.pinned.length, ...this.pinned.filter(id => id !== request.sessionId));
    this.version++;
    return { pinnedSessionIds: this.pinned.map(SessionId) };
  }
  @Remote({ mode: "stream" }) async *follow(signal: AbortSignal): AsyncGenerator<WorkspaceFollowFrame> {
    const identity = this.identity();
    let version = this.version;
    yield { type: "baseline", value: await sessionCaller.run(identity, () => this.baseline()) };
    while (!signal.aborted) {
      await Bun.sleep(250);
      if (version === this.version) continue;
      version = this.version;
      const value = await sessionCaller.run(identity, () => this.baseline());
      yield { type: "replace", value };
    }
  }
}
