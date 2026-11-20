import { afterAll, expect, test } from "bun:test";
import { restoreFixture } from "./broker-fixture-guard.ts";
const { Context } = await import("@deepseek-ai/cordis");
const { installConnection } = await import("@deepseek-ai/dsh-client-connection/client");
const { apply: registry } = await import("@deepseek-ai/dsh-typert-registry/client");
const { apply: gateway } = await import("@deepseek-ai/dsh-api-gateway/client");
const { default: HostRegistry } = await import("@deepseek-ai/dsh-typert-registry");
const { default: RemoteAccess } = await import("@deepseek-ai/dsh-api-remote-access");
const { TypertGatewayService } = await import("@deepseek-ai/dsh-api-gateway");
const { Peer, clientRequestSchema } = await import("@deepseek-ai/dsh-client-connection");
const { stopContribution, stopHostContribution } = await import("../../packages/contracts/stop.ts");
const { StopCoordinator, createStopNativePort } = await import("../../packages/interactions/stop.ts");
const { StopService, stopCaller } = await import("../../packages/interactions/stop-service.ts");
const { InteractionBroker } = await import("../../packages/interactions/broker.ts");
const { brokerContribution, brokerHostContribution } = await import("../../packages/contracts/interaction-broker.ts");
const { InteractionBrokerService, interactionCaller } = await import("../../packages/interactions/service.ts");
const { z } = await import("zod");
afterAll(restoreFixture);

async function publicPages(stop: InstanceType<typeof StopCoordinator>, broker?: InstanceType<typeof InteractionBroker>) {
  const host = new Context();
  await host.plugin(HostRegistry); await host.plugin(RemoteAccess); await host.plugin(TypertGatewayService, {});
  host.typert.register(stopHostContribution); new StopService(host);
  if (broker) { host.typert.register(brokerHostContribution); new InteractionBrokerService(host, broker); }
  const clients: InstanceType<typeof Context>[] = [], peers: InstanceType<typeof Peer>[] = [];
  async function page(clientId: string) {
    const binding = stop.attach({ credentialId: "credential", clientId, peerId: clientId });
    const peer = new Peer(host, { principal: { kind: "owner" } }); peers.push(peer);
    const uiBinding = broker?.attach({ credentialId: "credential", clientId, peerId: peer.id });
    const ctx = new Context(); clients.push(ctx);
    installConnection(ctx, { interactions: "none", transport: { fetch: async (_url, init) => {
      const envelope = clientRequestSchema.parse(JSON.parse(String(init.body)));
      const descriptor = stopContribution.methods[envelope.method] ?? brokerContribution.methods[envelope.method];
      if (!descriptor) throw new Error("UNKNOWN_REMOTE");
      const payload = z.object({ args: z.record(z.string(), z.unknown()) }).parse(envelope.payload);
      const args = z.record(z.string(), z.unknown()).parse(descriptor.input({ strict: true }).create().parse(payload.args));
      const method = envelope.method.split("/")[1]; if (!method) throw new Error("UNKNOWN_REMOTE");
      const namespace = envelope.method.split("/")[0];
      const invoke = () => host.typertGateway.invoke({ namespace: namespace ?? "", method, args, peer,
        signal: new AbortController().signal });
      const value = namespace === "ompStop" ? await stopCaller.run({ coordinator: stop, page: binding }, invoke)
        : uiBinding ? await interactionCaller.run({ page: uiBinding, current: () => true }, invoke) : (() => { throw new Error("UNKNOWN_REMOTE"); })();
      return Response.json({ type: "server-response", rpcId: envelope.rpcId, result: { ok: true, value } });
    }, openStream: async function* () {} } });
    registry(ctx); gateway(ctx); await ctx.remote.$mount(stopContribution);
    if (broker) await ctx.remote.$mount(brokerContribution);
    return { remote: ctx.remote.ompStop, interactions: ctx.remote.ompInteractionBroker, binding };
  }
  return { page, async dispose() {
    stop.close(); for (const ctx of clients) await ctx.fiber.dispose();
    for (const peer of peers) await peer.dispose(); await host.fiber.dispose();
  } };
}

