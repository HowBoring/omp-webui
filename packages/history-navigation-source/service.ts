import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService, type PeerScope } from "@deepseek-ai/dsh-typert-protocol";
import { parseProjectionBinding } from "@deepseek-ai/dsh-api-session-controller/projection";
import { historyNavigationSourceRequest, type HistoryNavigationSourceRequest,
  type HistoryNavigationSourceResult } from "../contracts/history-navigation-source.ts";
import type { NavigationPreview, NavigationResult } from "../contracts/candidates/durable-navigation-v1/omp-wire.ts";
import { stopSnapshotSchema, type StopSnapshot } from "../contracts/stop.ts";
import type { HistoryNavigationSourcePorts, NavigationAccess, NavigationScope, NavigationOperationMetadata } from "./ports.ts";
import { operationView, resultMetadata, validateFacts, sameRecoveryScope } from "./results.ts";

interface Binding { readonly owner: PeerScope; readonly access: NavigationAccess; readonly signal: AbortSignal }
interface Confirmation extends Binding {
  readonly preview: NavigationPreview; readonly expiresAt: number; readonly navigationId: string;
}
function fail(code: string): never { throw Error(code); }
const identity = (scope: NavigationScope) => JSON.stringify([scope.browser, scope.grant, scope.directory, scope.epoch,
  scope.sourceId, scope.instanceId, scope.nativeSessionId, scope.sessionId, scope.workerId, scope.workerGeneration,
  scope.contextId, scope.projection.source, scope.projection.generation]);
const sameTarget = (left: NavigationPreview["target"], right: NavigationPreview["target"]) =>
  left.sourceId === right.sourceId && left.instanceId === right.instanceId && left.nativeSessionId === right.nativeSessionId;
const stableIdentity = (scope: NavigationScope) => JSON.stringify([scope.browser, scope.grant, scope.directory,
  scope.sourceId, scope.instanceId, scope.nativeSessionId, scope.sessionId, scope.workerId, scope.workerGeneration,
  scope.epoch.split(":")[0]]);
const workerKey = (scope: NavigationScope) => JSON.stringify([
  scope.sourceId, scope.instanceId, scope.nativeSessionId, scope.workerId, scope.workerGeneration,
]);
function snapshotScope(scope: NavigationScope): NavigationScope {
  const { browser, grant, directory, epoch, sourceId, instanceId, nativeSessionId,
    sessionId, workerId, workerGeneration, contextId } = scope;
  const fields = { browser, grant, directory, epoch, sourceId, instanceId, nativeSessionId,
    sessionId, workerId, workerGeneration, contextId };
  if (Object.values(fields).some(value => typeof value !== "string" || !value || value.length > 256)) {
    fail("navigation_authority_unavailable");
  }
  return Object.freeze({ ...fields, projection: parseProjectionBinding(scope.projection) });
}

