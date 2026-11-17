/** SOURCE fixtures: real public DSH Remote/Gateway and generated client; no Native or browser runtime. */
import { expect, test } from "bun:test";
import { z } from "zod";
import { Context } from "@deepseek-ai/cordis";
import TypertRegistry from "@deepseek-ai/dsh-typert-registry";
import RemoteAccessService from "@deepseek-ai/dsh-api-remote-access";
import { TypertGatewayService } from "@deepseek-ai/dsh-api-gateway";
import { Peer, clientRequestSchema } from "@deepseek-ai/dsh-client-connection";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { historyNavigationSourceContribution, historyNavigationSourceHostContribution,
  type HistoryNavigationSourceRequest } from "../../packages/contracts/history-navigation-source.ts";
import { HistoryNavigationSource } from "../../packages/history-navigation-source/service.ts";
import type { HistoryNavigationSourcePorts, NavigationAccess, NavigationOperationMetadata,
  NavigationScope } from "../../packages/history-navigation-source/ports.ts";
import { NavigationClient, type NavigationClientCommand } from "../../packages/contracts/candidates/durable-navigation-v1/navigation-client.ts";
import { validNavigationCommand, validNavigationPreview, validNavigationResult } from "../../packages/contracts/candidates/durable-navigation-v1/validators.ts";
import type { NavigationPreview, NavigationResult } from "../../packages/contracts/candidates/durable-navigation-v1/omp-wire.ts";
import { parseProjectionBinding } from "@deepseek-ai/dsh-api-session-controller/projection";

const target = { sourceId: "source", instanceId: "instance", nativeSessionId: "native" };
const preview: NavigationPreview = { version: "durable-navigation-v1", target, entryId: "entry",
  targetParentId: "parent", contextRevision: "context-r1", targetRevision: "target-r1" };
