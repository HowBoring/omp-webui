import { AsyncLocalStorage } from "node:async_hooks";
import { brandString } from "@deepseek-ai/dsh-brand";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import type { BrowserAccess, BrowserAuthority } from "../access/index.ts";
import type { CatalogClient } from "../contracts/generated/catalog-client.ts";
import type { CatalogDescriptor } from "../contracts/generated/omp-wire.ts";
import { sessionViewSchema, type SessionSelectionId } from "../contracts/sessions.ts";
import type { UIAnswer } from "../contracts/interactions.ts";
import type { DirectoryGrants } from "../workspaces/grants.ts";
import type { SessionIndex } from "./index.ts";
import type { SessionSupervisor, SessionView } from "./supervisor.ts";
import type { CatalogPageInput } from "../contracts/catalog.ts";
export const sessionCaller = new AsyncLocalStorage<BrowserAccess>();
interface Options { authority: BrowserAuthority; catalog: CatalogClient; grants: DirectoryGrants; index: SessionIndex; supervisor: SessionSupervisor }
const publicView = (view: SessionView) => { const { reference: _reference, ...registration } = view.registration;
  return sessionViewSchema.parse({ ...view, registration }); };
/** Cordis dispatches through a receiver proxy; service helpers intentionally use TypeScript privacy. */
/** All public invocations get a fresh authenticated BrowserAccess from the carrier, never browser-supplied authority. */
export class SessionsService extends TypertRemoteService {
  private readonly choices = new Map<SessionSelectionId, { descriptor: CatalogDescriptor; expires: number }>();
  constructor(ctx: Context, readonly options: Options) { super(ctx, "ompSessions"); }
  private identity(): BrowserAccess {
    const identity = sessionCaller.getStore();
    if (!identity || !this.options.authority.revalidate(identity)) throw new Error("SESSION_AUTH_REQUIRED"); return identity;
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
      let id = [...this.choices].find(([, choice]) => choice.descriptor.sourceId === descriptor.sourceId
        && choice.descriptor.instanceId === descriptor.instanceId && choice.descriptor.nativeSessionId === descriptor.nativeSessionId)?.[0];
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
    return { ...page, records: page.records.map(({ reference: _reference, ...record }) => record) };
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
