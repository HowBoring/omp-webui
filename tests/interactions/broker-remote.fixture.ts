import { afterAll, expect, test } from "bun:test";
import type { RespondUiParams } from "../../packages/contracts/generated/omp-wire.ts";
import type { PageBinding } from "../../packages/interactions/broker.ts";
import { restoreFixture } from "./broker-fixture-guard.ts";

// No Native/SDK/Host process, sockets or browser; the import guard precedes the whole public graph.
const { Context } = await import("@deepseek-ai/cordis");
const { installConnection } = await import("@deepseek-ai/dsh-client-connection/client");
const { apply: registry } = await import("@deepseek-ai/dsh-typert-registry/client");
const { apply: gateway } = await import("@deepseek-ai/dsh-api-gateway/client");
const { default: HostRegistry } = await import("@deepseek-ai/dsh-typert-registry");
const { default: RemoteAccess } = await import("@deepseek-ai/dsh-api-remote-access");
const { TypertGatewayService } = await import("@deepseek-ai/dsh-api-gateway");
const { Peer, clientRequestSchema } = await import("@deepseek-ai/dsh-client-connection");
const { z } = await import("zod");
const { brokerContribution, brokerHostContribution } = await import("../../packages/contracts/interaction-broker.ts");
const { InteractionBroker } = await import("../../packages/interactions/broker.ts");
const { InteractionBrokerService, interactionCaller } = await import("../../packages/interactions/service.ts");
afterAll(restoreFixture);

async function publicPages(broker: InstanceType<typeof InteractionBroker>,
  beforeInvoke: (method: string, args: Readonly<Record<string, unknown>>, binding: PageBinding) =>
    Promise<void> = async () => {}) {
  const host = new Context();
  await host.plugin(HostRegistry); await host.plugin(RemoteAccess); await host.plugin(TypertGatewayService, {});
  host.typert.register(brokerHostContribution); new InteractionBrokerService(host, broker);
  const clients: InstanceType<typeof Context>[] = [], peers: InstanceType<typeof Peer>[] = [];
  async function page(clientId: string, credentialId = "credential", bindingPeerId?: string) {
    const peer = new Peer(host, { principal: { kind: "owner" } }); peers.push(peer);
    const binding = broker.attach({ credentialId, clientId, peerId: bindingPeerId ?? peer.id });
    const ctx = new Context(); clients.push(ctx);
    installConnection(ctx, { interactions: "none", transport: { fetch: async (_url, init) => {
      const envelope = clientRequestSchema.parse(JSON.parse(String(init.body)));
      const descriptor = brokerContribution.methods[envelope.method];
      if (!descriptor) throw new Error("UNKNOWN_REMOTE");
      const payload = z.object({ args: z.record(z.string(), z.unknown()) }).parse(envelope.payload);
      const args = z.record(z.string(), z.unknown()).parse(descriptor.input({ strict: true }).create().parse(payload.args));
      const method = envelope.method.split("/")[1]; if (!method) throw new Error("UNKNOWN_REMOTE");
      await beforeInvoke(method, args, binding);
      const value = await interactionCaller.run(binding, () => host.typertGateway.invoke({ namespace: "ompInteractionBroker",
        method, args, peer, signal: new AbortController().signal }));
      return Response.json({ type: "server-response", rpcId: envelope.rpcId, result: { ok: true, value } });
    }, openStream: async function* () {} } });
    registry(ctx); gateway(ctx); await ctx.remote.$mount(brokerContribution);
    return { remote: ctx.remote.ompInteractionBroker, binding };
  }
  return { page, async dispose() {
    broker.close(); for (const ctx of clients) await ctx.fiber.dispose();
    for (const peer of peers) await peer.dispose(); await host.fiber.dispose();
  } };
}
function ready(broker: InstanceType<typeof InteractionBroker>) {
  broker.receive({ type: "ready", interactionPolicy: { version: "1", explicitAnswersOnly: true,
    nativeExpiry: "cancel", toolExpiry: "cancel", invalidAnswer: "pending" } });
}
async function within<T>(promise: Promise<T>, phase: string): Promise<T> {
  const timeout = Promise.withResolvers<never>();
  const timer = setTimeout(() => timeout.reject(new Error(`Timed out waiting for ${phase}`)), 2_000);
  try {
    return await Promise.race([promise, timeout.promise]);
  } finally { clearTimeout(timer); }
}