function committed(navigationId: string, overrides: Partial<NavigationResult> = {}): NavigationResult {
  return { version: "durable-navigation-v1", navigationId, target, found: true, duplicate: false, admission: "local",
    origin: { ...target, navigationId }, outcome: "committed", reservation: "committed", persistence: "committed",
    terminal: true, requestedTargetId: "entry", targetParentId: "parent", actualLeafId: "post-hook-leaf", commitId: "commit-1",
    targetRevision: "target-r1", contextRevision: "context-r1", ...overrides };
}
async function fixture(bound = true, sharedRecords?: Map<string, NavigationOperationMetadata>) {
  const host = new Context(), client = new Context();
  await host.plugin(TypertRegistry); await host.plugin(RemoteAccessService);
  await host.plugin(TypertGatewayService, {});
  host.typert.register(historyNavigationSourceHostContribution);
  const firstPeer = new Peer(host, { principal: { kind: "owner" }, interactions: "none" });
  const peers = [firstPeer]; let peer = firstPeer;
  const commands: NavigationClientCommand[] = [];
  let now = 1000, permitted = true, idle = true, epoch = "epoch-1";
  let authority = new AbortController();
  const records = sharedRecords ?? new Map<string, NavigationOperationMetadata>();
  let nativeReply: ((command: NavigationClientCommand) => Promise<unknown>) | undefined;
  const native = new NavigationClient(async command => {
    expect(validNavigationCommand(command)).toBe(true);
    commands.push(structuredClone(command));
    if (nativeReply) return nativeReply(command);
    if (command.type === "navigation_inspect") return structuredClone({ ...preview, entryId: command.entryId });
    const result: NavigationResult = { version: "durable-navigation-v1", navigationId: command.navigationId,
      target, found: true, duplicate: command.type === "navigation_query", admission: "local",
      outcome: "committed", reservation: "committed", persistence: "committed", terminal: true,
      origin: { ...target, navigationId: command.navigationId }, requestedTargetId: "entry",
      targetParentId: "parent", actualLeafId: "post-hook-leaf", commitId: "commit-1",
      targetRevision: "target-r1", contextRevision: "context-r1" };
    return result;
  }, validNavigationResult, validNavigationPreview);
  const sharedScope = { ...target, sessionId: "session", browser: "browser", grant: "grant",
    directory: "directory-identity", epoch, workerId: "worker", workerGeneration: "worker-g1", contextId: "context",
    projection: parseProjectionBinding({ source: "projection-source", generation: "projection-1" }) } satisfies NavigationScope;
  const access: NavigationAccess = { scope: sharedScope, client: native, authoritySignal: authority.signal,
    matchedCohort: "SYNTHETIC_SOURCE_FIXTURE",
    policy: { version: "durable-navigation-v1", status: "prototype", durability: "process-crash-only",
      query: "read-only-no-execution", maxOperations: 256 } };
  const invalidated: string[] = [];
  let generation = 1;
  const ports: HistoryNavigationSourcePorts = {
    authorize(_peer, sessionId) {
      if (!permitted || sessionId !== "session") throw Error("SYNTHETIC_DENIAL");
      return { ...access, authoritySignal: authority.signal, scope: { ...sharedScope, epoch } };
    },
    idle: () => ({ generation: "stop-g1", workerGeneration: "worker-g1", scope: { kind: "session", sessionId: "session" },
      status: idle ? "idle" : "stopping", nativeSettled: idle, acceptingWork: idle,
      pending: { interactions: 0, history: 0, queued: 0, other: 0 }, failures: [], forceAvailable: false,
      restored: null, draftConflict: false }),
    repository: {
      async reserveUnknown(record, maxOperations) {
        if (records.size >= maxOperations || records.has(record.navigationId) || [...records.values()].some(value =>
          value.scope.sourceId === record.scope.sourceId && value.scope.instanceId === record.scope.instanceId
          && value.scope.nativeSessionId === record.scope.nativeSessionId && value.state === "unknown")) return false;
        records.set(record.navigationId, structuredClone(record)); return true;
      },
      async read(id) { return structuredClone(records.get(id)); },
      async recordResult(record) { records.set(record.navigationId, structuredClone(record)); },
    },
    projectionOwner: {
      invalidateAll(_scope, navigationId) { invalidated.push(navigationId); },
      async rebuild(scope, navigationId) {
        sharedScope.projection = parseProjectionBinding({ source: scope.projection.source, generation: `projection-${++generation}` });
        return { navigationId, sessionId: scope.sessionId, previous: scope.projection, current: sharedScope.projection,
        activeSnapshotId: "snapshot-2", liveHandoff: "live-cut-2", publishedTo: "all_holders", retiredWriters: "rejected" }; },
    }, now: () => now,
  };
  new HistoryNavigationSource(host, bound ? ports : undefined);
  let nextSignal: AbortSignal | undefined;
  installConnection(client, { interactions: "none", transport: {
    async fetch(_url, init) {
      const call = clientRequestSchema.parse(JSON.parse(String(init.body)));
      const descriptor = historyNavigationSourceContribution.methods["ompHistoryNavigationSource/action"];
      if (!descriptor) throw Error("FIXTURE_DESCRIPTOR");
      const payload = z.strictObject({ args: z.record(z.string(), z.unknown()) }).parse(call.payload);
      const args = z.record(z.string(), z.unknown()).parse(descriptor.input({ strict: true }).create().parse(payload.args));
      const signal = nextSignal; nextSignal = undefined;
      const value = await host.typertGateway.invoke({ namespace: "ompHistoryNavigationSource", method: "action", args, peer,
        ...(signal ? { signal } : {}) });
      return Response.json({ type: "server-response", rpcId: call.rpcId, result: { ok: true, value } });
    }, openStream: async function* () {},
  } });
  registry(client); gateway(client); await client.remote.$mount(historyNavigationSourceContribution);
  return {
    async action(request: HistoryNavigationSourceRequest) {
      const response = await client.remote.ompHistoryNavigationSource.action(request);
      if (!response.ok) throw Error("REMOTE_REJECTED"); return response.value;
    },
    commands, ports, sharedScope, access, records, invalidated,
    reply: (handler?: (command: NavigationClientCommand) => Promise<unknown>) => { nativeReply = handler; },
    signalNext: (signal: AbortSignal) => { nextSignal = signal; },
    busy: () => { idle = false; }, quiet: () => { idle = true; },
    revoke: () => { permitted = false; authority.abort(); },
    renew: () => { permitted = true; authority = new AbortController(); },
    changeEpoch: () => { epoch = "epoch-2"; }, advance: (ms: number) => { now += ms; },
    switchPeer: () => { peer = new Peer(host, { principal: { kind: "owner" }, interactions: "none" }); peers.push(peer); },
    usePeer: (index: number) => { const selected = peers[index]; if (!selected) throw Error("FIXTURE_PEER"); peer = selected; },
    restorePeer: () => { peer = firstPeer; },
    async dispose() { await client.fiber.dispose(); await Promise.all(peers.map(value => value.dispose())); await host.fiber.dispose(); },
  };
}

