import { DraftTabOwner, DraftHostContext, DraftSourceContext, DraftNativeSessionId,
  DraftProjectionGeneration, DraftStorageKey, parseSemanticDraftRecord,
} from "@deepseek-ai/dsh-client-ui-conversation/client/semantic-draft";
import type { ConversationDraftProvider, DraftScope, SemanticDraftRecord,
  UnresolvedDraftSubmission } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { SessionBinding } from "@deepseek-ai/dsh-api-session-controller/client";

/** Trusted explicit verified selection, never browser assertions. Revoke/reacquire must use a fresh epoch. */
export interface DraftAuthority {
  readonly host: string;
  readonly browser: string;
  readonly page: string;
  readonly profile: string;
  readonly source: string;
  readonly instance: string;
  readonly session: string;
  readonly cwd: string;
  readonly draft: string;
  readonly epoch: string;
}

export interface DraftProviderOptions {
  /** Exclusive live owner acquired outside this adapter; a copied tab must acquire a different owner. */
  readonly owner: { readonly id: string; active(): boolean };
  /** Same-tab storage only. setItem must publish synchronously or throw; no localStorage fallback. */
  readonly storage: Pick<Storage, "getItem" | "setItem">;
  authority(sessionId: string): DraftAuthority | undefined;
  /** External authoritative outcome gate; absent means even a write labeled recovery cannot unlock. */
  authorizeRecovery?(scope: DraftScope, previous: UnresolvedDraftSubmission, next: SemanticDraftRecord): boolean;
  /** Already authorized/prepared public seam. Staged OriginalIntake bytes alone cannot implement this. */
  readonly prepareOriginals?: ConversationDraftProvider["prepare"];
}

/** Only the public binding fields used to map authority; also accepts a full SessionBinding. */
export type DraftBinding = Pick<SessionBinding, "sessionId" | "projection">;
const MAX_BYTES = 4 * 1024 ** 2;
const encode = (value: unknown): string => JSON.stringify(value);
const fail = (code: string): never => { throw new Error(code); };
const fingerprint = (scope: DraftScope): string => encode([scope.tabOwner, scope.hostContext, scope.sourceContext,
  scope.nativeSessionId, scope.storageKey, scope.projectionGeneration]);

function snapshotScope(scope: DraftScope): DraftScope {
  return Object.freeze({ tabOwner: scope.tabOwner, hostContext: scope.hostContext, sourceContext: scope.sourceContext,
    nativeSessionId: scope.nativeSessionId, storageKey: scope.storageKey,
    projectionGeneration: scope.projectionGeneration });
}

function stableIdentity(owner: string, a: DraftAuthority): string {
  const identity = [owner, a.host, a.browser, a.page, a.profile, a.source, a.instance, a.session, a.cwd, a.draft];
  if (identity.some(value => typeof value !== "string" || value.length === 0 || value.length > 4096)
    || typeof a.epoch !== "string" || a.epoch.length === 0 || a.epoch.length > 4096) fail("draft_scope_invalid");
  return encode(identity);
}

function decode(raw: string): SemanticDraftRecord {
  if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) fail("draft_storage_limit");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { fail("draft_storage_invalid"); }
  const record = parseSemanticDraftRecord(value) ?? fail("draft_storage_invalid");
  if (record.originals.length > 8 || (record.unresolved?.originals.length ?? 0) > 8) fail("draft_storage_limit");
  return record;
}