test("a current Broker page cannot be used by a different Gateway Peer", async () => {
  const broker = new InteractionBroker({ kind: "startup", contextId: "controlled-startup" }, "worker", "root", {
    respondUi: async () => { throw new Error("UNEXPECTED_NATIVE_COMMAND"); }, requestStop: async () => {},
  }, () => true);
  ready(broker);
  const fixture = await publicPages(broker);
  try {
    const current = await fixture.page("current");
    const mismatched = await fixture.page("mismatched", "other-credential", current.binding.peerId);
    expect(await current.remote.pending()).toMatchObject({ ok: true });
    expect(await mismatched.remote.pending()).toMatchObject({ ok: false });
  } finally { await fixture.dispose(); }
});

test("two current public Remote pages race: the loser is stale before the winner receives its Native acknowledgement", async () => {
  const arrived = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>(), reply = Promise.withResolvers<{ status: "answered" }>();
  const arrivals: string[] = [], completions: string[] = [], commands: RespondUiParams[] = [];
  let racing = false;
  const broker = new InteractionBroker({ kind: "session", sessionId: "native-session" }, "worker-1", "agent-scope", {
    respondUi: async command => {
      commands.push(command);
      entered.resolve();
      return reply.promise;
    }, requestStop: async () => {},
  }, () => true);
  ready(broker);
  const fixture = await publicPages(broker, async (method, _args, binding) => {
    if (method !== "answer" || !racing) return;
    arrivals.push(binding.peerId);
    if (arrivals.length === 2) arrived.resolve();
    await release.promise;
  });
  const { page } = fixture;
  try {
    const first = await page("page-a"), second = await page("page-b");
    broker.receive({ type: "extension_ui_request", id: "ui-1", method: "select", title: "Approve", options: ["Allow", "Deny"] });
    const a = await first.remote.pending(), b = await second.remote.pending();
    if (!a.ok || !b.ok) throw new Error("PENDING_FAILED");
    const one = a.value.pending[0]!, two = b.value.pending[0]!;
    const crossPage = second.remote.answer(one.card.generation, one.card.id, one.deliveryId,
      { type: "value", value: "Allow" });
    expect(await within(crossPage, "cross-page delivery rejection")).toEqual({ ok: true, value: { status: "stale" } });
    const invalid = first.remote.answer(one.card.generation, one.card.id, one.deliveryId,
      { type: "value", value: "unknown" });
    expect(await within(invalid, "invalid answer rejection")).toEqual({ ok: true, value: { status: "invalid" } });
    racing = true;
    const submissions = [[first.remote, one, "Allow"], [second.remote, two, "Deny"]] as const;
    const answers = submissions.map(([remote, delivery, value]) =>
      remote.answer(delivery.card.generation, delivery.card.id, delivery.deliveryId, { type: "value", value })
        .then(result => { completions.push(value); return { value, result }; }));
    const firstCompletion = Promise.race(answers);
    // Attach an observer even if an arrival failure exits before the completion phase.
    void firstCompletion.catch(() => {});
    await within(arrived.promise, "two authenticated Remote arrivals");
    expect(arrivals.toSorted()).toEqual([first.binding.peerId, second.binding.peerId].toSorted());
    expect(commands).toEqual([]);
    release.resolve();

    const [, loser] = await within(Promise.all([entered.promise, firstCompletion]), "Native entry and stale Remote");
    expect(loser.result).toEqual({ ok: true, value: { status: "stale" } });
    expect(completions).toEqual([loser.value]);
    const winningValue = loser.value === "Allow" ? "Deny" : "Allow";
    expect(commands).toEqual([{ targetId: "ui-1", answer: { type: "value", value: winningValue } }]);

    reply.resolve({ status: "answered" });
    const settled = await within(Promise.all(answers), "winning Native acknowledgement");
    expect(settled.find(answer => answer.value === winningValue)?.result)
      .toEqual({ ok: true, value: { status: "answered" } });
    expect(commands).toHaveLength(1);
    for (const pending of await Promise.all([first.remote.pending(), second.remote.pending()])) {
      if (!pending.ok) throw new Error("PENDING_FAILED");
      expect(pending.value.pending).toEqual([]);
      expect(pending.value.outcomes).toEqual([
        { id: "ui-1", status: "answered", reason: "explicit-answer", stop: "none" },
      ]);
    }
    broker.receive({ type: "extension_ui_request", id: "ui-2", method: "input", title: "Explicit" });
    const old = await first.remote.pending(); if (!old.ok) throw new Error("PENDING_FAILED");
    const oldDelivery = old.value.pending[0]!;
    const refreshed = await page("page-a");
    expect(await first.remote.answer(oldDelivery.card.generation, oldDelivery.card.id, oldDelivery.deliveryId,
      { type: "value", value: "old peer" })).toEqual({ ok: true, value: { status: "stale" } });
    const current = await refreshed.remote.pending(); if (!current.ok) throw new Error("PENDING_FAILED");
    expect(current.value.pending[0]!.card.deadline).toBe(oldDelivery.card.deadline);
  } finally {
    release.resolve();
    reply.resolve({ status: "answered" });
    await fixture.dispose();
  }
}, 12_000);