test("unbound SOURCE capability refuses native confirmation through the public Remote", async () => {
  const f = await fixture(false);
  try {
    expect(await f.action({ operation: "inspect", sessionId: "session", entryId: "entry" }))
      .toEqual({ status: "error", code: "navigation_unavailable" });
  } finally { await f.dispose(); }
});

async function confirmation(f: Awaited<ReturnType<typeof fixture>>) {
  const offer = await f.action({ operation: "inspect", sessionId: "session", entryId: "entry" });
  if (offer.status !== "confirmation") throw Error(`FIXTURE_CONFIRMATION:${JSON.stringify(offer)}`);
  return offer;
}

test("explicit confirmation durably reserves unknown before one native dispatch and rebuilds the same Session", async () => {
  const f = await fixture();
  try {
    const offer = await confirmation(f);
    const result = await f.action({ operation: "confirm", token: offer.token });
    expect(result).toMatchObject({ status: "operation", outcome: "committed", persistence: "committed",
      projection: "ready", actualLeafId: "post-hook-leaf", commitId: "commit-1" });
    const command = f.commands.find(value => value.type === "navigate_tree_committed");
    expect(command).toMatchObject({ sourceId: "source", instanceId: "instance", nativeSessionId: "native",
      expectedContextRevision: "context-r1", expectedTargetRevision: "target-r1" });
    if (!command || command.type !== "navigate_tree_committed") throw Error("FIXTURE_DISPATCH");
    expect(command.navigationId).not.toBe(command.id);
    expect(f.invalidated).toEqual([command.navigationId]);
    expect(await f.action({ operation: "confirm", token: offer.token }))
      .toEqual({ status: "error", code: "navigation_confirmation_unavailable" });
    expect(f.commands.filter(value => value.type === "navigate_tree_committed")).toHaveLength(1);
  } finally { await f.dispose(); }
});

test("native inspection gives an expiring explicit confirmation and cancelling never mutates", async () => {
  const f = await fixture();
  try {
    const offer = await f.action({ operation: "inspect", sessionId: "session", entryId: "entry" });
    expect(offer.status).toBe("confirmation");
    if (offer.status !== "confirmation") throw Error("FIXTURE_CONFIRMATION");
    expect({ parent: offer.targetParentId, notice: offer.notice, options: offer.options, expiry: offer.expiresAt })
      .toEqual({ parent: "parent", notice: "files_and_external_effects_are_not_rolled_back",
        options: "native_defaults", expiry: 31000 });
    expect(await f.action({ operation: "cancel", token: offer.token })).toEqual({ status: "cancelled" });
    expect(f.commands.map(command => command.type)).toEqual(["navigation_inspect"]);
  } finally { await f.dispose(); }
});

test("busy consumes confirmation; quiet requires a new native inspection and explicit action", async () => {
  const f = await fixture();
  try {
    const offer = await confirmation(f); f.busy();
    expect(await f.action({ operation: "confirm", token: offer.token }))
      .toEqual({ status: "error", code: "navigation_stop_required_new_action" });
    f.quiet();
    expect(await f.action({ operation: "confirm", token: offer.token }))
      .toEqual({ status: "error", code: "navigation_confirmation_unavailable" });
    expect(f.commands.filter(value => value.type === "navigate_tree_committed")).toHaveLength(0);
    const fresh = await confirmation(f);
    expect(await f.action({ operation: "confirm", token: fresh.token })).toMatchObject({ outcome: "committed" });
  } finally { await f.dispose(); }
});

