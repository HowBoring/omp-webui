import { expect, test } from "bun:test";
import { DraftOriginalId, DraftSubmissionId, DraftProjectionGeneration } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { SemanticDraftRecord } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import { parseProjectionBinding, type SessionProjectionState } from "@deepseek-ai/dsh-api-session-controller/client";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { createDraftProvider } from "../../packages/drafts/provider.ts";

const record: SemanticDraftRecord = {
  draft: { text: "/saved @a @a\n> quoted", command: { token: "/saved " },
    references: [7, 10].map(offset => ({ source: "reference", ref: "same-original", label: "a",
      clipboardText: "@a", offset, length: 2 })), quotes: [{ offset: 13, length: 8, text: "quoted" }] },
  originals: [{ id: DraftOriginalId("original-b"), name: "second.txt", mediaType: "text/plain" },
    { id: DraftOriginalId("original-a"), name: "first.txt", mediaType: "text/plain" }],
};

test("same owner reopen restores complete semantics and ordered invalid originals without preparation capability", async () => {
  const saved = new Map<string, string>();
  const authority = { host: "host", browser: "browser", page: "page", profile: "profile", source: "source",
    instance: "instance", session: "native", cwd: "/canonical", draft: "draft", epoch: "epoch" };
  const options = { owner: { id: "tab", active: () => true }, authority: () => authority,
    storage: { getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value); } } };
  const binding = { sessionId: SessionId("native"), projection: createSnapshotStore<SessionProjectionState>({ phase: "stock" }) };
  const first = createDraftProvider(options);
  const scope = first.scope(binding);
  await first.write(scope, record, "edit");
  first.dispose();
  const reopened = createDraftProvider(options);
  const current = reopened.scope(binding);
  expect(await reopened.read(current, new AbortController().signal)).toEqual(record);
  expect(await reopened.prepare(current, record.originals, new AbortController().signal)).toEqual([
    { status: "invalid", reason: "draft_native_preparation_unavailable" },
    { status: "invalid", reason: "draft_native_preparation_unavailable" },
  ]);
});

function fixture() {
  const saved = new Map<string, string>();
  let authority = { host: "host", browser: "browser", page: "page", profile: "profile", source: "source",
    instance: "instance", session: "native", cwd: "/canonical", draft: "draft", epoch: "epoch" };
  let active = true;
  const projection = createSnapshotStore<SessionProjectionState>({ phase: "stock" });
  const options = { owner: { id: "tab", active: () => active }, authority: () => authority,
    storage: { getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value); } } };
  const provider = createDraftProvider(options);
  const binding = { sessionId: SessionId("native"), projection };
  return { provider, options, binding, saved, scope: provider.scope(binding),
    change: (patch: Partial<typeof authority>) => { authority = { ...authority, ...patch }; },
    release: () => { active = false; } };
}
const signal = () => new AbortController().signal;

test("queued writes keep their initiating identity when a caller mutates a copied scope", async () => {
  const unchanged = fixture(), same = { ...unchanged.scope };
  const control = unchanged.provider.write(same, record, "edit");
  Object.assign(same, unchanged.scope);
  await control;
  expect(await unchanged.provider.read(unchanged.scope, signal())).toEqual(record);

  const b = fixture(), copied = { ...b.scope };
  const pending = b.provider.write(copied, record, "edit");
  b.change({ draft: "different-draft" });
  const next = b.provider.scope(b.binding);
  Object.assign(copied, next);
  await expect(pending).rejects.toThrow("draft_scope_changed");
  expect(await b.provider.read(next, signal())).toBeUndefined();
});

test("reads cannot return another draft after caller mutation during their pending write barrier", async () => {
  const b = fixture();
  await b.provider.write(b.scope, record, "edit");
  b.change({ draft: "different-draft" });
  const next = b.provider.scope(b.binding);
  const otherRecord = { draft: { text: "other draft", references: [] }, originals: [] };
  await b.provider.write(next, otherRecord, "edit");
  b.change({ draft: "draft" });
  const copied = { ...b.provider.scope(b.binding) };
  const pending = b.provider.read(copied, signal());
  b.change({ draft: "different-draft" });
  Object.assign(copied, b.provider.scope(b.binding));
  await expect(pending).rejects.toThrow("draft_scope_changed");
  expect(await b.provider.read(next, signal())).toEqual(otherRecord);
});