test("Native invalid acknowledgement re-presents with a fresh delivery and original deadline; timer cancels without a default", async () => {
  let now = 0, permitted = true;
  const timers = new Set<() => void>(), commands: unknown[] = [], stops: string[] = [];
  const broker = new InteractionBroker({ kind: "session", sessionId: "session" }, "worker", "agent", {
    respondUi: async params => { commands.push(params); return { status: params.answer.type === "cancel" ? "expired" : "invalid" }; },
    requestStop: async reason => { stops.push(reason); },
  }, () => permitted, { now: () => now, wall: () => now, schedule: (_delay, callback) => {
    timers.add(callback); return () => { timers.delete(callback); };
  } });
  ready(broker); broker.configureWait(5000);
  const fixture = await publicPages(broker);
  try {
    const page = await fixture.page("page");
    broker.receive({ type: "extension_ui_request", id: "native-check", method: "input", title: "Explicit", timeout: 1000 });
    const state = await page.remote.pending(); if (!state.ok) throw new Error("PENDING_FAILED");
    const delivery = state.value.pending[0]!;
    expect(delivery.card.deadline).toBe(1000);
    expect(await page.remote.answer(delivery.card.generation, delivery.card.id, delivery.deliveryId, { type: "value", value: "needs-native-validation" }))
      .toEqual({ ok: true, value: { status: "invalid" } });
    const replay = await page.remote.pending(); if (!replay.ok) throw new Error("PENDING_FAILED");
    expect(replay.value.pending[0]!.deliveryId).not.toBe(delivery.deliveryId);
    expect(replay.value.pending[0]!.card.deadline).toBe(1000);
    permitted = false;
    expect(await page.remote.answer(replay.value.pending[0]!.card.generation, "native-check", replay.value.pending[0]!.deliveryId,
      { type: "value", value: "revoked current permission" })).toEqual({ ok: true, value: { status: "stale" } });
    permitted = true; now = 1000;
    for (const callback of [...timers]) callback();
    const ended = await page.remote.pending(); if (!ended.ok) throw new Error("PENDING_FAILED");
    expect(ended.value.pending).toEqual([]);
    expect(commands).toEqual([{ targetId: "native-check", answer: { type: "value", value: "needs-native-validation" } },
      { targetId: "native-check", answer: { type: "cancel", timedOut: true } }]);
    expect(stops).toEqual(["expired"]);
  } finally { await fixture.dispose(); }
});