test("concurrent public Stop fences work, withdraws the Native queue, and waits for joint idle", async () => {
  const held = Promise.withResolvers<{ steering: { text: string }[]; followUp: never[];
    imagesDropped: true; truncated: true }>();
  const commands: string[] = []; let history = 1;
  const broker = new InteractionBroker({ kind: "session", sessionId: "native-session" }, "worker", "agent", {
    respondUi: async () => ({ status: "cancelled" }), requestStop: async () => {},
  }, () => true);
  broker.receive({ type: "ready", interactionPolicy: { version: "1", explicitAnswersOnly: true,
    nativeExpiry: "cancel", toolExpiry: "cancel", invalidAnswer: "pending" } });
  const uiPage = broker.attach({ credentialId: "credential", clientId: "ui", peerId: "ui" });
  broker.receive({ type: "extension_ui_request", id: "question", method: "input", title: "Explicit" });
  const stop = new StopCoordinator({ kind: "session", sessionId: "native-session" }, "worker", {
    abortBranchSummary: async () => { commands.push("abort_branch_summary"); },
    abortAndRestoreQueue: async () => { commands.push("abort_and_restore_queue"); return held.promise; },
  }, { beginStop: () => broker.beginStop(), cancellationUncertain: () => broker.cancellationUncertain,
    pending: () => ({ interactions: broker.pendingCount,
    history, queued: 0, other: 0 }), resume: () => broker.resumeAfterStop() }, () => true);
  const fixture = await publicPages(stop);
  try {
    const a = await fixture.page("a"), b = await fixture.page("b");
    expect((await Promise.all([a.remote.stop(), b.remote.stop()])).map(result => result.ok && result.value.status))
      .toEqual(["stopping", "stopping"]);
    expect(commands).toEqual(["abort_branch_summary", "abort_and_restore_queue"]);
    expect(broker.pending(uiPage).accepting).toBe(false);
    expect(stop.admitFreshAction(a.binding)).toBe(false);
    stop.observe("worker", { kind: "agent-end" });
    stop.observe("worker", { kind: "settled", settled: true });
    held.resolve({ steering: [{ text: "withdrawn" }], followUp: [], imagesDropped: true, truncated: true });
    await stop.drain();
    const pending = await a.remote.state(); if (!pending.ok) throw new Error("STATE_FAILED");
    expect(pending.value.status).toBe("stopping");
    expect(pending.value.restored).toEqual({ steering: [{ text: "withdrawn" }], followUp: [],
      imagesDropped: true, truncated: true, unsentOnly: true });
    history = 0;
    const idle = await b.remote.state(); if (!idle.ok) throw new Error("STATE_FAILED");
    expect(idle.value.status).toBe("idle");
    expect(stop.admitFreshAction(a.binding)).toBe(true);
    expect(commands).toHaveLength(2);
  } finally { broker.close(); await fixture.dispose(); }
});

test("30 seconds only offers one-use current-page force; expired/replaced pages never terminate", async () => {
  let now = 0, permitted = true, terminations = 0;
  const reaped = Promise.withResolvers<"reaped">();
  const stop = new StopCoordinator({ kind: "session", sessionId: "session" }, "worker", {
    abortBranchSummary: async () => {}, abortAndRestoreQueue: async () => ({ steering: [], followUp: [] }),
  }, { beginStop: async () => {}, cancellationUncertain: () => false,
    pending: () => ({ interactions: 0, history: 0, queued: 0, other: 0 }),
    resume: () => {} }, () => permitted, () => now, { workerGeneration: "worker", isCurrent: () => true,
    terminateAndReap: async () => { terminations++; return reaped.promise; } });
  const fixture = await publicPages(stop);
  try {
    const a = await fixture.page("a"), b = await fixture.page("b");
    await a.remote.stop(); await stop.drain(); now = 29_999;
    expect(await a.remote.offerForce()).toEqual({ ok: true, value: { status: "unavailable" } });
    now = 30_000;
    expect(terminations).toBe(0);
    const offered = await a.remote.offerForce(); if (!offered.ok || !offered.value.token) throw new Error("OFFER_FAILED");
    expect(await b.remote.confirmForce(offered.value.token)).toEqual({ ok: true, value: { status: "stale" } });
    now = 90_000;
    expect(await a.remote.confirmForce(offered.value.token)).toEqual({ ok: true, value: { status: "stale" } });
    const old = await a.remote.offerForce(); if (!old.ok || !old.value.token) throw new Error("OFFER_FAILED");
    const refreshed = await fixture.page("a");
    expect(await a.remote.confirmForce(old.value.token)).toEqual({ ok: true, value: { status: "stale" } });
    const replaced = await refreshed.remote.offerForce();
    if (!replaced.ok || !replaced.value.token) throw new Error("OFFER_FAILED");
    permitted = false;
    expect(await refreshed.remote.confirmForce(replaced.value.token)).toEqual({ ok: true, value: { status: "stale" } });
    permitted = true;
    const admitted = await fixture.page("a");
    const fresh = await admitted.remote.offerForce(); if (!fresh.ok || !fresh.value.token) throw new Error("OFFER_FAILED");
    const race = [admitted.remote.confirmForce(fresh.value.token), admitted.remote.confirmForce(fresh.value.token)];
    await Promise.resolve(); await Promise.resolve(); reaped.resolve("reaped");
    expect((await Promise.all(race)).map(result => result.ok && result.value.status).sort()).toEqual(["ended", "stale"]);
    expect(terminations).toBe(1);
    expect(stop.admitFreshAction(admitted.binding)).toBe(false);
  } finally { reaped.resolve("reaped"); await fixture.dispose(); }
});