test("deferred preparation cannot return initiating Files under a caller-replaced scope", async () => {
  const b = fixture();
  const deferred = Promise.withResolvers<readonly [{ readonly status: "ready"; readonly file: File }]>();
  // Synthetic provider result only; no Native preparation is performed.
  const file = new File(["draft A fixture bytes"], "draft-a.txt");
  const provider = createDraftProvider({ ...b.options, prepareOriginals: () => deferred.promise });
  const copied = { ...provider.scope(b.binding) };
  const pending = provider.prepare(copied, record.originals.slice(0, 1), signal());
  b.change({ draft: "different-draft" });
  Object.assign(copied, provider.scope(b.binding));
  deferred.resolve([{ status: "ready", file }]);
  await expect(pending).rejects.toThrow("draft_scope_changed");

  const same = { ...copied };
  const control = provider.prepare(same, record.originals.slice(0, 1), signal());
  Object.assign(same, copied);
  expect(await control).toEqual([{ status: "ready", file }]);
});

test("every trusted stable identity isolates semantic storage while an epoch replacement fences the old scope", async () => {
  for (const key of ["host", "browser", "page", "profile", "source", "instance", "cwd", "draft"] as const) {
    const b = fixture();
    await b.provider.write(b.scope, record, "edit");
    b.change({ [key]: "different" });
    const next = b.provider.scope(b.binding);
    expect(await b.provider.read(next, signal())).toBeUndefined();
    await expect(b.provider.read(b.scope, signal())).rejects.toThrow("draft_scope_changed");
  }
  const b = fixture();
  await b.provider.write(b.scope, record, "edit");
  b.change({ epoch: "replacement Host authority" });
  const next = b.provider.scope(b.binding);
  expect(next.storageKey).toBe(b.scope.storageKey);
  expect(await b.provider.read(next, signal())).toEqual(record);
  await expect(b.provider.read(b.scope, signal())).rejects.toThrow("draft_scope_changed");
});

test("queued publication rechecks cancellation, disposal and owner loss and cannot poison a later write", async () => {
  for (const invalidate of ["cancel", "dispose", "owner", "epoch", "projection"] as const) {
    const b = fixture(), cancel = new AbortController();
    const pending = b.provider.write(b.scope, record, "edit", cancel.signal);
    if (invalidate === "cancel") cancel.abort();
    if (invalidate === "dispose") b.provider.dispose();
    if (invalidate === "owner") b.release();
    if (invalidate === "epoch") b.change({ epoch: "replacement" });
    if (invalidate === "projection") b.binding.projection.set({ phase: "rebuilding", signal: signal() });
    await expect(pending).rejects.toThrow();
    expect(b.saved.size).toBe(0);
  }
  const b = fixture(), canceled = new AbortController();
  canceled.abort();
  const rejected = b.provider.write(b.scope, record, "edit", canceled.signal);
  const next = b.provider.write(b.scope, { draft: { text: "newest", references: [] }, originals: [] }, "edit");
  await expect(rejected).rejects.toThrow();
  await next;
  expect((await b.provider.read(b.scope, signal()))?.draft.text).toBe("newest");
});

test("frozen unknown cannot be changed by edit, hydration, projection, submission or an unauthoritative recovery", async () => {
  const b = fixture();
  const frozen = { ...record, unresolved: { id: DraftSubmissionId("local-attempt"), ownsDraft: true,
    draft: record.draft, originals: record.originals } };
  await b.provider.write(b.scope, frozen, "submission");
  for (const reason of ["edit", "hydrate", "projection", "submission", "recovery"] as const) {
    await expect(b.provider.write(b.scope, record, reason)).rejects.toThrow("draft_submission_protected");
  }
  expect(await b.provider.read(b.scope, signal())).toEqual(frozen);
});

test("bounded public parsing rejects runtime receipts and corrupt storage without replacing saved semantics", async () => {
  const b = fixture();
  await b.provider.write(b.scope, record, "edit");
  const invalid = { ...record, receipt: "old-runtime-id", url: "blob:obsolete" };
  expect(() => b.provider.write(b.scope, invalid, "edit")).toThrow("draft_storage_invalid");
  expect(await b.provider.read(b.scope, signal())).toEqual(record);
  b.saved.set(b.scope.storageKey, "{");
  await expect(b.provider.read(b.scope, signal())).rejects.toThrow("draft_storage_invalid");
  b.saved.set(b.scope.storageKey, " ".repeat(4 * 1024 ** 2 + 1));
  await expect(b.provider.read(b.scope, signal())).rejects.toThrow("draft_storage_limit");
});