test.each(["cancel", "native-cancel", "expiry", "scope-revoke", "credential-revoke"] as const)(
  "overlapping Remote arrivals cannot defeat %s; other credentials retain only current rights", async control => {
  let now = 0, permitted = true;
  const gate = Promise.withResolvers<void>(), arrived = Promise.withResolvers<void>(); let arrivals = 0;
  const commands: unknown[] = [], stops: string[] = [];
  const broker = new InteractionBroker({ kind: "session", sessionId: "native-session" }, "worker", "agent", {
    respondUi: async params => { commands.push(params); return { status: params.answer.type === "cancel" && params.answer.timedOut
      ? "expired" : params.answer.type === "cancel" ? "cancelled" : "answered" }; },
    requestStop: async reason => { stops.push(reason); },
  }, page => permitted && page.credentialId !== "revoked", { now: () => now, wall: () => now,
    schedule: () => () => {} });
  ready(broker);
  const fixture = await publicPages(broker, async (method, args) => {
    if (method !== "answer" || z.object({ type: z.string() }).parse(args.answer).type === "cancel") return;
    if (++arrivals === 2) arrived.resolve();
    await gate.promise;
  });
  try {
    const a = await fixture.page("a"), b = await fixture.page("b");
    broker.receive({ type: "extension_ui_request", id: "ui", method: "input", title: "Explicit" });
    const [one, two] = await Promise.all([a.remote.pending(), b.remote.pending()]);
    if (!one.ok || !two.ok) throw new Error("PENDING_FAILED");
    const first = one.value.pending[0]!, second = two.value.pending[0]!;
    const answers = [a.remote.answer(first.card.generation, "ui", first.deliveryId, { type: "value", value: "arrival-a" }),
      b.remote.answer(second.card.generation, "ui", second.deliveryId, { type: "value", value: "arrival-b" })];
    await arrived.promise; // Both public Client arrivals are active before the competing event.
    if (control === "cancel") expect(await a.remote.answer(first.card.generation, "ui", first.deliveryId, { type: "cancel" }))
      .toEqual({ ok: true, value: { status: "cancelled" } });
    if (control === "native-cancel") broker.receive({ type: "extension_ui_request", id: "notice", method: "cancel", targetId: "ui", reason: "aborted" });
    if (control === "expiry") now = 1_800_000;
    if (control === "scope-revoke") { permitted = false; await broker.revokeScope(); }
    if (control === "credential-revoke") broker.revokeCredential("credential");
    gate.resolve();
    const results = (await Promise.all(answers)).map(result => result.ok && result.value.status).sort();
    expect(results).toEqual(control === "expiry" ? ["expired", "stale"] : ["stale", "stale"]);
    expect(commands).toEqual(["cancel", "expiry", "scope-revoke"].includes(control)
      ? [{ targetId: "ui", answer: control === "expiry" ? { type: "cancel", timedOut: true } : { type: "cancel" } }] : []);
    expect(stops).toEqual(control === "expiry" ? ["expired"] : control === "scope-revoke" ? ["authority-revoked"] : []);
    if (control === "credential-revoke") {
      const other = await fixture.page("other", "other-credential");
      const pending = await other.remote.pending(); if (!pending.ok) throw new Error("PENDING_FAILED");
      expect(pending.value.pending[0]!.card.id).toBe("ui");
    }
  } finally { gate.resolve(); await fixture.dispose(); }
});