test.each(["replaced", "throws"] as const)(
  "an original handle that becomes unknown (%s) stays unusable even if its adapter later reports current", async mode => {
  let now = 0, current = true, terminations = 0;
  const stop = new StopCoordinator({ kind: "session", sessionId: "session" }, "worker", {
    abortBranchSummary: async () => {}, abortAndRestoreQueue: async () => ({ steering: [], followUp: [] }),
  }, { beginStop: async () => {}, cancellationUncertain: () => false,
    pending: () => ({ interactions: 0, history: 0, queued: 0, other: 0 }),
    resume: () => {} }, () => true, () => now, { workerGeneration: "worker", isCurrent: () => {
      if (!current && mode === "throws") throw new Error("unknown original handle"); return current;
    },
    terminateAndReap: async () => { terminations++; return "reaped"; } });
  const fixture = await publicPages(stop);
  try {
    const page = await fixture.page("page"); await page.remote.stop(); now = 30_000;
    const offer = await page.remote.offerForce(); if (!offer.ok || !offer.value.token) throw new Error("OFFER_FAILED");
    current = false;
    expect(await page.remote.confirmForce(offer.value.token)).toEqual({ ok: true, value: { status: "stale" } });
    current = true;
    expect(await page.remote.offerForce()).toEqual({ ok: true, value: { status: "unavailable" } });
    expect(await page.remote.confirmForce(offer.value.token)).toEqual({ ok: true, value: { status: "stale" } });
    expect(terminations).toBe(0);
  } finally { await fixture.dispose(); }
});

test.each(["unknown", "throws"] as const)("confirmed termination %s remains unknown and cannot replay", async outcome => {
  let now = 0, terminations = 0;
  const stop = new StopCoordinator({ kind: "session", sessionId: "session" }, "worker", {
    abortBranchSummary: async () => {}, abortAndRestoreQueue: async () => ({ steering: [], followUp: [] }),
  }, { beginStop: async () => {}, cancellationUncertain: () => false,
    pending: () => ({ interactions: 0, history: 0, queued: 0, other: 0 }),
    resume: () => {} }, () => true, () => now, { workerGeneration: "worker", isCurrent: () => true,
    terminateAndReap: async () => { terminations++; if (outcome === "throws") throw new Error("synthetic failure"); return "unknown"; } });
  const fixture = await publicPages(stop);
  try {
    const page = await fixture.page("page"); await page.remote.stop(); now = 30_000;
    const offer = await page.remote.offerForce(); if (!offer.ok || !offer.value.token) throw new Error("OFFER_FAILED");
    expect(await page.remote.confirmForce(offer.value.token)).toEqual({ ok: true, value: { status: "unknown" } });
    expect(await page.remote.confirmForce(offer.value.token)).toEqual({ ok: true, value: { status: "stale" } });
    const state = await page.remote.state(); if (!state.ok) throw new Error("STATE_FAILED");
    expect(state.value.failures).toEqual(["termination-unknown"]);
    expect(state.value.acceptingWork).toBe(false); expect(terminations).toBe(1);
  } finally { await fixture.dispose(); }
});