/** SOURCE-only and unavailable until all explicit trusted ports are bound. */
export class HistoryNavigationSource extends TypertRemoteService {
  private readonly confirmations = new Map<string, Confirmation>();
  private readonly subscriptions = new Map<string, () => void>();
  private readonly active = new Set<string>();
  private pending = 0;
  private disposed = false;
  constructor(ctx: Context, private readonly ports?: HistoryNavigationSourcePorts) {
    super(ctx, "ompHistoryNavigationSource");
    ctx.effect(() => () => {
      this.disposed = true;
      for (const token of this.confirmations.keys()) this.dropConfirmation(token);
    });
  }
  private now(): number { return this.ports?.now?.() ?? Date.now(); }
  private async bind(sessionId: string): Promise<Binding> {
    const invocation = this.ctx.invocation;
    if (!this.ports || this.disposed) return fail("navigation_unavailable");
    if (!invocation || invocation.signal.aborted || invocation.peer.signal.aborted) {
      return fail("navigation_authority_unavailable");
    }
    try {
      const access = await this.ports.authorize(invocation.peer, sessionId);
      const scope = snapshotScope(access.scope), policy = Object.freeze({ ...access.policy });
      const repository = this.ports.repository, projectionOwner = this.ports.projectionOwner;
      if (scope.sessionId !== sessionId || access.authoritySignal.aborted
        || typeof access.matchedCohort !== "string" || !access.matchedCohort
        || access.matchedCohort.length > 512 || policy.version !== "durable-navigation-v1"
        || policy.status !== "prototype" || policy.durability !== "process-crash-only"
        || policy.query !== "read-only-no-execution" || !Number.isSafeInteger(policy.maxOperations)
        || policy.maxOperations < 1 || !repository || !projectionOwner
        || [this.ports.idle, repository.reserveUnknown, repository.read, repository.recordResult,
          projectionOwner.invalidateAll, projectionOwner.rebuild].some(method => typeof method !== "function")) {
        return fail("navigation_unavailable");
      }
      return { owner: invocation.peer, signal: invocation.signal,
        access: Object.freeze({ scope, policy, client: access.client, authoritySignal: access.authoritySignal,
          matchedCohort: access.matchedCohort }) };
    } catch { return fail("navigation_authority_unavailable"); }
  }
  private async recheck(binding: Binding, projection = binding.access.scope.projection): Promise<void> {
    const current = await this.bind(binding.access.scope.sessionId);
    if (binding.signal.aborted || binding.owner.signal.aborted || current.owner.signal.aborted
      || binding.access.authoritySignal.aborted || current.access.authoritySignal.aborted
      || JSON.stringify(binding.owner.principal) !== JSON.stringify(current.owner.principal)
      || current.access.client !== binding.access.client || current.access.matchedCohort !== binding.access.matchedCohort
      || JSON.stringify(current.access.policy) !== JSON.stringify(binding.access.policy)
      || stableIdentity(current.access.scope) !== stableIdentity(binding.access.scope)) fail("navigation_binding_changed");
  }
  private purge(): void {
    for (const [key, value] of this.confirmations) {
      if (value.owner.signal.aborted || value.access.authoritySignal.aborted || this.now() >= value.expiresAt) this.dropConfirmation(key);
    }
  }
  private dropConfirmation(token: string): void {
    this.confirmations.delete(token);
    this.subscriptions.get(token)?.(); this.subscriptions.delete(token);
  }
  private dropWorkerConfirmations(scope: NavigationScope): void {
    for (const [token, other] of this.confirmations) {
      if (workerKey(other.access.scope) === workerKey(scope)) this.dropConfirmation(token);
    }
  }
  @Remote("action") async action(options: HistoryNavigationSourceRequest): Promise<HistoryNavigationSourceResult> {
    try {
      const request = historyNavigationSourceRequest.parse(options);
      this.purge();
      if (request.operation === "inspect") return await this.inspect(request.sessionId, request.entryId);
      if (request.operation === "query") return await this.query(request.sessionId, request.navigationId);
      const saved = this.confirmations.get(request.token);
      const invocation = this.ctx.invocation;
      if (!saved || !invocation || saved.owner !== invocation.peer) fail("navigation_confirmation_unavailable");
      this.dropConfirmation(request.token);
      const binding = { ...saved, signal: invocation.signal };
      await this.recheck(binding);
      if (request.operation === "cancel") return { status: "cancelled" };
      return await this.confirm(binding);
    } catch (error) {
      const code = error instanceof Error && /^navigation_[a-z_]+$/.test(error.message)
        ? error.message : "navigation_failed";
      return { status: "error", code };
    }
  }
  private async requireIdle(scope: NavigationScope): Promise<void> {
    let state: StopSnapshot;
    try { state = stopSnapshotSchema.parse(await this.ports?.idle(scope)); }
    catch {
      this.dropWorkerConfirmations(scope);
      return fail("navigation_stop_required_new_action");
    }
    if (state.workerGeneration !== scope.workerGeneration || state.scope.kind !== "session"
      || state.scope.sessionId !== scope.sessionId || state.status !== "idle" || !state.nativeSettled
      || !state.acceptingWork || Object.values(state.pending).some(count => count !== 0) || state.failures.length) {
      this.dropWorkerConfirmations(scope);
      fail("navigation_stop_required_new_action");
    }
  }
  private async confirm(saved: Confirmation): Promise<HistoryNavigationSourceResult> {
    const scope = saved.access.scope;
    const worker = workerKey(scope);
    if (this.active.has(worker)) fail("navigation_worker_busy_new_action");
    await this.requireIdle(scope);
    this.active.add(worker);
    const record: NavigationOperationMetadata = Object.freeze({ navigationId: saved.navigationId, scope,
      matchedCohort: saved.access.matchedCohort, confirmation: saved.preview, options: "native_defaults", state: "unknown" });
    try {
      if (!await this.ports!.repository.reserveUnknown(record, Math.min(256, saved.access.policy.maxOperations))) {
        fail("navigation_operation_unresolved");
      }
      try { await this.prepareDispatch(saved, record.navigationId); }
      catch (error) {
        await this.ports!.repository.recordResult(Object.freeze({ ...record, state: "not_dispatched" })).catch(() => {});
        throw error;
      }
      let result: NavigationResult;
      try {
        result = await saved.access.client.navigate({ navigationId: record.navigationId,
          sourceId: scope.sourceId, instanceId: scope.instanceId, nativeSessionId: scope.nativeSessionId,
          entryId: saved.preview.entryId, expectedContextRevision: saved.preview.contextRevision,
          expectedTargetRevision: saved.preview.targetRevision });
        await this.recheck(saved);
        validateFacts(result, record);
      } catch { return operationView(record, "invalidated"); }
      const facts = resultMetadata(record, result);
      try { await this.ports!.repository.recordResult(facts); }
      catch { return operationView(facts, "failed"); }
      try { await this.recheck(saved); } catch { return operationView(record, "invalidated"); }
      return await this.present(saved, facts, result);
    } finally { this.active.delete(worker); }
  }
  private async prepareDispatch(saved: Confirmation, navigationId: string): Promise<void> {
    await this.recheck(saved); await this.requireIdle(saved.access.scope);
    if (this.now() >= saved.expiresAt) fail("navigation_confirmation_expired");
    // Withdraw presentation before the first possible native effect, including a lost response.
    this.ports!.projectionOwner.invalidateAll(saved.access.scope, navigationId);
    this.dropWorkerConfirmations(saved.access.scope);
    await this.recheck(saved); await this.requireIdle(saved.access.scope);
  }
  private async query(sessionId: string, navigationId: string): Promise<HistoryNavigationSourceResult> {
    const binding = await this.bind(sessionId), worker = workerKey(binding.access.scope);
    if (this.active.has(worker)) fail("navigation_worker_busy_new_action");
    this.active.add(worker);
    try {
      const saved = await this.ports!.repository.read(navigationId);
      await this.recheck(binding);
      if (!saved || saved.navigationId !== navigationId || saved.matchedCohort !== binding.access.matchedCohort
        || !sameRecoveryScope(saved.scope, binding.access.scope)) {
        return fail("navigation_operation_unavailable");
      }
      const record: NavigationOperationMetadata = Object.freeze({ ...saved, scope: snapshotScope(saved.scope),
        confirmation: Object.freeze({ ...saved.confirmation, target: Object.freeze({ ...saved.confirmation.target }) }) });
      this.ports!.projectionOwner.invalidateAll(binding.access.scope, navigationId);
      await this.recheck(binding);
      let result: NavigationResult;
      try {
        result = await binding.access.client.query(navigationId);
        await this.recheck(binding); validateFacts(result, record);
      } catch { return operationView(record, "invalidated"); }
      const facts = resultMetadata(record, result);
      try { await this.ports!.repository.recordResult(facts); }
      catch { return operationView(facts, "failed"); }
      try { await this.recheck(binding); } catch { return operationView(record, "invalidated"); }
      return await this.present(binding, facts, result);
    } finally { this.active.delete(worker); }
  }
  private async present(binding: Binding, record: NavigationOperationMetadata,
    result: NavigationResult): Promise<HistoryNavigationSourceResult> {
    if (!result.found || result.persistence !== "committed") return operationView(record, "invalidated", result);
    try {
      const proof = await this.ports!.projectionOwner.rebuild(binding.access.scope, record.navigationId);
      const previous = parseProjectionBinding(proof.previous), current = parseProjectionBinding(proof.current);
      if (proof.navigationId !== record.navigationId || proof.sessionId !== binding.access.scope.sessionId
        || proof.publishedTo !== "all_holders" || proof.retiredWriters !== "rejected"
        || [proof.activeSnapshotId, proof.liveHandoff].some(value => typeof value !== "string" || !value || value.length > 512)
        || previous.source !== binding.access.scope.projection.source
        || previous.generation !== binding.access.scope.projection.generation || current.source !== previous.source
        || current.generation === previous.generation) fail("navigation_projection_unavailable");
      await this.recheck(binding, current);
      return operationView(record, "ready", result);
    } catch {
      try {
        const current = await this.bind(binding.access.scope.sessionId);
        await this.recheck(binding, current.access.scope.projection);
        return operationView(record, "failed", result);
      } catch { return operationView(record, "invalidated"); }
    }
  }
  private async inspect(sessionId: string, entryId: string): Promise<HistoryNavigationSourceResult> {
    const binding = await this.bind(sessionId);
    await this.requireIdle(binding.access.scope);
    if (this.confirmations.size + this.pending >= 8) fail("navigation_confirmation_budget");
    this.pending++;
    try {
      const result = await binding.access.client.inspect(entryId);
      await this.recheck(binding);
      await this.requireIdle(binding.access.scope);
      if (!sameTarget(result.target, binding.access.scope)
        || [result.targetRevision, result.contextRevision].some(value => !value || value.length > 256)
        || (result.targetParentId !== null && (!result.targetParentId || result.targetParentId.length > 256))) {
        fail("navigation_reply_mismatch");
      }
      const preview = Object.freeze({ ...result, target: Object.freeze({ ...result.target }) });
      const token = crypto.randomUUID(), navigationId = crypto.randomUUID(), expiresAt = this.now() + 30_000;
      this.confirmations.set(token, { ...binding, preview, expiresAt, navigationId });
      const revoke = () => this.dropConfirmation(token);
      for (const signal of [binding.owner.signal, binding.access.authoritySignal]) {
        signal.addEventListener("abort", revoke, { once: true });
      }
      this.subscriptions.set(token, () => {
        for (const signal of [binding.owner.signal, binding.access.authoritySignal]) signal.removeEventListener("abort", revoke);
      });
      return { status: "confirmation", token, navigationId, sessionId, entryId, targetParentId: preview.targetParentId, expiresAt,
        notice: "files_and_external_effects_are_not_rolled_back", options: "native_defaults" };
    } finally { this.pending--; }
  }
}
