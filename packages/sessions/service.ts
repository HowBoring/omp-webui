import { AsyncLocalStorage } from "node:async_hooks";
import { brandString } from "@deepseek-ai/dsh-brand";
import { Remote, RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import type { BrowserAccess, BrowserAuthority } from "../access/index.ts";
import type { CatalogClient } from "../contracts/generated/catalog-client.ts";
import type { CatalogDescriptor } from "../contracts/generated/omp-wire.ts";
import { sessionPreferencesSchema, sessionViewSchema, type SessionSelectionId } from "../contracts/sessions.ts";
import type { UIAnswer } from "../contracts/interactions.ts";
import type { DirectoryGrants } from "../workspaces/grants.ts";
import type { SessionIndex } from "./index.ts";
import { nativeSettled, type SessionSupervisor, type SessionView } from "./supervisor.ts";
import type { CatalogPageInput } from "../contracts/catalog.ts";
import { sameNativeSession } from "../contracts/catalog-identity.ts";
export const sessionCaller = new AsyncLocalStorage<BrowserAccess>();
interface Options { authority: BrowserAuthority; catalog: CatalogClient; grants: DirectoryGrants; index: SessionIndex; supervisor: SessionSupervisor }
class SessionSettingsError extends RemoteError<"gateway/bad-request"> {}
const settingsFailure = (reason: "stale" | "busy" | "conflict" | "capability" | "unconfirmed" | "projection"): never => {
  const text = {
    stale: "This Session changed. Reopen it before editing model or thinking settings.",
    busy: "This Session is busy. Stop the current turn before changing its model or thinking level.",
    conflict: "Session settings changed. Read them again before saving.",
    capability: "That model or thinking level is not available in this native Session.",
    unconfirmed: "The native Session did not confirm the requested settings.",
    projection: "The native Session applied these settings, but its history could not be reopened. Reopen this Session.",
  }[reason];
  throw new SessionSettingsError("gateway/bad-request", text, {});
};
const publicView = (view: SessionView) => {
  const { reference: _reference, attemptRevision: _revision, ...registration } = view.registration;
  return sessionViewSchema.parse({ ...view, registration }); };
/** Cordis dispatches through a receiver proxy; service helpers intentionally use TypeScript privacy. */
/** All public invocations get a fresh authenticated BrowserAccess from the carrier, never browser-supplied authority. */
export class SessionsService extends TypertRemoteService {
  private readonly choices = new Map<SessionSelectionId, { descriptor: CatalogDescriptor; expires: number }>();
  private readonly settingsRevisions = new Map<string, number>();
  private readonly settingsQueue = new Map<string, Promise<unknown>>();
  constructor(ctx: Context, readonly options: Options) { super(ctx, "ompSessions"); }
  private identity(): BrowserAccess {
    const identity = sessionCaller.getStore();
    if (!identity || !this.options.authority.revalidate(identity)) throw new Error("SESSION_AUTH_REQUIRED"); return identity;
  }
  private settingsKey(view: Pick<SessionView, "workerId" | "generation">): string { return `${view.workerId}\0${view.generation}`; }
  private serial<T>(workerId: string, task: () => Promise<T>): Promise<T> {
    const prior = this.settingsQueue.get(workerId) ?? Promise.resolve();
    const next = prior.then(task, task);
    this.settingsQueue.set(workerId, next);
    void next.finally(() => { if (this.settingsQueue.get(workerId) === next) this.settingsQueue.delete(workerId); }).catch(() => {});
    return next;
  }
  private revision(view: Pick<SessionView, "workerId" | "generation">): number { return this.settingsRevisions.get(this.settingsKey(view)) ?? 0; }
  private runtime(identity: BrowserAccess, workerId: string) {
    try { return this.options.supervisor.runtime(identity, workerId); }
    catch (error) {
      if (error instanceof Error && error.message === "SESSION_MANUAL_OPEN_REQUIRED") settingsFailure("stale");
      throw error;
    }
  }
  private async snapshot(identity: BrowserAccess, workerId: string, revision?: number) {
    const runtime = this.runtime(identity, workerId);
    const state = await runtime.worker.state(); this.identity();
    const models = await runtime.worker.models(); this.identity();
    const levels = await runtime.worker.thinkingLevels(); this.identity();
    const latest = this.runtime(identity, workerId);
    if (latest.view.generation !== runtime.view.generation) settingsFailure("stale");
    const model = state.model;
    if (!model) return settingsFailure("capability");
    const seen = new Set<string>(), publicModels: { provider: string; id: string; name: string; reasoning: boolean;
      efforts: ("inherit" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max")[] }[] = [];
    const current = `${model.provider}\0${model.id}`;
    for (const candidate of [model, ...models.filter(candidate => `${candidate.provider}\0${candidate.id}` !== current)]) {
      const key = `${candidate.provider}\0${candidate.id}`;
      if (seen.has(key)) continue; seen.add(key);
      if (publicModels.length >= 64) break;
      publicModels.push({ provider: candidate.provider, id: candidate.id, name: candidate.name, reasoning: candidate.reasoning,
        efforts: (candidate.thinking?.efforts ?? []).filter(level => level !== "off" && level !== "inherit") });
    }
    const available = [...new Set(levels)];
    return sessionPreferencesSchema.parse({ workerId: runtime.view.workerId, generation: runtime.view.generation,
      revision: revision ?? this.revision(runtime.view), busy: !nativeSettled(state),
      model: { provider: model.provider, id: model.id, name: model.name },
      thinking: { level: state.thinkingLevel ?? available[0] ?? "off", levels: available.length ? available : ["off"] },
      models: publicModels });
  }
  @Remote("preferences") preferences(workerId: string) {
    const identity = this.identity();
    return this.serial(workerId, () => this.snapshot(identity, workerId));
  }
  @Remote("applyPreferences") applyPreferences(change: { workerId: string; generation: string; revision: number;
    model?: { provider: string; id: string };
    thinking?: "inherit" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" }) {
    const identity = this.identity();
    return this.serial(change.workerId, async () => {
      const runtime = this.runtime(identity, change.workerId);
      if (runtime.view.generation !== change.generation) settingsFailure("stale");
      this.identity();
      const state = await runtime.worker.state(); this.identity();
      if (!nativeSettled(state)) settingsFailure("busy");
      if (this.revision(runtime.view) !== change.revision) settingsFailure("conflict");
      const models = await runtime.worker.models(); this.identity();
      const selected = change.model
        ? models.find(model => model.provider === change.model!.provider && model.id === change.model!.id) : undefined;
      if (change.model && !selected) settingsFailure("capability");
      if (change.thinking && !change.model) {
        const levels = await runtime.worker.thinkingLevels(); this.identity();
        if (!levels.includes(change.thinking)) settingsFailure("capability");
      }
      try {
        if (selected) await runtime.worker.selectModel(selected.provider, selected.id);
        if (change.thinking) {
          if (selected) {
            const levels = await runtime.worker.thinkingLevels(); this.identity();
            if (!levels.includes(change.thinking)) settingsFailure("capability");
          }
          await runtime.worker.setThinkingLevel(change.thinking);
        }
      } catch (error) { if (error instanceof SessionSettingsError) throw error; settingsFailure("capability"); }
      this.identity();
      const latest = this.runtime(identity, change.workerId);
      if (latest.view.generation !== change.generation) settingsFailure("stale");
      const revision = change.revision + 1;
      const snapshot = await this.snapshot(identity, change.workerId, revision);
      if (selected && (snapshot.model.provider !== selected.provider || snapshot.model.id !== selected.id)) settingsFailure("unconfirmed");
      if (change.thinking && snapshot.thinking.level !== change.thinking) settingsFailure("unconfirmed");
      try {
        await this.options.supervisor.refreshPresentation(identity, latest.view.workerId,
          latest.view.registration.nativeSessionId);
      } catch { settingsFailure("projection"); }
      this.settingsRevisions.set(this.settingsKey(latest.view), revision);
      return snapshot;
    });
  }
  private selection(id: SessionSelectionId): CatalogDescriptor {
    this.identity(); const choice = this.choices.get(id);
    if (!choice) throw new Error("SESSION_SELECTION_EXPIRED");
    if (choice.expires <= Date.now()) {
      const record = this.options.index.register(choice.descriptor);
      this.options.index.observe(record.id, { state: "failed", code: "SESSION_SELECTION_EXPIRED" });
      throw new Error("SESSION_SELECTION_EXPIRED");
    }
    return choice.descriptor;
  }
  @Remote("catalog") async catalog(options: CatalogPageInput) {
    this.identity(); const page = await this.options.catalog.page({ ...(options.cursor ? { cursor: options.cursor } : {}), ...(options.pageSize ? { pageSize: options.pageSize } : {}) }); this.identity();
    for (const [id, choice] of this.choices) if (choice.expires <= Date.now()) this.choices.delete(id);
    const choices = page.items.map(descriptor => {
      let id = [...this.choices].find(([, choice]) => sameNativeSession(choice.descriptor, descriptor))?.[0];
      if (!id) { if (this.choices.size >= 1024) throw new Error("SESSION_SELECTION_LIMIT"); id = brandString<SessionSelectionId>(crypto.randomUUID()); }
      this.choices.set(id, { descriptor, expires: Date.now() + 60_000 });
      return { selectionId: id, nativeSessionId: descriptor.nativeSessionId, sourceId: descriptor.sourceId, instanceId: descriptor.instanceId,
        ...(descriptor.cwd.canonical ? { cwd: descriptor.cwd.canonical } : {}), ...(descriptor.title ? { title: descriptor.title } : {}),
        ownership: descriptor.ownership.state, directory: this.options.grants.authorize(descriptor.cwd.recorded, descriptor.cwd.canonical).status };
    });
    return { status: page.status, choices, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
  }
  @Remote("index") async index(options: CatalogPageInput) {
    this.identity(); const page = await this.options.index.page({ ...(options.cursor ? { cursor: options.cursor } : {}), ...(options.pageSize ? { pageSize: options.pageSize } : {}) }); this.identity();
    return { ...page, records: page.records.map(({ reference: _reference, attemptRevision: _revision, ...record }) => record) };
  }
  /** Native-allowlisted historical user points. Reading them never opens, mutates or branches anything. */
  @Remote("branchPoints") async branchPoints(workerId: string) {
    const identity = this.identity(), runtime = this.runtime(identity, workerId);
    const points = await runtime.worker.branchMessages(); this.identity();
    const latest = this.runtime(identity, workerId);
    if (latest.view.generation !== runtime.view.generation) settingsFailure("stale");
    return { workerId: latest.view.workerId, generation: latest.view.generation,
      points: points.slice(0, 20_000).map(point => ({ entryId: point.entryId, text: point.text })) };
  }
  /** Native branch cut. The returned text is the new Session's unsent draft, never a send. */
  @Remote("branch") async branch(change: { workerId: string; generation: string; entryId: string }) {
    const identity = this.identity();
    const result = await this.options.supervisor.branch(identity, change.workerId, change.generation, change.entryId);
    if (result.status === "cancelled") return result;
    return { ...result, ...(result.view ? { view: publicView(result.view) } : {}) };
  }
  @Remote("open") async open(selectionId: SessionSelectionId) {
    return publicView(await this.options.supervisor.open(this.identity(), this.selection(selectionId)));
  }
  @Remote("switch") async switch(selectionId: SessionSelectionId) {
    return publicView(await this.options.supervisor.switchTo(this.identity(), this.selection(selectionId)));
  }
  @Remote("new") async new(grantId: string) {
    const identity = this.identity(), grant = this.options.grants.list().find(item => item.id === grantId && item.status === "valid");
    if (!grant) throw new Error("SESSION_DIRECTORY_DENIED"); return publicView(await this.options.supervisor.create(identity, grant.path));
  }
  @Remote("view") view(workerId: string) { return publicView(this.options.supervisor.view(this.identity(), workerId)); }
  @Remote("recheck") async recheck() { return publicView(await this.options.supervisor.recheck(this.identity())); }
  @Remote("interactions") interactions() { return this.options.supervisor.interactions(this.identity()); }
  @Remote("answer") answer(generation: string, id: string, answer: UIAnswer) {
    return this.options.supervisor.answer(this.identity(), generation, id, answer);
  }
  @Remote("grants") grants() { this.identity(); return this.options.grants.list(); }
  @Remote("preview") preview(path: string) { this.identity(); return this.options.grants.preview(path); }
  @Remote("confirm") confirm(confirmation: string) { this.identity(); return this.options.grants.confirm(confirmation); }
  @Remote("revoke") async revoke(grantId: string) {
    this.identity(); this.options.grants.revoke(grantId); await this.options.supervisor.permissionsChanged(); this.identity();
    return { revoked: true as const };
  }
}