test.each(["interactions", "history", "queued", "other"] as const)(
  "native settled does not bypass remaining Host %s work or replay a blocked action", async busy => {
  const pending = { interactions: 0, history: 0, queued: 0, other: 0 }; pending[busy] = 1;
  const stop = new StopCoordinator({ kind: "session", sessionId: "session" }, "worker", {
    abortBranchSummary: async () => {}, abortAndRestoreQueue: async () => ({ steering: [], followUp: [] }),
  }, { beginStop: async () => {}, cancellationUncertain: () => false,
    pending: () => pending, resume: () => {} }, () => true);
  const fixture = await publicPages(stop);
  try {
    const page = await fixture.page("page"); await page.remote.stop(); await stop.drain();
    stop.observe("worker", { kind: "settled", settled: true });
    const blocked = await page.remote.state(); if (!blocked.ok) throw new Error("STATE_FAILED");
    expect(blocked.value.status).toBe("stopping"); expect(stop.admitFreshAction(page.binding)).toBe(false);
    pending[busy] = 0;
    const idle = await page.remote.state(); if (!idle.ok) throw new Error("STATE_FAILED");
    expect(idle.value.acceptingWork).toBe(true);
    stop.observe("worker", { kind: "settled", settled: false });
    expect(stop.admitFreshAction(page.binding)).toBe(false);
    const waking = await page.remote.state(); if (!waking.ok) throw new Error("STATE_FAILED");
    expect(waking.value.acceptingWork).toBe(false);
  } finally { await fixture.dispose(); }
});

test("typed public Native adapter uses the existing queue withdrawal and summary commands", async () => {
  const commands: { id: string; type: string }[] = [];
  const port = createStopNativePort({ abortBranchSummary: async command => { commands.push(command); },
    abortAndRestoreQueue: async command => { commands.push(command); return { steering: [], followUp: [] }; } });
  await port.abortBranchSummary(); await port.abortAndRestoreQueue();
  expect(commands.map(command => command.type)).toEqual(["abort_branch_summary", "abort_and_restore_queue"]);
  expect(commands[0]?.id).not.toBe(commands[1]?.id);
});

test("EOF and agent_end never establish idle; abort refusal remains visible without automatic force", async () => {
  let now = 0;
  const stop = new StopCoordinator({ kind: "startup", contextId: "startup" }, "worker", {
    abortBranchSummary: async () => { throw new Error("synthetic refusal"); },
    abortAndRestoreQueue: async () => { throw new Error("synthetic refusal"); },
  }, { beginStop: async () => {}, cancellationUncertain: () => false,
    pending: () => ({ interactions: 0, history: 0, queued: 0, other: 0 }),
    resume: () => {} }, () => true, () => now);
  const fixture = await publicPages(stop);
  try {
    const page = await fixture.page("a"); await page.remote.stop(); await stop.drain();
    stop.observe("worker-old", { kind: "settled", settled: true });
    stop.observe("worker", { kind: "agent-end" }); now = 300_000;
    const stopping = await page.remote.state(); if (!stopping.ok) throw new Error("STATE_FAILED");
    expect(stopping.value.status).toBe("stopping");
    expect(stopping.value.failures.sort()).toEqual(["queue-abort-failed", "summary-cancel-failed"]);
    expect(await page.remote.offerForce()).toEqual({ ok: true, value: { status: "unavailable" } });
    stop.observe("worker", { kind: "eof" });
    stop.observe("worker", { kind: "settled", settled: true });
    const eof = await page.remote.state(); if (!eof.ok) throw new Error("STATE_FAILED");
    expect(eof.value.status).toBe("unknown");
    expect(stop.admitFreshAction(page.binding)).toBe(false);
  } finally { await fixture.dispose(); }
});