test("confirmation is peer-owned, expires without renewal, and fences changed authority", async () => {
  const f = await fixture();
  try {
    const offer = await confirmation(f); f.switchPeer();
    expect(await f.action({ operation: "confirm", token: offer.token }))
      .toEqual({ status: "error", code: "navigation_confirmation_unavailable" });
    f.restorePeer(); f.advance(30000);
    expect(await f.action({ operation: "confirm", token: offer.token }))
      .toEqual({ status: "error", code: "navigation_confirmation_unavailable" });
    const next = await confirmation(f); f.changeEpoch();
    expect(await f.action({ operation: "confirm", token: next.token }))
      .toEqual({ status: "error", code: "navigation_binding_changed" });
    expect(f.commands.filter(value => value.type === "navigate_tree_committed")).toHaveLength(0);
  } finally { await f.dispose(); }
});

test("two Views cannot dispatch overlapping commits while durable reservation awaits", async () => {
  const f = await fixture();
  let release: (() => void) | undefined;
  const hold = new Promise<void>(resolve => { release = resolve; });
  let entered: (() => void) | undefined;
  const atReserve = new Promise<void>(resolve => { entered = resolve; });
  const deadline = setTimeout(() => { release?.(); entered?.(); }, 1000);
  const reserve = f.ports.repository.reserveUnknown;
  f.ports.repository.reserveUnknown = async (record, limit) => { entered?.(); await hold; return reserve(record, limit); };
  try {
    const first = await confirmation(f); f.switchPeer(); const second = await confirmation(f); f.restorePeer();
    const pending = f.action({ operation: "confirm", token: first.token });
    await atReserve;
    f.usePeer(1);
    // A different View owns its own fresh token; it still shares the same worker exclusion.
    expect(await f.action({ operation: "confirm", token: second.token }))
      .toEqual({ status: "error", code: "navigation_worker_busy_new_action" });
    release?.(); expect(await pending).toMatchObject({ outcome: "committed" });
    expect(f.commands.filter(value => value.type === "navigate_tree_committed")).toHaveLength(1);
    expect(second.status).toBe("confirmation");
  } finally { clearTimeout(deadline); release?.(); await f.dispose(); }
}, 2000);

test("lost native reply remains unknown; explicit query observes absent/reserved facts without replay", async () => {
  const f = await fixture();
  try {
    const offer = await confirmation(f);
    f.reply(async () => { throw Error("SYNTHETIC_LOST_REPLY_AFTER_DISPATCH"); });
    const lost = await f.action({ operation: "confirm", token: offer.token });
    expect(lost).toMatchObject({ status: "operation", outcome: "unknown", persistence: "unknown", projection: "invalidated" });
    if (lost.status !== "operation") throw Error("FIXTURE_OPERATION");
    f.reply(async command => {
      if (command.type !== "navigation_query") throw Error("REPLAY_FORBIDDEN");
      return { version: "durable-navigation-v1", navigationId: command.navigationId, target, found: false,
        duplicate: true, admission: "absent", outcome: "absent", reservation: "absent", persistence: "unresolved", terminal: false };
    });
    expect(await f.action({ operation: "query", sessionId: "session", navigationId: lost.navigationId }))
      .toMatchObject({ outcome: "absent", persistence: "unresolved" });
    f.reply(async command => {
      if (command.type !== "navigation_query") throw Error("REPLAY_FORBIDDEN");
      return { version: "durable-navigation-v1", navigationId: command.navigationId, target, found: true,
        duplicate: true, admission: "local", origin: { ...target, navigationId: command.navigationId },
        outcome: "reserved", reservation: "committed", persistence: "unresolved", terminal: false,
        requestedTargetId: "entry", targetParentId: "parent", contextRevision: "context-r1", targetRevision: "target-r1" };
    });
    expect(await f.action({ operation: "query", sessionId: "session", navigationId: lost.navigationId }))
      .toMatchObject({ outcome: "reserved", persistence: "unresolved" });
    expect(f.commands.map(value => value.type)).toEqual([
      "navigation_inspect", "navigate_tree_committed", "navigation_query", "navigation_query",
    ]);
  } finally { await f.dispose(); }
});