class ScopedDraftProvider implements ConversationDraftProvider {
  private disposed = false;
  private readonly bindings = new Map<string, DraftBinding>();
  private writes = Promise.resolve();
  constructor(private readonly options: DraftProviderOptions) {}
  scope(binding: DraftBinding): DraftScope {
    if (this.disposed || !this.options.owner.active()) fail("draft_owner_unavailable");
    const a = this.options.authority(binding.sessionId);
    if (!a || a.session !== binding.sessionId) return fail("draft_scope_unavailable");
    const identity = stableIdentity(this.options.owner.id, a);
    const projection = binding.projection.getSnapshot();
    const generation = projection.phase === "stock" ? "stock"
      : projection.phase === "ready" ? projection.binding.generation : fail("draft_projection_unavailable");
    if (projection.phase !== "stock") projection.signal.throwIfAborted();
    const presentation = projection.phase === "stock" ? ["stock"] : ["ready", projection.binding?.source];
    const result: DraftScope = Object.freeze({ tabOwner: DraftTabOwner(this.options.owner.id),
      hostContext: DraftHostContext(a.host), sourceContext: DraftSourceContext(encode([identity, a.epoch, presentation])),
      nativeSessionId: DraftNativeSessionId(a.session), storageKey: DraftStorageKey(`omp.draft.v1:${identity}`),
      projectionGeneration: DraftProjectionGeneration(generation) });
    if (!this.bindings.has(result.storageKey) && this.bindings.size >= 128) fail("draft_scope_limit");
    this.bindings.set(result.storageKey, binding);
    return result;
  }
  private current(saved: DraftScope, signal?: AbortSignal): void {
    signal?.throwIfAborted();
    const binding = this.bindings.get(saved.storageKey);
    if (!binding || fingerprint(this.scope(binding)) !== fingerprint(saved)) fail("draft_scope_changed");
    signal?.throwIfAborted();
  }
  private readSaved(saved: DraftScope): SemanticDraftRecord | undefined {
    const raw = this.options.storage.getItem(saved.storageKey);
    return raw === null ? undefined : decode(raw);
  }
  async read(scope: DraftScope, signal: AbortSignal) {
    const saved = snapshotScope(scope);
    this.current(saved, signal);
    await this.writes;
    this.current(saved, signal);
    const record = this.readSaved(saved);
    this.current(saved, signal);
    return record;
  }
  write(scope: DraftScope, record: SemanticDraftRecord,
    reason: Parameters<ConversationDraftProvider["write"]>[2], signal?: AbortSignal) {
    const saved = snapshotScope(scope);
    const encoded = encode(record);
    const parsed = decode(encoded);
    const operation = this.writes.then(() => {
      this.current(saved, signal);
      const previous = this.readSaved(saved);
      if (previous?.unresolved && (encode(previous.unresolved) !== encode(parsed.unresolved)
        || previous.unresolved.ownsDraft && encode(previous) !== encode(parsed))) {
        if (reason !== "recovery" || parsed.unresolved
          || this.options.authorizeRecovery?.(saved, previous.unresolved, structuredClone(parsed)) !== true) {
          fail("draft_submission_protected");
        }
      }
      this.current(saved, signal);
      this.options.storage.setItem(saved.storageKey, encode(parsed));
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  async prepare(scope: DraftScope, originals: Parameters<ConversationDraftProvider["prepare"]>[1],
    signal: AbortSignal) {
    const saved = snapshotScope(scope);
    this.current(saved, signal);
    if (originals.length > 8) fail("draft_storage_limit");
    if (this.readSaved(saved)?.unresolved) fail("draft_submission_protected");
    this.current(saved, signal);
    const prepared = this.options.prepareOriginals
      ? await this.options.prepareOriginals(saved, structuredClone(originals), signal)
      : originals.map(() => ({ status: "invalid" as const, reason: "draft_native_preparation_unavailable" }));
    this.current(saved, signal);
    if (this.readSaved(saved)?.unresolved) fail("draft_submission_protected");
    this.current(saved, signal);
    if (prepared.length !== originals.length || prepared.some(item => item.status === "ready"
      ? !(item.file instanceof File) : item.status !== "invalid" || !item.reason || item.reason.length > 256)) {
      fail("draft_preparation_invalid");
    }
    return prepared;
  }
  dispose() { this.disposed = true; this.bindings.clear(); }
}

/** Unregistered SOURCE provider; DSH owns atomic editor hydration and fresh runtime receipt creation. */
export function createDraftProvider(options: DraftProviderOptions) {
  return new ScopedDraftProvider(options);
}