test("a late UI cancellation must drain before idle, and restored text never overwrites a newer draft", async () => {
  const ui = Promise.withResolvers<{ status: "cancelled" }>();
  const queue = Promise.withResolvers<{ steering: never[]; followUp: { text: string }[] }>();
  const broker = new InteractionBroker({ kind: "session", sessionId: "session" }, "worker", "agent", {
    respondUi: async () => ui.promise, requestStop: async () => {},
  }, () => true);
  const stop = new StopCoordinator({ kind: "session", sessionId: "session" }, "worker", {
    abortBranchSummary: async () => {}, abortAndRestoreQueue: async () => queue.promise,
  }, { beginStop: () => broker.beginStop(), cancellationUncertain: () => broker.cancellationUncertain,
    pending: () => ({ interactions: broker.pendingCount,
    history: 0, queued: 0, other: 0 }), resume: () => broker.resumeAfterStop() }, () => true);
  const fixture = await publicPages(stop);
  try {
    const page = await fixture.page("page"); await page.remote.stop();
    broker.receive({ type: "extension_ui_request", id: "late", method: "input", title: "Late" });
    stop.setDraftConflict(page.binding, true);
    stop.observe("worker", { kind: "settled", settled: true });
    queue.resolve({ steering: [], followUp: [{ text: "unsent queued text" }] }); await stop.drain();
    const pending = await page.remote.state(); if (!pending.ok) throw new Error("STATE_FAILED");
    expect(pending.value.status).toBe("stopping");
    expect(pending.value.draftConflict).toBe(true);
    expect(pending.value.restored?.followUp).toEqual([{ text: "unsent queued text" }]);
    ui.resolve({ status: "cancelled" });
    for (let n = 0; n < 8; n++) await Promise.resolve();
    const idle = await page.remote.state(); if (!idle.ok) throw new Error("STATE_FAILED");
    expect(idle.value.status).toBe("idle");
  } finally { ui.resolve({ status: "cancelled" }); broker.close(); await fixture.dispose(); }
});

test.each(["invalid", "rejected", "incompatible"] as const)(
  "%s known UI cancellation cannot turn Native settlement into joint idle", async failure => {
  let now = 0;
  const commands: string[] = [];
  const broker = new InteractionBroker({ kind: "session", sessionId: "session" }, "worker", "agent", {
    respondUi: async params => {
      commands.push(params.targetId);
      if (failure === "rejected") throw new Error("synthetic lost cancellation acknowledgement");
      const result = { status: "invalid" as const };
      if (failure === "incompatible") Reflect.set(result, "status", "incompatible");
      return result;
    }, requestStop: async () => {},
  }, () => true);
  broker.receive({ type: "ready", interactionPolicy: { version: "1", explicitAnswersOnly: true,
    nativeExpiry: "cancel", toolExpiry: "cancel", invalidAnswer: "pending" } });
  const uiPage = broker.attach({ credentialId: "credential", clientId: "ui", peerId: "ui" });
  broker.receive({ type: "extension_ui_request", id: "question", method: "input", title: "Explicit" });
  const stop = new StopCoordinator({ kind: "session", sessionId: "session" }, "worker", {
    abortBranchSummary: async () => {}, abortAndRestoreQueue: async () => ({ steering: [], followUp: [] }),
  }, { beginStop: () => broker.beginStop(), cancellationUncertain: () => broker.cancellationUncertain,
    pending: () => ({ interactions: broker.pendingCount,
    history: 0, queued: 0, other: 0 }), resume: () => broker.resumeAfterStop() }, () => true, () => now);
  const fixture = await publicPages(stop);
  try {
    const page = await fixture.page("page"); await page.remote.stop(); await stop.drain();
    stop.observe("worker", { kind: "settled", settled: true });
    const state = await page.remote.state(); if (!state.ok) throw new Error("STATE_FAILED");
    expect(state.value.status).toBe("stopping");
    expect(state.value.failures).toContain("ui-cancel-failed");
    expect(state.value.pending.interactions).toBeGreaterThan(0);
    expect(state.value.acceptingWork).toBe(false);
    expect(stop.admitFreshAction(page.binding)).toBe(false);
    expect(broker.pending(uiPage).outcomes.some(outcome => outcome.status === "unknown")).toBe(true);
    now = 300_000;
    await page.remote.stop(); stop.observe("worker", { kind: "settled", settled: true });
    expect((await page.remote.state()).ok && stop.admitFreshAction(page.binding)).toBe(false);
    expect(await page.remote.offerForce()).toEqual({ ok: true, value: { status: "unavailable" } });
    expect(commands).toEqual(["question"]);
    expect(() => broker.resumeAfterStop()).toThrow("INTERACTION_NOT_QUIESCENT");
    broker.receive({ type: "extension_ui_request", id: "notice", method: "cancel", targetId: "unrelated" });
    expect(stop.admitFreshAction(page.binding)).toBe(false);
    broker.receive({ type: "extension_ui_request", id: "notice", method: "cancel", targetId: "question", reason: "aborted" });
    const resolved = await page.remote.state(); if (!resolved.ok) throw new Error("STATE_FAILED");
    expect(resolved.value.status).toBe("idle"); expect(resolved.value.failures).toEqual([]);
    expect(stop.admitFreshAction(page.binding)).toBe(true);
  } finally { broker.close(); await fixture.dispose(); }
});