test("failed and cancelled outcomes preserve committed effects when rebuilding fails and text stays a conflict-safe offer", async () => {
  for (const outcome of ["failed", "cancelled"] as const) {
    const f = await fixture();
    try {
      const offer = await confirmation(f);
      f.reply(async command => {
        if (command.type === "navigation_inspect") throw Error("UNEXPECTED_INSPECT");
        return committed(command.navigationId, { outcome, draftStatus: "inline", editorText: "historical unsent text",
          draftOriginEntryId: "entry", draftContentRevision: "target-r1" });
      });
      f.ports.projectionOwner.rebuild = async () => { throw Error("SYNTHETIC_REBUILD_FAILURE"); };
      const result = await f.action({ operation: "confirm", token: offer.token });
      expect(result).toMatchObject({ status: "operation", outcome, persistence: "committed", projection: "failed",
        commitId: "commit-1", actualLeafId: "post-hook-leaf", draft: { kind: "conflict_safe_draft_offer",
          text: "historical unsent text", policy: "explicit_choice_never_overwrite_or_send", renewOriginals: false,
          originals: "unavailable" } });
      expect(f.invalidated).toHaveLength(1);
      expect(JSON.stringify([...f.records.values()])).not.toContain("historical unsent text");
    } finally { await f.dispose(); }
  }
});

test("structurally valid mismatched scope, origin, target, revisions and contradictory completion stay unknown", async () => {
  const replies: Partial<NavigationResult>[] = [
    { target: { ...target, instanceId: "another-instance" } },
    { origin: { ...target, sourceId: "another-source", navigationId: "replace-below" } },
    { requestedTargetId: "another-entry" }, { targetParentId: "another-parent" },
    { targetRevision: "changed-target" }, { contextRevision: "changed-context" },
    { terminal: false }, { outcome: "reserved" }, { found: false }, { admission: "inherited" },
    { draftStatus: "inline", editorText: "never publish this", draftOriginEntryId: "another-entry", draftContentRevision: "target-r1" },
  ];
  for (const changed of replies) {
    const f = await fixture();
    try {
      const offer = await confirmation(f);
      f.reply(async command => {
        if (command.type === "navigation_inspect") throw Error("UNEXPECTED_INSPECT");
        return committed(command.navigationId, { ...changed,
          ...(changed.origin ? { origin: { ...changed.origin, navigationId: command.navigationId } } : {}) });
      });
      expect(await f.action({ operation: "confirm", token: offer.token }))
        .toMatchObject({ status: "operation", outcome: "unknown", persistence: "unknown", projection: "invalidated" });
      expect(f.invalidated).toHaveLength(1);
    } finally { await f.dispose(); }
  }
});

test("a boolean projection callback cannot attest rebuilding after a durable commit", async () => {
  const f = await fixture();
  try {
    const offer = await confirmation(f);
    // The JS boundary may violate a typed port; a structured public generation proof is mandatory.
    Object.defineProperty(f.ports.projectionOwner, "rebuild", { value: async () => true });
    expect(await f.action({ operation: "confirm", token: offer.token }))
      .toMatchObject({ outcome: "committed", persistence: "committed", projection: "failed" });
  } finally { await f.dispose(); }
});

test("token capacity is bounded globally and expired tokens do not accumulate or renew", async () => {
  const f = await fixture();
  try {
    for (let index = 0; index < 8; index++) await confirmation(f);
    expect(await f.action({ operation: "inspect", sessionId: "session", entryId: "entry" }))
      .toEqual({ status: "error", code: "navigation_confirmation_budget" });
    expect(f.commands).toHaveLength(8);
    f.advance(30000);
    expect((await confirmation(f)).expiresAt).toBe(61000);
  } finally { await f.dispose(); }
});

test("revoked authority during native inspection withholds confirmation and invalidates old tokens synchronously", async () => {
  const f = await fixture();
  try {
    const old = await confirmation(f);
    f.reply(async command => { f.revoke(); return { ...preview, entryId: command.type === "navigation_inspect" ? command.entryId : "entry" }; });
    expect(await f.action({ operation: "inspect", sessionId: "session", entryId: "entry" }))
      .toEqual({ status: "error", code: "navigation_authority_unavailable" });
    f.renew();
    expect(await f.action({ operation: "confirm", token: old.token }))
      .toEqual({ status: "error", code: "navigation_confirmation_unavailable" });
    expect(f.commands.filter(value => value.type === "navigate_tree_committed")).toHaveLength(0);
  } finally { await f.dispose(); }
});