test("an unresolved attempt protects its exact snapshot while ownsDraft false permits a separate newer draft", async () => {
  const b = fixture();
  const unresolved = { id: DraftSubmissionId("local-attempt"), ownsDraft: false, draft: record.draft, originals: record.originals };
  await b.provider.write(b.scope, { ...record, unresolved }, "submission");
  const newer = { draft: { text: "separate newer draft", references: [] }, originals: [], unresolved };
  await b.provider.write(b.scope, newer, "edit");
  expect(await b.provider.read(b.scope, signal())).toEqual(newer);
  await expect(b.provider.write(b.scope, { ...newer, unresolved: { ...unresolved, id: DraftSubmissionId("other") } }, "edit"))
    .rejects.toThrow("draft_submission_protected");
});

test("only a supplied exact recovery authority can resolve a marker, preserving an independent newer draft", async () => {
  const b = fixture();
  const unresolved = { id: DraftSubmissionId("local-attempt"), ownsDraft: false, draft: record.draft, originals: record.originals };
  const newer = { draft: { text: "keep independent text", references: [] }, originals: [], unresolved };
  await b.provider.write(b.scope, newer, "submission");
  const recovered = createDraftProvider({ ...b.options,
    authorizeRecovery: (_scope, saved, next) => saved.id === "local-attempt" && next.draft.text === "keep independent text" });
  const scope = recovered.scope(b.binding);
  await recovered.write(scope, { draft: newer.draft, originals: [] }, "recovery");
  expect(await recovered.read(scope, signal())).toEqual({ draft: newer.draft, originals: [] });
});

test("synthetic authorized File resolution preserves ref order and rechecks authority after deferred preparation", async () => {
  const b = fixture();
  const pending = Promise.withResolvers<readonly [{ readonly status: "ready"; readonly file: File },
    { readonly status: "invalid"; readonly reason: string }]>();
  // Synthetic accepted-provider seam only: this File is not Native preparation evidence.
  const authorizedFile = new File(["fixture bytes"], "second.txt", { type: "text/plain" });
  const provider = createDraftProvider({ ...b.options, prepareOriginals: async (_scope, refs) => {
    expect(refs.map(ref => String(ref.id))).toEqual(["original-b", "original-a"]);
    return pending.promise;
  } });
  const scope = provider.scope(b.binding);
  const prepared = provider.prepare(scope, record.originals, signal());
  pending.resolve([{ status: "ready", file: authorizedFile }, { status: "invalid", reason: "original_deleted" }]);
  expect(await prepared).toEqual([{ status: "ready", file: authorizedFile },
    { status: "invalid", reason: "original_deleted" }]);
  const late = Promise.withResolvers<readonly [{ readonly status: "ready"; readonly file: File }]>();
  const stale = createDraftProvider({ ...b.options, prepareOriginals: () => late.promise });
  const old = stale.scope(b.binding);
  const result = stale.prepare(old, record.originals.slice(0, 1), signal());
  b.change({ epoch: "revoked epoch" });
  late.resolve([{ status: "ready", file: authorizedFile }]);
  await expect(result).rejects.toThrow("draft_scope_changed");
});


test("accepts the public DSH copied scope and exact ready projection generation without persisting either generation", async () => {
  const b = fixture();
  // DSH's public hydration contract copies the scope and uses the public projection generation.
  const copied = { ...b.scope };
  await b.provider.write(copied, record, "hydrate");
  const lifecycle = new AbortController();
  b.binding.projection.set({ phase: "ready", binding: parseProjectionBinding({ source: "cut-a", generation: "g1" }),
    signal: lifecycle.signal });
  const ready = b.provider.scope(b.binding);
  const dshScope = { ...ready, projectionGeneration: DraftProjectionGeneration("g1") };
  expect(dshScope.storageKey).toBe(copied.storageKey);
  expect(await b.provider.read(dshScope, signal())).toEqual(record);
  b.binding.projection.set({ phase: "ready", binding: parseProjectionBinding({ source: "cut-b", generation: "g1" }),
    signal: lifecycle.signal });
  await expect(b.provider.read(dshScope, signal())).rejects.toThrow("draft_scope_changed");
});