test.each([
  ["stop", "answered"], ["deadline", "answered"], ["scope-revoke", "answered"], ["native-cancel", "answered"],
  ["stop", "invalid"], ["deadline", "invalid"], ["scope-revoke", "invalid"], ["native-cancel", "invalid"],
] as const)("held %s answer (%s) and incompatible cancellation preserve authoritative outcomes", async (control, status) => {
  let now = 0;
  const answer = Promise.withResolvers<{ status: "answered" | "invalid" }>(), entered = Promise.withResolvers<void>();
  const cancellation = Promise.withResolvers<{ status: "invalid" }>();
  const commands: string[] = [], timers = new Set<() => void>();
  const broker = new InteractionBroker({ kind: "session", sessionId: "session" }, "worker", "agent", {
    respondUi: async params => {
      commands.push(params.answer.type);
      if (params.answer.type === "cancel") return cancellation.promise;
      entered.resolve(); return answer.promise;
    }, requestStop: async () => {},
  }, () => true, { now: () => now, wall: () => now, schedule: (_delay, callback) => {
    timers.add(callback); return () => { timers.delete(callback); };
  } });
  broker.receive({ type: "ready", interactionPolicy: { version: "1", explicitAnswersOnly: true,
    nativeExpiry: "cancel", toolExpiry: "cancel", invalidAnswer: "pending" } });
  const stop = new StopCoordinator({ kind: "session", sessionId: "session" }, "worker", {
    abortBranchSummary: async () => {}, abortAndRestoreQueue: async () => ({ steering: [], followUp: [] }),
  }, { beginStop: () => broker.beginStop(), cancellationUncertain: () => broker.cancellationUncertain,
    pending: () => ({ interactions: broker.pendingCount, history: 0, queued: 0, other: 0 }),
    resume: () => broker.resumeAfterStop() }, () => true);
  const fixture = await publicPages(stop, broker);
  try {
    const page = await fixture.page("page");
    broker.receive({ type: "extension_ui_request", id: "held", method: "input", title: "Explicit" });
    const pending = await page.interactions.pending(); if (!pending.ok) throw new Error("PENDING_FAILED");
    const delivery = pending.value.pending[0]!;
    const response = page.interactions.answer(delivery.card.generation, "held", delivery.deliveryId,
      { type: "value", value: "explicit" });
    await entered.promise; await page.remote.stop();
    let revoke: Promise<void> = Promise.resolve();
    if (control === "deadline") { now = 1_800_000; for (const timer of [...timers]) timer(); }
    if (control === "scope-revoke") revoke = broker.revokeScope();
    if (control === "native-cancel") broker.receive({ type: "extension_ui_request", id: "notice", method: "cancel",
      targetId: "held", reason: "aborted" });
    cancellation.resolve({ status: "invalid" }); await stop.drain(); await revoke;
    stop.observe("worker", { kind: "settled", settled: true });
    expect(stop.admitFreshAction(page.binding)).toBe(false);
    const blocked = await page.remote.state(); if (!blocked.ok) throw new Error("STATE_FAILED");
    expect(blocked.value.status).toBe("stopping"); expect(blocked.value.pending.interactions).toBeGreaterThan(0);
    if (control !== "native-cancel") expect(blocked.value.failures).toEqual(["ui-cancel-failed"]);
    answer.resolve({ status });
    expect(await response).toEqual({ ok: true, value: { status: control === "scope-revoke" ? "stale" : status } });
    const resolved = await page.remote.state(); if (!resolved.ok) throw new Error("STATE_FAILED");
    const resumable = control !== "scope-revoke" && (status === "answered" || control === "native-cancel");
    expect(resolved.value.status).toBe(resumable ? "idle" : "stopping");
    expect(resolved.value.acceptingWork).toBe(resumable);
    if (control !== "scope-revoke") {
      const outcomes = await page.interactions.pending(); if (!outcomes.ok) throw new Error("PENDING_FAILED");
      expect(outcomes.value.pending).toEqual([]);
      expect(outcomes.value.outcomes.filter(outcome => outcome.id === "held").at(-1)?.status)
        .toBe(control === "native-cancel" ? "cancelled" : status === "answered" ? "answered" : "unknown");
    }
    expect(commands).toEqual(["value", "cancel"]);
  } finally {
    answer.resolve({ status: "answered" }); cancellation.resolve({ status: "invalid" });
    broker.close(); await fixture.dispose();
  }
});