test("all-page disconnect keeps startup UI alive until its original absolute 30-minute deadline; expiry requests Stop", async () => {
  let now = 0;
  const timers = new Set<{ at: number; callback: () => void }>();
  const commands: unknown[] = [], stops: string[] = [];
  const broker = new InteractionBroker({ kind: "startup", contextId: "controlled-startup" }, "worker-1", "root", {
    respondUi: async params => { commands.push(params); return { status: "expired" }; },
    requestStop: async reason => { stops.push(reason); },
  }, () => true, { now: () => now, wall: () => 1000 + now, schedule(delay, callback) {
    const timer = { at: now + delay, callback }; timers.add(timer); return () => { timers.delete(timer); };
  } });
  ready(broker);
  const fixture = await publicPages(broker);
  try {
    const first = await fixture.page("first");
    broker.receive({ type: "extension_ui_request", id: "startup", method: "input", title: "Startup" });
    const original = await first.remote.pending(); if (!original.ok) throw new Error("PENDING_FAILED");
    expect(original.value.scope).toEqual({ kind: "startup", contextId: "controlled-startup" });
    expect(original.value.pending[0]!.card.deadline).toBe(1_801_000);
    broker.disconnect(first.binding); now = 1_700_000;
    broker.configureWait(60_000); // Affects only future interactions.
    expect(commands).toEqual([]); expect(stops).toEqual([]);
    const reconnected = await fixture.page("new-client");
    const replay = await reconnected.remote.pending(); if (!replay.ok) throw new Error("PENDING_FAILED");
    const delivery = replay.value.pending[0]!;
    expect(delivery.card.deadline).toBe(1_801_000);
    expect(delivery.deliveryId).not.toBe(original.value.pending[0]!.deliveryId);
    now = 1_800_000; // Timer delivery is deliberately late; admission must check the clock itself.
    expect(await reconnected.remote.answer(delivery.card.generation, delivery.card.id, delivery.deliveryId,
      { type: "value", value: "too late" })).toEqual({ ok: true, value: { status: "expired" } });
    for (const timer of [...timers]) if (timer.at <= now) timer.callback();
    expect(commands).toEqual([{ targetId: "startup", answer: { type: "cancel", timedOut: true } }]);
    expect(stops).toEqual(["expired"]);
    const ended = await reconnected.remote.pending(); if (!ended.ok) throw new Error("PENDING_FAILED");
    expect(ended.value.pending).toEqual([]);
    expect(ended.value.accepting).toBe(false);
    expect(ended.value.outcomes.some(outcome => outcome.reason === "expired" && outcome.stop === "acknowledged")).toBe(true);
  } finally { await fixture.dispose(); }
});

test("lost Native acknowledgement stays unknown, requests Stop and cannot revive after worker replacement or tool/URI IDs", async () => {
  const stops: string[] = [], commands: unknown[] = [];
  const broker = new InteractionBroker({ kind: "session", sessionId: "native-session" }, "worker-old", "agent", {
    respondUi: async params => { commands.push(params); throw new Error("synthetic lost acknowledgement"); },
    requestStop: async reason => { stops.push(reason); },
  }, () => true);
  ready(broker);
  const fixture = await publicPages(broker);
  try {
    const page = await fixture.page("current");
    broker.receive({ type: "host_tool_call", id: "tool", toolName: "synthetic", args: {} });
    broker.receive({ type: "host_uri_request", id: "uri", operation: "read", url: "synthetic://resource" });
    broker.receive({ type: "extension_ui_request", id: "ask", method: "ask", questions: [
      { id: "one", question: "Choose", options: [{ label: "Exact" }, { label: "Other" }], multi: false },
      { id: "two", question: "Describe", options: [] },
    ] });
    const state = await page.remote.pending(); if (!state.ok) throw new Error("PENDING_FAILED");
    expect(state.value.pending.map(delivery => delivery.card.id)).toEqual(["ask"]);
    const delivery = state.value.pending[0]!;
    for (const answers of [
      [{ id: "two", selectedOptions: [], customInput: "text" }, { id: "one", selectedOptions: ["Exact"] }],
      [{ id: "one", selectedOptions: ["Exact", "Other"] }, { id: "two", selectedOptions: [], customInput: "text" }],
      [{ id: "one", selectedOptions: ["Unknown"] }, { id: "two", selectedOptions: [] }],
    ]) expect(await page.remote.answer(delivery.card.generation, "ask", delivery.deliveryId, { type: "ask", answers }))
      .toEqual({ ok: true, value: { status: "invalid" } });
    expect(await page.remote.answer(delivery.card.generation, "ask", delivery.deliveryId, { type: "ask", answers: [
      { id: "one", selectedOptions: ["Exact"] }, { id: "two", selectedOptions: [], customInput: "explicit text" },
    ] })).toEqual({ ok: true, value: { status: "unknown" } });
    expect(commands).toHaveLength(1);
    expect(stops).toEqual(["native-reply-lost"]);
    broker.close();
    const replacement = new InteractionBroker({ kind: "session", sessionId: "native-session" }, "worker-new", "agent", {
      respondUi: async () => { throw new Error("MUST_NOT_REPLAY"); }, requestStop: async () => {},
    }, () => true);
    ready(replacement);
    const replacementPage = replacement.attach({ credentialId: "credential", clientId: "current", peerId: "new-peer" });
    expect(replacement.pending(replacementPage).pending).toEqual([]);
    expect(await replacement.answer(replacementPage, delivery.card.generation, "ask", delivery.deliveryId,
      { type: "value", value: "old worker" })).toEqual({ status: "stale" });
    replacement.close();
  } finally { await fixture.dispose(); }
});