test("trusted scope and options remain frozen while repository persistence awaits", async () => {
  const f = await fixture();
  try {
    const original = structuredClone(f.sharedScope);
    const reserve = f.ports.repository.reserveUnknown;
    f.ports.repository.reserveUnknown = async (record, limit) => {
      const accepted = await reserve(record, limit);
      // A mutable external authority object changes while a previously captured capability is awaiting.
      f.sharedScope.sourceId = "redirected-source";
      f.ports.authorize = () => ({ ...f.access, scope: original });
      return accepted;
    };
    f.ports.projectionOwner.rebuild = async () => { throw Error("SYNTHETIC_NO_REBUILD"); };
    const offer = await confirmation(f);
    expect(await f.action({ operation: "confirm", token: offer.token })).toMatchObject({ outcome: "committed" });
    const submitted = f.commands.find(value => value.type === "navigate_tree_committed");
    expect(submitted).toMatchObject({ sourceId: "source", expectedContextRevision: "context-r1", expectedTargetRevision: "target-r1" });
    expect(submitted && "summarize" in submitted).toBe(false);
    expect(submitted && "customInstructions" in submitted).toBe(false);
  } finally { await f.dispose(); }
});

test("cancellation or worker authority loss after dispatch stays unknown and only query may recover", async () => {
  for (const loss of ["cancel", "worker"] as const) {
    const f = await fixture();
    try {
      const offer = await confirmation(f), abort = new AbortController();
      f.signalNext(abort.signal);
      f.reply(async command => {
        if (command.type === "navigation_inspect") throw Error("UNEXPECTED_INSPECT");
        if (loss === "cancel") abort.abort(); else f.revoke();
        return committed(command.navigationId, { draftStatus: "inline", editorText: "withheld private text",
          draftOriginEntryId: "entry", draftContentRevision: "target-r1" });
      });
      const result = await f.action({ operation: "confirm", token: offer.token });
      expect(result).toMatchObject({ outcome: "unknown", persistence: "unknown", projection: "invalidated" });
      expect(JSON.stringify(result)).not.toContain("withheld private text");
      if (result.status !== "operation") throw Error("FIXTURE_OPERATION");
      f.renew(); f.reply();
      expect(await f.action({ operation: "query", sessionId: "session", navigationId: result.navigationId }))
        .toMatchObject({ outcome: "committed", persistence: "committed", projection: "ready" });
      expect(f.commands.filter(value => value.type === "navigate_tree_committed")).toHaveLength(1);
    } finally { await f.dispose(); }
  }
});

test("immutable committed receipt survives later appends and cannot be replaced by an absent query reply", async () => {
  const f = await fixture();
  try {
    const offer = await confirmation(f);
    const result = await f.action({ operation: "confirm", token: offer.token });
    if (result.status !== "operation") throw Error("FIXTURE_OPERATION");
    f.sharedScope.contextId = "later-append-context";
    expect(await f.action({ operation: "query", sessionId: "session", navigationId: result.navigationId }))
      .toMatchObject({ outcome: "committed", persistence: "committed", actualLeafId: "post-hook-leaf", projection: "ready" });
    f.reply(async command => {
      if (command.type !== "navigation_query") throw Error("REPLAY_FORBIDDEN");
      return { version: "durable-navigation-v1", navigationId: command.navigationId, target, found: false,
        duplicate: true, admission: "absent", outcome: "absent", reservation: "absent", persistence: "unresolved", terminal: false };
    });
    expect(await f.action({ operation: "query", sessionId: "session", navigationId: result.navigationId }))
      .toMatchObject({ outcome: "committed", persistence: "committed", actualLeafId: "post-hook-leaf", projection: "invalidated" });
    expect(f.commands.filter(value => value.type === "navigate_tree_committed")).toHaveLength(1);
  } finally { await f.dispose(); }
});