test.each(["invalid", "rejected", "incompatible"] as const)(
  "%s late UI cancellation remains unknown after ordinary controls and Native settlement", async failure => {
  const queue = Promise.withResolvers<{ steering: never[]; followUp: never[] }>();
  const cancellation = Promise.withResolvers<{ status: "invalid" }>();
  const commands: string[] = [];
  const broker = new InteractionBroker({ kind: "session", sessionId: "session" }, "worker", "agent", {
    respondUi: async params => { commands.push(params.targetId); return cancellation.promise; },
    requestStop: async () => {},
  }, () => true);
  const stop = new StopCoordinator({ kind: "session", sessionId: "session" }, "worker", {
    abortBranchSummary: async () => {}, abortAndRestoreQueue: async () => queue.promise,
  }, { beginStop: () => broker.beginStop(), cancellationUncertain: () => broker.cancellationUncertain,
    pending: () => ({ interactions: broker.pendingCount, history: 0, queued: 0, other: 0 }),
    resume: () => broker.resumeAfterStop() }, () => true);
  const fixture = await publicPages(stop);
  try {
    const page = await fixture.page("page"); await page.remote.stop();
    broker.receive({ type: "extension_ui_request", id: "late", method: "input", title: "Late" });
    stop.observe("worker", { kind: "settled", settled: true });
    queue.resolve({ steering: [], followUp: [] }); await stop.drain();
    if (failure === "rejected") cancellation.reject(new Error("synthetic lost acknowledgement"));
    else {
      const result = { status: "invalid" as const };
      if (failure === "incompatible") Reflect.set(result, "status", "incompatible");
      cancellation.resolve(result);
    }
    for (let n = 0; n < 8; n++) await Promise.resolve();
    const state = await page.remote.state(); if (!state.ok) throw new Error("STATE_FAILED");
    expect(state.value.status).toBe("stopping"); expect(state.value.failures).toEqual(["ui-cancel-failed"]);
    expect(state.value.pending.interactions).toBeGreaterThan(0); expect(state.value.acceptingWork).toBe(false);
    expect(stop.admitFreshAction(page.binding)).toBe(false);
    expect(() => broker.resumeAfterStop()).toThrow("INTERACTION_NOT_QUIESCENT");
    broker.receive({ type: "extension_ui_request", id: "late", method: "input", title: "Duplicate late" });
    expect(commands).toEqual(["late"]);
    broker.receive({ type: "extension_ui_request", id: "notice", method: "cancel", targetId: "late", reason: "aborted" });
    const resolved = await page.remote.state(); if (!resolved.ok) throw new Error("STATE_FAILED");
    expect(resolved.value.status).toBe("idle"); expect(resolved.value.failures).toEqual([]);
  } finally {
    cancellation.resolve({ status: "invalid" }); queue.resolve({ steering: [], followUp: [] });
    broker.close(); await fixture.dispose();
  }
});