test.each(["timer", "late-invalid"] as const)("a held Native acknowledgement cannot suspend the deadline (%s)", async trigger => {
  let now = 0;
  const timers = new Set<() => void>(), commands: unknown[] = [], stops: string[] = [];
  const held = Promise.withResolvers<{ status: "invalid" }>(), entered = Promise.withResolvers<void>();
  const broker = new InteractionBroker({ kind: "session", sessionId: "session" }, "worker", "agent", {
    respondUi: async params => {
      commands.push(params);
      if (params.answer.type === "cancel") return { status: "expired" };
      entered.resolve(); return held.promise;
    }, requestStop: async reason => { stops.push(reason); },
  }, () => true, { now: () => now, wall: () => now, schedule: (_delay, callback) => {
    timers.add(callback); return () => { timers.delete(callback); };
  } });
  ready(broker);
  const fixture = await publicPages(broker);
  try {
    const page = await fixture.page("page");
    broker.receive({ type: "extension_ui_request", id: "held", method: "input", title: "Explicit" });
    const state = await page.remote.pending(); if (!state.ok) throw new Error("PENDING_FAILED");
    const delivery = state.value.pending[0]!;
    const answer = page.remote.answer(delivery.card.generation, "held", delivery.deliveryId, { type: "value", value: "chosen before deadline" });
    await entered.promise; now = 1_800_000;
    if (trigger === "timer") for (const timer of [...timers]) timer();
    held.resolve({ status: "invalid" });
    expect(await answer).toEqual({ ok: true, value: { status: "invalid" } });
    expect(stops).toEqual(["expired"]);
    expect(commands).toEqual([{ targetId: "held", answer: { type: "value", value: "chosen before deadline" } },
      { targetId: "held", answer: { type: "cancel", timedOut: true } }]);
    const ended = await page.remote.pending(); if (!ended.ok) throw new Error("PENDING_FAILED");
    expect(ended.value.pending).toEqual([]); expect(ended.value.accepting).toBe(false);
    expect(await page.remote.answer(delivery.card.generation, "held", delivery.deliveryId, { type: "value", value: "late retry" }))
      .toEqual({ ok: true, value: { status: "stale" } });
  } finally { held.resolve({ status: "invalid" }); await fixture.dispose(); }
});

test("credential revocation during a held answer fences the old view while preserving the actual Native outcome", async () => {
  const entered = Promise.withResolvers<void>(), held = Promise.withResolvers<{ status: "answered" }>();
  const broker = new InteractionBroker({ kind: "session", sessionId: "session" }, "worker", "agent", {
    respondUi: async () => { entered.resolve(); return held.promise; }, requestStop: async () => {},
  }, () => true);
  ready(broker); const fixture = await publicPages(broker);
  try {
    const page = await fixture.page("a"), other = await fixture.page("b", "other-credential");
    broker.receive({ type: "extension_ui_request", id: "held", method: "input", title: "Explicit" });
    const state = await page.remote.pending(); if (!state.ok) throw new Error("PENDING_FAILED");
    const delivery = state.value.pending[0]!;
    const answer = page.remote.answer(delivery.card.generation, "held", delivery.deliveryId, { type: "value", value: "explicit" });
    await entered.promise; broker.revokeCredential("credential"); held.resolve({ status: "answered" });
    expect(await answer).toEqual({ ok: true, value: { status: "stale" } });
    const current = await other.remote.pending(); if (!current.ok) throw new Error("PENDING_FAILED");
    expect(current.value.pending).toEqual([]);
    expect(current.value.outcomes).toEqual([{ id: "held", status: "answered", reason: "explicit-answer", stop: "none" }]);
  } finally { held.resolve({ status: "answered" }); await fixture.dispose(); }
});