test("revocation while rebuilding withholds returned draft text while preserving the committed receipt", async () => {
  const f = await fixture();
  try {
    const offer = await confirmation(f);
    f.reply(async command => {
      if (command.type === "navigation_inspect") throw Error("UNEXPECTED_INSPECT");
      return committed(command.navigationId, { draftStatus: "inline", editorText: "private returned draft",
        draftOriginEntryId: "entry", draftContentRevision: "target-r1" });
    });
    f.ports.projectionOwner.rebuild = async () => { f.revoke(); throw Error("REVOKED_DURING_REBUILD"); };
    const result = await f.action({ operation: "confirm", token: offer.token });
    expect(result).toMatchObject({ outcome: "committed", persistence: "committed" });
    expect(JSON.stringify(result)).not.toContain("private returned draft");
  } finally { await f.dispose(); }
});

test("busy detected after durable reservation prevents dispatch and permits a new action after Stop", async () => {
  const f = await fixture();
  try {
    const reserve = f.ports.repository.reserveUnknown;
    f.ports.repository.reserveUnknown = async (record, limit) => {
      const accepted = await reserve(record, limit); f.busy(); return accepted;
    };
    const first = await confirmation(f);
    expect(await f.action({ operation: "confirm", token: first.token }))
      .toEqual({ status: "error", code: "navigation_stop_required_new_action" });
    expect(f.commands.filter(value => value.type === "navigate_tree_committed")).toHaveLength(0);
    f.quiet(); f.ports.repository.reserveUnknown = reserve;
    const fresh = await confirmation(f);
    expect(await f.action({ operation: "confirm", token: fresh.token })).toMatchObject({ outcome: "committed" });
  } finally { await f.dispose(); }
});

test("stale native revisions refuse mutation without fallback, and a fresh intent cannot replay an unresolved operation", async () => {
  const f = await fixture();
  try {
    const offer = await confirmation(f);
    f.reply(async command => {
      if (command.type === "navigation_inspect") return structuredClone(preview);
      throw Error("NAVIGATION_STALE_CONTEXT");
    });
    expect(await f.action({ operation: "confirm", token: offer.token }))
      .toMatchObject({ navigationId: offer.navigationId, outcome: "unknown", persistence: "unknown" });
    const next = await confirmation(f);
    expect(await f.action({ operation: "confirm", token: next.token }))
      .toEqual({ status: "error", code: "navigation_operation_unresolved" });
    expect(f.commands.map(value => value.type)).toEqual(["navigation_inspect", "navigate_tree_committed", "navigation_inspect"]);
  } finally { await f.dispose(); }
});

test("reference-only drafts remain unavailable rather than becoming empty inline text", async () => {
  const f = await fixture();
  try {
    const offer = await confirmation(f);
    f.reply(async command => {
      if (command.type === "navigation_inspect") throw Error("UNEXPECTED_INSPECT");
      return committed(command.navigationId, { draftStatus: "reference_only", draftUnavailableReason: "draft_exceeds_inline_limit",
        draftOriginEntryId: "entry", draftContentRevision: "target-r1" });
    });
    const result = await f.action({ operation: "confirm", token: offer.token });
    expect(result).toMatchObject({ outcome: "committed", draftUnavailable: "draft_exceeds_inline_limit" });
    expect("draft" in result).toBe(false);
  } finally { await f.dispose(); }
});

test("native confirmation revisions are nonempty and bounded before caching", async () => {
  for (const contextRevision of ["", "x".repeat(257)]) {
    const f = await fixture();
    try {
      f.reply(async () => ({ ...preview, contextRevision }));
      expect(await f.action({ operation: "inspect", sessionId: "session", entryId: "entry" }))
        .toEqual({ status: "error", code: "navigation_reply_mismatch" });
    } finally { await f.dispose(); }
  }
});