test("UI tracking overflow cannot evict unresolved evidence or make a settled Stop idle", async () => {
  let commands = 0;
  const broker = new InteractionBroker({ kind: "session", sessionId: "session" }, "worker", "agent", {
    respondUi: async () => { commands++; return { status: "cancelled" }; }, requestStop: async () => {},
  }, () => true);
  const stop = new StopCoordinator({ kind: "session", sessionId: "session" }, "worker", {
    abortBranchSummary: async () => {}, abortAndRestoreQueue: async () => ({ steering: [], followUp: [] }),
  }, { beginStop: () => broker.beginStop(), cancellationUncertain: () => broker.cancellationUncertain,
    pending: () => ({ interactions: broker.pendingCount, history: 0, queued: 0, other: 0 }),
    resume: () => broker.resumeAfterStop() }, () => true);
  const fixture = await publicPages(stop);
  try {
    const page = await fixture.page("page"); await page.remote.stop();
    for (let n = 0; n < 4097; n++) {
      broker.receive({ type: "extension_ui_request", id: `late-${n}`, method: "input", title: "Late" });
    }
    await stop.drain(); for (let n = 0; n < 8; n++) await Promise.resolve();
    stop.observe("worker", { kind: "settled", settled: true });
    const state = await page.remote.state(); if (!state.ok) throw new Error("STATE_FAILED");
    expect(state.value.status).toBe("stopping"); expect(state.value.failures).toEqual(["ui-cancel-failed"]);
    expect(state.value.pending.interactions).toBe(1); expect(commands).toBe(4096);
    broker.receive({ type: "extension_ui_request", id: "notice", method: "cancel", targetId: "late-4096" });
    expect(stop.admitFreshAction(page.binding)).toBe(false);
    expect(() => broker.resumeAfterStop()).toThrow("INTERACTION_NOT_QUIESCENT");
  } finally { broker.close(); await fixture.dispose(); }
});

test("a failed Host UI control remains failed even when its live cancellation ledger is empty", async () => {
  const stop = new StopCoordinator({ kind: "session", sessionId: "session" }, "worker", {
    abortBranchSummary: async () => {}, abortAndRestoreQueue: async () => ({ steering: [], followUp: [] }),
  }, { beginStop: async () => { throw new Error("synthetic Host control failure"); }, cancellationUncertain: () => false,
    pending: () => ({ interactions: 0, history: 0, queued: 0, other: 0 }), resume: () => {} }, () => true);
  const fixture = await publicPages(stop);
  try {
    const page = await fixture.page("page"); await page.remote.stop(); await stop.drain();
    stop.observe("worker", { kind: "settled", settled: true });
    const state = await page.remote.state(); if (!state.ok) throw new Error("STATE_FAILED");
    expect(state.value.status).toBe("stopping"); expect(state.value.failures).toEqual(["ui-cancel-failed"]);
    expect(stop.admitFreshAction(page.binding)).toBe(false);
  } finally { await fixture.dispose(); }
});

test("public Native state requires explicit empty background and queues, with fresh worker correlation", async () => {
  const stop = new StopCoordinator({ kind: "session", sessionId: "session" }, "worker", {
    abortBranchSummary: async () => {}, abortAndRestoreQueue: async () => ({ steering: [], followUp: [] }),
  }, { beginStop: async () => {}, cancellationUncertain: () => false,
    pending: () => ({ interactions: 0, history: 0, queued: 0, other: 0 }),
    resume: () => {} }, () => true);
  const fixture = await publicPages(stop);
  try {
    const page = await fixture.page("page"); await page.remote.stop(); await stop.drain();
    stop.observeState("worker", { sessionId: "session", isSettled: true });
    const incomplete = await page.remote.state(); if (!incomplete.ok) throw new Error("STATE_FAILED");
    expect(incomplete.value.acceptingWork).toBe(false);
    const state = { sessionId: "session", isSettled: true, isStreaming: false, isCompacting: false,
      hasPendingAsyncWork: false, queuedMessageCount: 0, queuedMessages: { steering: [], followUp: [] } };
    stop.observeState("old-worker", state); stop.observeState("worker", { ...state, sessionId: "other-session" });
    const wrong = await page.remote.state(); if (!wrong.ok) throw new Error("STATE_FAILED");
    expect(wrong.value.acceptingWork).toBe(false);
    stop.observeState("worker", { ...state, hasPendingAsyncWork: true });
    const background = await page.remote.state(); if (!background.ok) throw new Error("STATE_FAILED");
    expect(background.value.acceptingWork).toBe(false);
    stop.observeState("worker", state);
    const idle = await page.remote.state(); if (!idle.ok) throw new Error("STATE_FAILED");
    expect(idle.value.acceptingWork).toBe(true);
  } finally { await fixture.dispose(); }
});