test("late original resolution is rejected after cancellation, disposal, owner loss or projection invalidation", async () => {
  for (const invalidation of ["cancel", "dispose", "owner", "projection"] as const) {
    const b = fixture(), deferred = Promise.withResolvers<readonly [{ readonly status: "ready"; readonly file: File }]>();
    const provider = createDraftProvider({ ...b.options, prepareOriginals: () => deferred.promise });
    const scope = provider.scope(b.binding), cancel = new AbortController();
    const pending = provider.prepare(scope, record.originals.slice(0, 1), cancel.signal);
    if (invalidation === "cancel") cancel.abort();
    if (invalidation === "dispose") provider.dispose();
    if (invalidation === "owner") b.release();
    if (invalidation === "projection") b.binding.projection.set({ phase: "rebuilding", signal: signal() });
    deferred.resolve([{ status: "ready", file: new File(["synthetic"], "fixture.txt") }]);
    await expect(pending).rejects.toThrow();
  }
});

test("a synthetic resolver rechecks expiry on reopen; edit, hydrate and projection never cache or renew readiness", async () => {
  const b = fixture(), day = 24 * 60 * 60 * 1000;
  let now = day - 1;
  // Fixture-only expiry authority. No Host retention/acknowledgement service is claimed.
  const prepareOriginals = async () => record.originals.map(() => now < day
    ? { status: "ready" as const, file: new File(["authorized fixture"], "fixture.txt") }
    : { status: "invalid" as const, reason: "original_expired" });
  const provider = createDraftProvider({ ...b.options, prepareOriginals });
  let scope = provider.scope(b.binding);
  expect((await provider.prepare(scope, record.originals, signal()))[0]?.status).toBe("ready");
  await provider.write(scope, record, "edit");
  provider.dispose();
  now = day;
  const reopened = createDraftProvider({ ...b.options, prepareOriginals });
  scope = reopened.scope(b.binding);
  for (const reason of ["hydrate", "projection", "edit", "recovery"] as const) {
    await reopened.write(scope, record, reason);
    expect(await reopened.prepare(scope, record.originals, signal())).toEqual([
      { status: "invalid", reason: "original_expired" }, { status: "invalid", reason: "original_expired" },
    ]);
  }
  expect(await reopened.read(scope, signal())).toEqual(record);
});

test("storage failure rejects checkpoints and frozen quarantine never requests original preparation", async () => {
  const b = fixture();
  const unavailable = createDraftProvider({ ...b.options,
    storage: { getItem: () => null, setItem: () => { throw new Error("storage unavailable"); } } });
  await expect(unavailable.write(unavailable.scope(b.binding), record, "submission")).rejects.toThrow("storage unavailable");
  const frozen = { ...record, unresolved: { id: DraftSubmissionId("attempt"), ownsDraft: true,
    draft: record.draft, originals: record.originals } };
  await b.provider.write(b.scope, frozen, "submission");
  const guarded = createDraftProvider({ ...b.options,
    prepareOriginals: () => { throw new Error("quarantine must not resolve originals"); } });
  await expect(guarded.prepare(guarded.scope(b.binding), record.originals, signal()))
    .rejects.toThrow("draft_submission_protected");
  expect(await guarded.read(guarded.scope(b.binding), signal())).toEqual(frozen);
});

test("copied storage has no authority under another tab owner or Session and unavailable ownership fails closed", async () => {
  const b = fixture();
  await b.provider.write(b.scope, record, "edit");
  const other = createDraftProvider({ ...b.options, owner: { id: "independent-tab", active: () => true } });
  expect(await other.read(other.scope(b.binding), signal())).toBeUndefined();
  b.change({ session: "different-native" });
  const next = b.provider.scope({ ...b.binding, sessionId: SessionId("different-native") });
  expect(await b.provider.read(next, signal())).toBeUndefined();
  await expect(b.provider.read(b.scope, signal())).rejects.toThrow("draft_scope_unavailable");
  const unavailable = createDraftProvider({ ...b.options, owner: { id: "copied-owner", active: () => false } });
  expect(() => unavailable.scope(b.binding)).toThrow("draft_owner_unavailable");
});

test("original count is bounded and invalid resolver cardinality cannot publish a partial ready result", async () => {
  const b = fixture(), nine = Array.from({ length: 9 }, () => record.originals).flat().slice(0, 9);
  expect(() => b.provider.write(b.scope, { ...record, originals: nine }, "edit")).toThrow("draft_storage_limit");
  await expect(b.provider.prepare(b.scope, nine, signal())).rejects.toThrow("draft_storage_limit");
  const partial = createDraftProvider({ ...b.options, prepareOriginals: async () => [] });
  await expect(partial.prepare(partial.scope(b.binding), record.originals, signal())).rejects.toThrow("draft_preparation_invalid");
});