test("synthetic retained metadata permits only explicit query across service recreation and worker replacement", async () => {
  // This is an external metadata fixture, not filesystem durability or an actual Host restart proof.
  const metadata = new Map<string, NavigationOperationMetadata>();
  const first = await fixture(true, metadata);
  let navigationId: string;
  try {
    const offer = await confirmation(first); navigationId = offer.navigationId;
    first.reply(async () => { throw Error("SYNTHETIC_WORKER_LOSS"); });
    expect(await first.action({ operation: "confirm", token: offer.token })).toMatchObject({ outcome: "unknown" });
  } finally { await first.dispose(); }
  const next = await fixture(true, metadata);
  try {
    next.sharedScope.workerId = "replacement-worker"; next.sharedScope.workerGeneration = "replacement-generation";
    next.ports.idle = scope => ({ generation: "stop-g2", workerGeneration: scope.workerGeneration,
      scope: { kind: "session", sessionId: scope.sessionId }, status: "idle", nativeSettled: true, acceptingWork: true,
      pending: { interactions: 0, history: 0, queued: 0, other: 0 }, failures: [], forceAvailable: false,
      restored: null, draftConflict: false });
    const newIntent = await confirmation(next);
    expect(await next.action({ operation: "confirm", token: newIntent.token }))
      .toEqual({ status: "error", code: "navigation_operation_unresolved" });
    expect(await next.action({ operation: "query", sessionId: "session", navigationId }))
      .toMatchObject({ outcome: "committed", persistence: "committed", projection: "ready" });
    expect(next.commands.map(value => value.type)).toEqual(["navigation_inspect", "navigation_query"]);
  } finally { await next.dispose(); }
});

test("missing policy/cohort, metadata or projection capability fails closed before native inspection", async () => {
  for (const missing of ["cohort", "repository", "projectionOwner"] as const) {
    const f = await fixture();
    try {
      if (missing === "cohort") Object.defineProperty(f.access, "matchedCohort", { value: "" });
      else Reflect.deleteProperty(f.ports, missing);
      const result = await f.action({ operation: "inspect", sessionId: "session", entryId: "entry" });
      expect(result.status).toBe("error");
      expect(f.commands).toEqual([]);
    } finally { await f.dispose(); }
  }
});

test("joint idle cannot be asserted by acceptingWork alone or by another worker/Broker scope", async () => {
  for (const mismatch of ["worker", "broker", "pending"] as const) {
    const f = await fixture();
    try {
      const offer = await confirmation(f), idle = f.ports.idle;
      f.ports.idle = scope => {
        const value = idle(scope);
        if (mismatch === "worker") return { ...value, workerGeneration: "another-worker" };
        if (mismatch === "broker") return { ...value, scope: { kind: "session", sessionId: "another-session" } };
        return { ...value, pending: { ...value.pending, history: 1 } };
      };
      expect(await f.action({ operation: "confirm", token: offer.token }))
        .toEqual({ status: "error", code: "navigation_stop_required_new_action" });
      expect(f.commands.filter(value => value.type === "navigate_tree_committed")).toHaveLength(0);
    } finally { await f.dispose(); }
  }
});

test("native unsupported reason is explicit while its committed effects still require projection rebuilding", async () => {
  const f = await fixture();
  try {
    const offer = await confirmation(f);
    f.reply(async command => {
      if (command.type === "navigation_inspect") throw Error("UNEXPECTED_INSPECT");
      return committed(command.navigationId, { outcome: "unsupported", code: "ask_reanswer_unsupported" });
    });
    expect(await f.action({ operation: "confirm", token: offer.token })).toMatchObject({ outcome: "unsupported",
      persistence: "committed", projection: "ready", nativeCode: "ask_reanswer_unsupported" });
    expect(f.invalidated).toHaveLength(1);
  } finally { await f.dispose(); }
});

test("busy invalidates other Views' old intents and refuses a new action until joint idle", async () => {
  const f = await fixture();
  try {
    const first = await confirmation(f); f.switchPeer(); const other = await confirmation(f); f.restorePeer();
    f.busy();
    expect(await f.action({ operation: "confirm", token: first.token }))
      .toEqual({ status: "error", code: "navigation_stop_required_new_action" });
    expect(await f.action({ operation: "inspect", sessionId: "session", entryId: "entry" }))
      .toEqual({ status: "error", code: "navigation_stop_required_new_action" });
    f.quiet(); f.usePeer(1);
    expect(await f.action({ operation: "confirm", token: other.token }))
      .toEqual({ status: "error", code: "navigation_confirmation_unavailable" });
    expect(f.commands.filter(value => value.type === "navigate_tree_committed")).toHaveLength(0);
  } finally { await f.dispose(); }
});
