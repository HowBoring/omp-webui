import { expect, test } from "bun:test";
import { Context } from "@deepseek-ai/cordis";
import TypertRegistry from "@deepseek-ai/dsh-typert-registry";
import RemoteAccessService from "@deepseek-ai/dsh-api-remote-access";
import { TypertGatewayService } from "@deepseek-ai/dsh-api-gateway";
import { chatHostContribution, chatRecovery } from "../../packages/contracts/chat.ts";
import { chatViewCaller, ChatLookupService, ChatPromptService } from "../../packages/chat/service.ts";
import { Peer } from "@deepseek-ai/dsh-client-connection";
import { parseProjectionBinding } from "@deepseek-ai/dsh-api-session-controller/projection";
import type { SessionPromptRequest } from "@deepseek-ai/dsh-api-session-controller/types";
import sessionContribution from "@deepseek-ai/dsh-api-session-controller/remote";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { ChatError, ChatGateway, type ChatCaller, type ChatWorkerPort } from "../../packages/chat/gateway.ts";
import type { SubmissionClientCommand } from "../../packages/contracts/candidates/durable-submission-v1/submission-client.ts";
import type { SubmissionResult } from "../../packages/contracts/candidates/durable-submission-v1/omp-wire.ts";
import type { StopSnapshot } from "../../packages/contracts/stop.ts";
import { brandString, type Branded } from "@deepseek-ai/dsh-brand";

const target = { sourceId: "a".repeat(64), instanceId: "b".repeat(64), nativeSessionId: "native" };
const sessionId = SessionId("native");
const projection = parseProjectionBinding({ source: "projection-source", generation: "projection-1" });
const pending = { interactions: 0, history: 0, queued: 0, other: 0 };
const idle = { sessionId: target.nativeSessionId, isSettled: true, isStreaming: false, isCompacting: false, hasPendingAsyncWork: false,
  queuedMessageCount: 0, queuedMessages: { steering: [], followUp: [] } };

function prompt(id: string, text = "  /help\n@literal  "): SessionPromptRequest {
  return { requestId: id as SessionPromptRequest["requestId"], sessionId, projection, mode: "queue",
    content: [{ type: "text", text }] };
}

function receipt(requestId: string, overrides: Partial<SubmissionResult> = {}): SubmissionResult {
  return { version: "durable-submission-v1", clientSubmissionId: requestId, target, found: true, duplicate: false,
    admission: "local", origin: { ...target, clientSubmissionId: requestId }, reservation: "committed",
    operationOutcome: "unknown", inputOutcome: "unresolved", terminal: false, persistence: "unresolved",
    relations: [], nextOffset: null, ...overrides };
}

const input = { relationId: "entry:real-input", role: "input", status: "observed", persistence: "committed",
  entryId: "real-input", availability: "retained" } as const;

function fixture() {
  const commands: SubmissionClientCommand[] = [];
  const host = new Context();
  const newPeer = () => new Peer(host, { principal: { kind: "owner" }, interactions: "none" });
  const authority = new AbortController(), worker = new AbortController();
  const stop: StopSnapshot = { generation: "stop-1", workerGeneration: "worker-1",
    scope: { kind: "session", sessionId }, status: "idle", nativeSettled: true, acceptingWork: true,
    pending: { ...pending }, failures: [], forceAvailable: false, restored: null, draftConflict: false };
  let readState: ChatWorkerPort["state"] = async () => idle;
  let currentProjection = projection;
  const views = new Map<object, { peer: Peer; owner: string }>();
  function reconnect(owner = "browser-a/tab-a/draft-a", peer = newPeer()) {
    const view = {};
    views.set(view, { peer, owner });
    return { peer, view } satisfies ChatCaller;
  }
  const peer = reconnect();
  let reply = async (command: SubmissionClientCommand): Promise<unknown> => receipt(command.clientSubmissionId,
    command.type === "submission_query" ? { inputOutcome: "generated", relations: [input] } : {});
  let raw: ((command: SubmissionClientCommand) => Promise<unknown>) | undefined;
  const ports: ChatWorkerPort = {
    sessionId, generation: "worker-1", target, lifetime: worker.signal, matchedCohort: "SYNTHETIC_SOURCE_FIXTURE",
    authorize: (caller, requested) => {
      const bound = views.get(caller.view);
      if (!bound || bound.peer !== caller.peer || requested !== sessionId) return;
      return { owner: bound.owner, lifetime: authority.signal, projection: currentProjection };
    },
    stop: () => stop,
    state: () => readState(),
    cancel: async () => ({}),
    async request(command) {
      commands.push(structuredClone(command));
      if (raw) return raw(command);
      return { type: "response", id: command.id, command: command.type, success: true, data: await reply(command) };
    },
  };
  return { gateway: new ChatGateway(ports), host, peer, worker, authority, stop, commands, ports, reconnect,
    state: (callback: typeof readState) => { readState = callback; },
    reply: (callback: typeof reply) => { reply = callback; },
    raw: (callback: typeof raw) => { raw = callback; },
    changeProjection: () => { currentProjection = parseProjectionBinding({ ...projection, generation: "projection-2" }); },
    setProjection: (next: typeof projection) => { currentProjection = next; },
  };
}

test("the Chat Gateway accepts an exact committed input through public idle-only RPC", async () => {
  const f = fixture();
  expect(await f.gateway.prompt(f.peer, prompt("request-a"), new AbortController().signal)).toEqual({ accepted: true });
  expect(f.commands).toEqual([
    { type: "submission_submit", id: "request-a", clientSubmissionId: "request-a", ...target,
      preparationId: "text-v1:request-a", inputType: "prompt", idleOnly: true, message: "  /help\n@literal  " },
    { type: "submission_query", id: expect.any(String), clientSubmissionId: "request-a", limit: 128 },
  ]);
  expect(f.commands[1]?.id).not.toBe("request-a");
});

test("an attachment attempt is handed to the gate, never resubmitted as text", async () => {
  const f = fixture();
  const calls: [string, string][] = [];
  Object.defineProperty(f.ports, "attachments", { configurable: true, value: {
    has: (requestId: string) => requestId === "request-image",
    async submit(requestId: string, message: string) { calls.push([requestId, message]); },
    recovery: () => "accepted" as const,
  } });
  expect(await f.gateway.prompt(f.peer, prompt("request-image"), new AbortController().signal)).toEqual({ accepted: true });
  expect(calls).toEqual([["request-image", "  /help\n@literal  "]]);
  expect(f.commands.filter(command => command.type === "submission_submit")).toHaveLength(0);
});

test("the stock Continue generating prompt retries through the manual-retry gate, not a new turn", async () => {
  const f = fixture();
  let retried = 0;
  f.ports.retry = async () => { retried++; };
  expect(await f.gateway.prompt(f.peer, prompt("request-continue", "   "), new AbortController().signal))
    .toEqual({ accepted: true });
  expect(retried).toBe(1);
  expect(f.commands.filter(command => command.type === "submission_submit")).toHaveLength(0);
  const bare = fixture();
  await expect(bare.gateway.prompt(bare.peer, prompt("request-continue", ""), new AbortController().signal))
    .rejects.toThrow("chat_invalid");
});

test("a busy native Session refuses an attachment Send before preparing, queueing, or submitting", async () => {
  const f = fixture();
  let submitted = 0;
  Object.defineProperty(f.ports, "attachments", { configurable: true, value: {
    has: () => true, async submit() { submitted++; }, recovery: () => "unresolved" as const,
  } });
  f.state(async () => ({ ...idle, isSettled: false, isStreaming: true }));
  await expect(f.gateway.prompt(f.peer, prompt("request-image"), new AbortController().signal))
    .rejects.toThrow("chat_busy");
  expect(submitted).toBe(0);
  expect(f.commands.filter(command => command.type === "submission_submit")).toHaveLength(0);
});

test("a synchronous builtin can settle with a complete paged no-input proof for its original projection", async () => {
  const f = fixture();
  const effects = Array.from({ length: 128 }, (_, i) => ({ relationId: `effect:${i}`, role: "effect",
    status: "no_entry" as const, persistence: "committed" as const }));
  f.reply(async command => receipt(command.clientSubmissionId, {
    terminal: true, persistence: "committed", operationOutcome: "succeeded", inputOutcome: "no_input",
    ...(command.type === "submission_query" && command.offset === undefined
      ? { relations: effects, nextOffset: 128 }
      : command.type === "submission_query" ? { relations: [{ ...effects[0]!, relationId: "effect:128" }] } : {}),
  }));
  const signal = new AbortController().signal;
  expect(await f.gateway.prompt(f.peer, prompt("builtin"), signal)).toEqual({
    accepted: true, noInput: { requestId: "builtin", projection },
  });
  expect(await f.gateway.state(f.peer, sessionId, signal)).toMatchObject({
    settled: true, inputOutcome: "no_input", operationOutcome: "succeeded",
  });
  f.changeProjection();
  expect(await f.gateway.lookup(f.peer, sessionId, "builtin", signal)).toEqual({
    outcome: "completed-without-input", noInput: { requestId: "builtin", projection },
  });
  expect(f.commands.filter(command => command.type === "submission_submit")).toHaveLength(1);
});

async function mountGateway(f: ReturnType<typeof fixture>) {
  await f.host.plugin(TypertRegistry);
  await f.host.plugin(RemoteAccessService);
  await f.host.plugin(TypertGatewayService, {});
  f.host.typert.register(chatHostContribution);
  const promptDescriptor = sessionContribution.descriptors.find(descriptor =>
    descriptor.namespace === "session" && descriptor.method === "prompt");
  if (!promptDescriptor) throw new Error("Missing DSH session/prompt descriptor");
  f.host.typert.register({ package: sessionContribution.package, face: "host", schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: [...sessionContribution.descriptors.filter(descriptor => descriptor !== promptDescriptor),
      { ...promptDescriptor, service: "chatPrompt" }] });
  new ChatPromptService(f.host, id => id === sessionId ? f.gateway : undefined);
  new ChatLookupService(f.host, id => id === sessionId ? f.gateway : undefined);
  const method = sessionContribution.methods["session/prompt"];
  if (!method) throw new Error("Missing DSH session/prompt");
  const unboundPrompt = (caller: ChatCaller, request: SessionPromptRequest) => {
    const args = method.input({ strict: true }).create().parse({ request }) as Record<string, unknown>;
    return f.host.typertGateway.invoke({ namespace: "session", method: "prompt", args, peer: caller.peer });
  };
  return {
    unboundPrompt,
    prompt: (caller: ChatCaller, request: SessionPromptRequest) => chatViewCaller.run(caller.view, () =>
      unboundPrompt(caller, request)),
    lookup: (caller: ChatCaller, requestId: string) => chatViewCaller.run(caller.view, () =>
      f.host.typertGateway.invoke({
        namespace: "ompChat", method: "lookup", args: { sessionId, requestId }, peer: caller.peer,
      })),
    state: (caller: ChatCaller) => chatViewCaller.run(caller.view, () =>
      f.host.typertGateway.invoke({ namespace: "ompChat", method: "state", args: { sessionId }, peer: caller.peer })),
  };
}

test("the DSH Gateway exposes only authorized state and exact lookup", async () => {
  const f = fixture(), remote = await mountGateway(f);
  await expect(remote.unboundPrompt(f.peer, prompt("visible"))).rejects.toThrow();
  expect(f.commands).toEqual([]);
  expect(await remote.prompt(f.peer, prompt("visible"))).toEqual({ accepted: true });
  const otherTab = f.reconnect("browser-a/tab-b/draft-b", f.peer.peer);
  expect(otherTab.peer).toBe(f.peer.peer);
  expect(await Promise.all([remote.lookup(f.peer, "visible"), remote.lookup(otherTab, "visible")]))
    .toEqual([{ outcome: "accepted" }, { outcome: "unknown" }]);
  expect(await remote.lookup(f.peer, "never-issued")).toEqual({ outcome: "unknown" });
  expect(f.commands.some(command => command.clientSubmissionId === "never-issued")).toBe(false);
  f.authority.abort();
  await expect(remote.lookup(f.peer, "visible")).rejects.toThrow();
});

test("joint host or Native busy refuses queue and steer without a dispatch and consumes that refusal key", async () => {
  const f = fixture(), signal = new AbortController().signal;
  f.stop.pending.interactions = 1;
  await expect(f.gateway.prompt(f.peer, prompt("queued"), signal)).rejects.toThrow("chat_busy");
  f.stop.pending.interactions = 0;
  f.state(async () => ({ ...idle, queuedMessageCount: 1 }));
  await expect(f.gateway.prompt(f.peer, { ...prompt("steer"), mode: "steer" }, signal)).rejects.toThrow("chat_busy");
  f.state(async () => idle);
  expect(await f.gateway.lookup(f.peer, sessionId, "queued", signal)).toEqual({ outcome: "not-submitted" });
  await expect(f.gateway.prompt(f.peer, prompt("queued"), signal)).rejects.toThrow("chat_busy");
  expect(f.commands).toEqual([]);
});

test("a second Browser View cannot queue while Native idle is being checked", async () => {
  const f = fixture(), signal = new AbortController().signal, second = f.reconnect("browser-a/tab-b/draft-b");
  const state = Promise.withResolvers<typeof idle>();
  f.state(() => state.promise);
  const first = f.gateway.prompt(f.peer, prompt("first"), signal);
  expect(f.gateway.blocksAdmission).toBe(true);
  await expect(f.gateway.prompt(second, prompt("second"), signal)).rejects.toThrow("chat_busy");
  expect(await f.gateway.lookup(f.peer, sessionId, "second", signal)).toEqual({ outcome: "unknown" });
  state.resolve(idle);
  expect(await first).toEqual({ accepted: true });
  expect(await f.gateway.lookup(second, sessionId, "second", signal)).toEqual({ outcome: "not-submitted" });
  expect(f.commands.filter(command => command.type === "submission_submit").map(command => command.clientSubmissionId))
    .toEqual(["first"]);
});

test("projection replacement during the idle check cannot dispatch bytes from the retired View", async () => {
  const f = fixture(), signal = new AbortController().signal;
  f.state(async () => { f.changeProjection(); return idle; });
  await expect(f.gateway.prompt(f.peer, prompt("stale"), signal)).rejects.toThrow("chat_authority");
  expect(f.commands).toEqual([]);
  expect(await f.gateway.lookup(f.peer, sessionId, "stale", signal)).toEqual({ outcome: "not-submitted" });
});

test("disconnect before the reply preserves one dispatch for the same worker and fences other drafts", async () => {
  const f = fixture(), signal = new AbortController().signal, sent = Promise.withResolvers<void>();
  const submit = Promise.withResolvers<void>();
  f.reply(async command => {
    if (command.type === "submission_submit") { sent.resolve(); await submit.promise; }
    return receipt(command.clientSubmissionId, command.type === "submission_query"
      ? { inputOutcome: "generated", relations: [input] } : {});
  });
  const invocation = new AbortController();
  const first = f.gateway.prompt(f.peer, prompt("reconnect"), invocation.signal);
  await sent.promise;
  invocation.abort();
  submit.resolve();
  await expect(first).rejects.toThrow("chat_authority");
  const second = f.reconnect(), third = f.reconnect("browser-a/tab-b/draft-b");
  expect(await f.gateway.lookup(third, sessionId, "reconnect", signal)).toEqual({ outcome: "unknown" });
  expect(await f.gateway.lookup(second, sessionId, "reconnect", signal)).toEqual({ outcome: "accepted" });
  await expect(f.gateway.prompt(second, prompt("reconnect", "changed"), signal)).rejects.toThrow("chat_conflict");
  expect(f.commands.filter(command => command.type === "submission_submit")).toHaveLength(1);
});

test("a lost submission reply and absent Native record stay unknown with no replay or continuation", async () => {
  const f = fixture(), signal = new AbortController().signal;
  f.reply(async command => {
    if (command.type === "submission_submit") throw new Error("RPC_EOF");
    const absent = receipt(command.clientSubmissionId, {
      found: false, admission: "absent", reservation: "absent",
    });
    delete absent.origin;
    return absent;
  });
  await expect(f.gateway.prompt(f.peer, prompt("lost"), signal)).rejects.toThrow("chat_unknown");
  expect(await f.gateway.lookup(f.peer, sessionId, "lost", signal)).toEqual({ outcome: "unknown" });
  await expect(f.gateway.prompt(f.peer, prompt("new"), signal)).rejects.toThrow("chat_busy");
  expect(f.commands.filter(command => command.type === "submission_submit")).toHaveLength(1);
  f.worker.abort();
  await expect(f.gateway.lookup(f.reconnect(), sessionId, "lost", signal)).rejects.toThrow("chat_authority");
});

test.each([["error", "failed"], ["aborted", "cancelled"]] as const)(
  "committed input and %s execution are distinct from settled state", async (status, operationOutcome) => {
    const f = fixture(), signal = new AbortController().signal;
    let terminal = false;
    f.reply(async command => receipt(command.clientSubmissionId, command.type === "submission_submit" ? {} : {
      inputOutcome: "generated", relations: [input], terminal, operationOutcome: terminal ? operationOutcome : "unknown",
      persistence: terminal ? "committed" : "unresolved",
    }));
    expect(await f.gateway.prompt(f.peer, prompt("live"), signal)).toEqual({ accepted: true });
    terminal = true;
    f.gateway.observe({ type: "prompt_result", id: "other", agentInvoked: true, status, sessionSettled: true });
    expect(await f.gateway.state(f.peer, sessionId, signal)).toMatchObject({ settled: false, operationOutcome });
    f.gateway.observe({ type: "prompt_result", id: "live", agentInvoked: true, status, sessionSettled: false });
    f.state(async () => ({ ...idle, hasPendingAsyncWork: true }));
    expect(await f.gateway.state(f.peer, sessionId, signal)).toMatchObject({ settled: false, result: { status } });
    f.gateway.observe({ type: "session_settled" });
    f.state(async () => idle);
    expect(await f.gateway.state(f.peer, sessionId, signal)).toMatchObject({ settled: true, result: { status } });
    expect(await f.gateway.lookup(f.peer, sessionId, "live", signal)).toEqual({ outcome: "accepted" });
    expect(f.gateway.requestForOrigin({ ...target, clientSubmissionId: "live" }, "input")).toBe("live");
    expect(f.gateway.requestForOrigin({ ...target, clientSubmissionId: "live" }, "effect")).toBeUndefined();
    expect(f.gateway.requestForOrigin({ ...target, instanceId: "other", clientSubmissionId: "live" }, "input")).toBeUndefined();
  },
);

test("a paged Native no-input receipt containing later contradictory input stays unknown", async () => {
  const f = fixture(), signal = new AbortController().signal;
  f.reply(async command => receipt(command.clientSubmissionId, {
    terminal: true, persistence: "committed", operationOutcome: "succeeded", inputOutcome: "no_input",
    ...(command.type === "submission_query" && command.offset === undefined ? {
      nextOffset: 128,
      relations: Array.from({ length: 128 }, (_, i) => ({ relationId: `effect:${i}`, role: "effect",
        status: "no_entry" as const, persistence: "committed" as const })),
    } : command.type === "submission_query" ? { relations: [input] } : {}),
  }));
  await expect(f.gateway.prompt(f.peer, prompt("contradiction"), signal)).rejects.toThrow("chat_unknown");
  expect(await f.gateway.lookup(f.peer, sessionId, "contradiction", signal)).toEqual({ outcome: "unknown" });
  expect(await f.gateway.state(f.peer, sessionId, signal)).toMatchObject({ settled: false });
});

test("a duplicate Native submit cannot adopt an existing reservation or correlate a fresh echo", async () => {
  const f = fixture(), signal = new AbortController().signal;
  f.reply(async command => receipt(command.clientSubmissionId, command.type === "submission_submit"
    ? { duplicate: true } : { inputOutcome: "generated", relations: [input] }));
  await expect(f.gateway.prompt(f.peer, prompt("duplicate"), signal)).rejects.toThrow("chat_unknown");
  expect(await f.gateway.lookup(f.peer, sessionId, "duplicate", signal)).toEqual({ outcome: "unknown" });
  expect(f.gateway.requestForOrigin({ ...target, clientSubmissionId: "duplicate" }, "input")).toBeUndefined();
  expect(f.commands.map(command => command.type)).toEqual(["submission_submit"]);
});

test.each(["command", "rpc-id", "native-target", "origin", "native-key"] as const)(
  "an otherwise committed receipt with the wrong %s cannot accept the current input", async mismatch => {
    const f = fixture(), signal = new AbortController().signal;
    f.raw(async command => {
      const lookup = command.type === "submission_query";
      const data = receipt(command.clientSubmissionId, lookup ? { inputOutcome: "generated", relations: [input] } : {});
      if (lookup && mismatch === "native-target") data.target = { ...target, instanceId: "c".repeat(64) };
      if (lookup && mismatch === "origin") data.origin = { ...target, clientSubmissionId: "different" };
      if (lookup && mismatch === "native-key") data.clientSubmissionId = "different";
      return { type: "response", id: lookup && mismatch === "rpc-id" ? "different" : command.id,
        command: lookup && mismatch === "command" ? "submission_submit" : command.type, success: true, data };
    });
    await expect(f.gateway.prompt(f.peer, prompt("exact"), signal)).rejects.toThrow("chat_unknown");
    expect(await f.gateway.lookup(f.peer, sessionId, "exact", signal)).toEqual({ outcome: "unknown" });
    expect(f.commands.filter(command => command.type === "submission_submit")).toHaveLength(1);
  },
);

test("mixed attachments and empty continuation cannot become a text-only submission", async () => {
  const f = fixture(), signal = new AbortController().signal;
  await expect(f.gateway.prompt(f.peer, {
    ...prompt("attachment"), content: [{ type: "text", text: "keep whole input" },
      { type: "image", mediaType: "image/png", data: "AA==" }],
  }, signal)).rejects.toThrow("chat_invalid");
  await expect(f.gateway.prompt(f.peer, { ...prompt("empty"), content: [] }, signal)).rejects.toThrow("chat_invalid");
  expect(f.commands).toEqual([]);
});

test("a repeated identical request only observes the original Native key", async () => {
  const f = fixture(), signal = new AbortController().signal;
  for (const view of [f.peer, f.reconnect()]) {
    expect(await f.gateway.prompt(view, prompt("repeat"), signal)).toEqual({ accepted: true });
  }
  expect(f.commands.map(command => command.type)).toEqual(["submission_submit", "submission_query", "submission_query"]);
  Object.assign(f.ports, { target: { ...target, instanceId: "c".repeat(64) } });
  expect(f.gateway.requestForOrigin({ ...target, clientSubmissionId: "repeat" }, "input")).toBeUndefined();
  await expect(f.gateway.lookup(f.reconnect(), sessionId, "repeat", signal)).rejects.toThrow("chat_authority");
});

test("a conflicting reused key never adopts the older entry under changed text", async () => {
  const f = fixture(), signal = new AbortController().signal;
  f.raw(async command => command.type === "submission_submit"
    ? { type: "response", id: command.id, command: command.type, success: false,
      error: "SUBMISSION_CONFLICT", code: "SUBMISSION_CONFLICT" }
    : { type: "response", id: command.id, command: command.type, success: true,
      data: receipt(command.clientSubmissionId, { inputOutcome: "generated", relations: [input] }) });
  await expect(f.gateway.prompt(f.peer, prompt("reused", "different Native input"), signal)).rejects
    .toThrow("chat_conflict");
  expect(await f.gateway.lookup(f.peer, sessionId, "reused", signal)).toEqual({ outcome: "unknown" });
  await expect(f.gateway.prompt(f.peer, prompt("reused", "different Native input"), signal)).rejects
    .toThrow("chat_conflict");
  expect(f.gateway.requestForOrigin({ ...target, clientSubmissionId: "reused" }, "input")).toBeUndefined();
  expect(f.commands.map(command => command.type)).toEqual(["submission_submit"]);
});

test("losing a possible duplicate acknowledgement leaves same-key Native facts unbound", async () => {
  const f = fixture(), signal = new AbortController().signal;
  f.reply(async command => {
    if (command.type === "submission_submit") throw new Error("RPC_TIMEOUT");
    return receipt(command.clientSubmissionId, { inputOutcome: "generated", relations: [input] });
  });
  await expect(f.gateway.prompt(f.peer, prompt("unproved"), signal)).rejects.toThrow("chat_unknown");
  f.gateway.observe({ type: "prompt_result", id: "unproved", agentInvoked: true, status: "completed", sessionSettled: true });
  expect(await f.gateway.lookup(f.reconnect(), sessionId, "unproved", signal)).toEqual({ outcome: "unknown" });
  expect(await f.gateway.state(f.peer, sessionId, signal)).toEqual({
    requestId: "unproved", phase: "unknown", settled: false,
  });
  expect(f.gateway.requestForOrigin({ ...target, clientSubmissionId: "unproved" }, "input")).toBeUndefined();
  expect(f.commands.map(command => command.type)).toEqual(["submission_submit"]);
});

test("a paged agent-invoking builtin waits for its own result and fresh quiescence", async () => {
  const f = fixture(), signal = new AbortController().signal;
  const effect = { role: "effect", status: "no_entry", persistence: "committed" } as const;
  const invoked = { relationId: "request-input:invoked", role: "input", status: "no_entry",
    persistence: "committed", reason: "native_builtin_consumed" } as const;
  f.reply(async command => receipt(command.clientSubmissionId, {
    terminal: true, persistence: "committed", operationOutcome: "succeeded", inputOutcome: "no_input",
    ...(command.type === "submission_query" && command.offset === undefined
      ? { relations: Array.from({ length: 128 }, (_, i) => ({ ...effect, relationId: `effect:${i}` })), nextOffset: 128 }
      : command.type === "submission_query" ? { relations: [invoked] } : {}),
  }));
  await expect(f.gateway.prompt(f.peer, prompt("invoked"), signal)).rejects.toThrow("chat_unknown");
  f.gateway.observe({ type: "prompt_result", id: "other", agentInvoked: true, status: "completed", sessionSettled: true });
  expect(await f.gateway.state(f.peer, sessionId, signal)).toMatchObject({ settled: false });
  expect(await f.gateway.lookup(f.peer, sessionId, "invoked", signal)).toEqual({ outcome: "unknown" });
  f.gateway.observe({ type: "prompt_result", id: "invoked", agentInvoked: true, status: "completed", sessionSettled: false });
  f.state(async () => ({ ...idle, hasPendingAsyncWork: true }));
  expect(await f.gateway.lookup(f.peer, sessionId, "invoked", signal)).toEqual({ outcome: "unknown" });
  f.state(async () => idle);
  expect(await f.gateway.lookup(f.peer, sessionId, "invoked", signal)).toEqual({
    outcome: "completed-without-input", noInput: { requestId: "invoked", projection },
  });
  expect(await f.gateway.state(f.peer, sessionId, signal)).toMatchObject({ settled: true, result: { agentInvoked: true } });
});

test("a normal next prompt refreshes exact completion without a separate browser state call", async () => {
  const f = fixture(), signal = new AbortController().signal;
  let terminal = false;
  f.reply(async command => receipt(command.clientSubmissionId, command.type === "submission_submit" ? {} : {
    inputOutcome: "generated", relations: [input], terminal, operationOutcome: terminal ? "succeeded" : "unknown",
    persistence: terminal ? "committed" : "unresolved",
  }));
  expect(await f.gateway.prompt(f.peer, prompt("first"), signal)).toEqual({ accepted: true });
  terminal = true;
  f.gateway.observe({ type: "prompt_result", id: "first", agentInvoked: true, status: "completed", sessionSettled: true });
  expect(await f.gateway.prompt(f.peer, prompt("second"), signal)).toEqual({ accepted: true });
  expect(f.commands.filter(command => command.type === "submission_submit").map(command => command.clientSubmissionId))
    .toEqual(["first", "second"]);
});

test("parallel duplicate observations cannot start another Native lookup or poll chain", async () => {
  const f = fixture(), signal = new AbortController().signal, queryEntered = Promise.withResolvers<void>();
  const queryRelease = Promise.withResolvers<void>();
  f.reply(async command => {
    if (command.type === "submission_submit") return receipt(command.clientSubmissionId);
    queryEntered.resolve();
    await queryRelease.promise;
    return receipt(command.clientSubmissionId, { inputOutcome: "generated", relations: [input] });
  });
  const first = f.gateway.prompt(f.peer, prompt("parallel"), signal);
  await queryEntered.promise;
  const lookup = f.gateway.lookup(f.reconnect(), sessionId, "parallel", signal);
  const repeated = f.gateway.prompt(f.reconnect(), prompt("parallel"), signal).catch(() => "unknown");
  const observed = f.commands.map(command => command.type);
  queryRelease.resolve();
  expect(await first).toEqual({ accepted: true });
  expect(await lookup).toEqual({ outcome: "unknown" });
  expect(await repeated).toBe("unknown");
  expect(observed).toEqual(["submission_submit", "submission_query"]);
});

test("Native quiescence from a different Session cannot admit input or settle an existing attempt", async () => {
  const f = fixture(), signal = new AbortController().signal;
  f.state(async () => ({ ...idle, sessionId: "foreign" }));
  await expect(f.gateway.prompt(f.peer, prompt("mismatched"), signal)).rejects.toThrow("chat_busy");
  expect(f.commands).toEqual([]);
  f.state(async () => idle);
  f.reply(async command => receipt(command.clientSubmissionId, {
    inputOutcome: "no_input", operationOutcome: "succeeded", persistence: "committed", terminal: true,
  }));
  expect(await f.gateway.prompt(f.peer, prompt("current"), signal)).toMatchObject({ accepted: true });
  f.state(async () => ({ ...idle, sessionId: "foreign" }));
  expect(await f.gateway.state(f.peer, sessionId, signal)).toMatchObject({ settled: false });
  f.state(async () => idle);
  expect(await f.gateway.state(f.peer, sessionId, signal)).toMatchObject({ settled: true });
});

test("the public no-input recovery descriptor preserves the full DSH projection limit", async () => {
  const f = fixture(), signal = new AbortController().signal;
  const binding = { source: "s".repeat(512), generation: "g".repeat(512) };
  const original = parseProjectionBinding(binding);
  f.setProjection(original);
  f.reply(async command => receipt(command.clientSubmissionId, {
    inputOutcome: "no_input", operationOutcome: "succeeded", persistence: "committed", terminal: true,
  }));
  expect(await f.gateway.prompt(f.peer, { ...prompt("wide-projection"), projection: original }, signal))
    .toMatchObject({ accepted: true });
  const lookup = await f.gateway.lookup(f.peer, sessionId, "wide-projection", signal);
  expect(chatRecovery.parse(lookup)).toEqual({
    outcome: "completed-without-input", noInput: { requestId: "wide-projection", projection: binding },
  });
  expect(chatRecovery.safeParse({
    outcome: "completed-without-input",
    noInput: { requestId: "wide-projection", projection: { ...binding, source: "s".repeat(513) } },
  }).success).toBe(false);
});

test.each(["admitted", "conflict"] as const)(
  "an early lifecycle frame stays private until Native responds with %s", async outcome => {
    const f = fixture(), remote = await mountGateway(f);
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    f.raw(async command => {
      if (command.type === "submission_submit") {
        entered.resolve();
        await release.promise;
        if (outcome === "conflict") {
          return { type: "response", id: command.id, command: command.type, success: false,
            error: "SUBMISSION_CONFLICT", code: "SUBMISSION_CONFLICT" };
        }
      }
      return { type: "response", id: command.id, command: command.type, success: true,
        data: receipt(command.clientSubmissionId, command.type === "submission_query"
          ? { inputOutcome: "generated", relations: [input] } : {}) };
    });
    const submitted = remote.prompt(f.peer, prompt("early")).catch(() => "rejected");
    await entered.promise;
    f.gateway.observe({ type: "prompt_result", id: "early", agentInvoked: true, status: "completed", sessionSettled: true });
    const during = await remote.state(f.peer);
    release.resolve();
    expect(await submitted).toEqual(outcome === "admitted" ? { accepted: true } : "rejected");
    expect(during).toEqual({ requestId: "early", phase: "dispatching", settled: false });
    const after = await remote.state(f.peer);
    if (outcome === "admitted") {
      expect(after).toMatchObject({ phase: "admitted", result: { status: "completed", agentInvoked: true } });
    } else {
      expect(after).toEqual({ requestId: "early", phase: "unknown", settled: false });
      expect(await remote.lookup(f.peer, "early")).toEqual({ outcome: "unknown" });
    }
  },
);

test("after a terminal conflict a fresh Gateway request still needs current Native and Host idle", async () => {
  const f = fixture(), remote = await mountGateway(f);
  f.raw(async command => {
    if (command.clientSubmissionId === "conflict-key") {
      return { type: "response", id: command.id, command: command.type, success: false,
        error: "SUBMISSION_CONFLICT", code: "SUBMISSION_CONFLICT" };
    }
    return { type: "response", id: command.id, command: command.type, success: true,
      data: receipt(command.clientSubmissionId, command.type === "submission_query"
        ? { inputOutcome: "generated", relations: [input] } : {}) };
  });
  await expect(remote.prompt(f.peer, prompt("conflict-key"))).rejects.toThrow();
  expect(f.gateway.blocksAdmission).toBe(false);
  f.stop.pending.interactions = 1;
  await expect(remote.prompt(f.peer, prompt("host-busy"))).rejects.toThrow("busy");
  f.stop.pending.interactions = 0;
  f.state(async () => ({ ...idle, isStreaming: true, isSettled: false }));
  await expect(remote.prompt(f.peer, prompt("native-busy"))).rejects.toThrow("busy");
  f.state(async () => idle);
  expect(await remote.prompt(f.peer, prompt("fresh-key"))).toEqual({ accepted: true });
  expect(await remote.lookup(f.peer, "conflict-key")).toEqual({ outcome: "unknown" });
  expect(f.commands.map(command => [command.type, command.clientSubmissionId])).toEqual([
    ["submission_submit", "conflict-key"], ["submission_submit", "fresh-key"], ["submission_query", "fresh-key"],
  ]);
});

function stockFixture(options: { consent?: "required" | "not-required"; refuse?: string } = {}) {
  const f = fixture(), events: string[] = [];
  const decided = Promise.withResolvers<void>();
  Object.defineProperty(f.ports, "attachments", { configurable: true, value: {
    has: () => true,
    async submit(_requestId: string, message: string) { events.push(`submit:${message}`); },
    recovery: () => "accepted" as const,
  } });
  Object.defineProperty(f.ports, "stock", { configurable: true, value: {
    async prepare(_caller: ChatCaller, _requestId: string, request: SessionPromptRequest) {
      events.push(`prepare:${request.content.map(part => part.type).join(",")}`);
      if (options.refuse) throw Error(options.refuse);
      return { message: request.content.flatMap(part => part.type === "text" ? [part.text] : []).join(""),
        consent: options.consent ?? "not-required" };
    },
    async accept() { events.push("accept"); },
    async awaitConsent() { events.push("awaitConsent"); await decided.promise; },
    async abort() { events.push("abort"); },
    async release() { events.push("release"); },
  } });
  f.state(async () => { events.push("state"); return idle; });
  return { f, events, accept: () => decided.resolve(), refuse: () => decided.reject(Error("ATTACHMENT_CANCELLED")) };
}

const filePart = (receiptId: string) => ({ type: "file" as const,
  receiptId: brandString<Branded<"file-upload-receipt-id">>(receiptId) });

function attachedPrompt(id: string, content: SessionPromptRequest["content"]): SessionPromptRequest {
  return { requestId: id as SessionPromptRequest["requestId"], sessionId, projection, mode: "queue", content };
}

test("a stock file prompt prepares first, then crosses the idle gate and submits the resolved message", async () => {
  const { f, events } = stockFixture();
  const content = [{ type: "text" as const, text: "see " }, filePart("receipt-1")];
  expect(await f.gateway.prompt(f.peer, attachedPrompt("request-file", content), new AbortController().signal))
    .toEqual({ accepted: true });
  expect(events).toEqual(["prepare:text,file", "state", "accept", "submit:see ", "release"]);
  expect(f.commands.filter(command => command.type === "submission_submit")).toHaveLength(0);
});

test("empty stock text with a file is a real send while empty text alone stays a manual retry", async () => {
  const { f, events } = stockFixture();
  expect(await f.gateway.prompt(f.peer, attachedPrompt("request-empty",
    [filePart("receipt-2")]), new AbortController().signal))
    .toEqual({ accepted: true });
  expect(events.filter(event => event.startsWith("submit:"))).toEqual(["submit:"]);
  expect(events.at(-1)).toBe("release");
  const retried = stockFixture();
  let retries = 0;
  retried.f.ports.retry = async () => { retries++; };
  await retried.f.gateway.prompt(retried.f.peer, prompt("request-continue", ""), new AbortController().signal);
  expect(retries).toBe(1);
  expect(retried.events).toEqual([]);
});

test("a busy native Session refuses the prepared stock receipt without accepting or submitting", async () => {
  const { f, events } = stockFixture();
  f.state(async () => { events.push("state"); return { ...idle, isStreaming: true }; });
  await expect(f.gateway.prompt(f.peer, attachedPrompt("request-busy",
    [filePart("receipt-3")]), new AbortController().signal))
    .rejects.toThrow("chat_busy");
  expect(events).toEqual(["prepare:file", "state", "abort"]);
  expect(f.commands.filter(command => command.type === "submission_submit")).toHaveLength(0);
});

test("the stock fingerprint covers receipt ids so a changed attachment cannot reuse a request key", async () => {
  const { f } = stockFixture();
  const first = attachedPrompt("request-print", [filePart("receipt-4")]);
  const second = attachedPrompt("request-print", [filePart("receipt-5")]);
  await f.gateway.prompt(f.peer, first, new AbortController().signal);
  await expect(f.gateway.prompt(f.peer, second, new AbortController().signal)).rejects.toThrow("chat_conflict");
});

test("a lossy stock receipt waits for explicit consent, then submits the prepared message", async () => {
  const { f, events, accept } = stockFixture({ consent: "required" });
  const signal = new AbortController().signal;
  const send = f.gateway.prompt(f.peer, attachedPrompt("request-lossy", [filePart("receipt-6")]), signal);
  for (let tick = 0; tick < 50 && !events.includes("awaitConsent"); ++tick) await Promise.resolve();
  expect(events).toEqual(["prepare:file", "state", "awaitConsent"]);
  expect(f.commands.filter(command => command.type === "submission_submit")).toHaveLength(0);
  accept();
  expect(await send).toEqual({ accepted: true });
  expect(events).toEqual(["prepare:file", "state", "awaitConsent", "submit:", "release"]);
  expect(events).not.toContain("accept");
});

test("declining stock consent is a typed pre-dispatch cancellation, never an unknown outcome", async () => {
  const { f, events, refuse } = stockFixture({ consent: "required" });
  const send = f.gateway.prompt(f.peer, attachedPrompt("request-decline", [filePart("receipt-7")]),
    new AbortController().signal);
  for (let tick = 0; tick < 50 && !events.includes("awaitConsent"); ++tick) await Promise.resolve();
  refuse();
  await expect(send).rejects.toThrow("chat_cancelled");
  expect(events.at(-1)).toBe("abort");
  expect(f.commands.filter(command => command.type === "submission_submit")).toHaveLength(0);
});

test("a stock preparation refusal keeps its fixed code and is not reported as unresolved", async () => {
  const { f } = stockFixture({ refuse: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED" });
  const error = await f.gateway.prompt(f.peer, attachedPrompt("request-refused",
    [filePart("receipt-8")]), new AbortController().signal).catch(value => value);
  expect(error).toBeInstanceOf(ChatError);
  expect(error.code).toBe("refused");
  expect(error.detail).toBe("ATTACHMENT_DEGRADATION_CONSENT_REQUIRED");
  expect(error.message).not.toContain("unknown");
});

test("the public prompt RPC reports a refused stock Send without claiming an unresolved outcome", async () => {
  const { f } = stockFixture({ refuse: "ATTACHMENT_DEGRADATION_CONSENT_REQUIRED" });
  const remote = await mountGateway(f);
  const error = await remote.prompt(f.peer, attachedPrompt("request-public-refused",
    [filePart("receipt-9")])).catch(value => value) as { code: string; message: string };
  expect(error.code).toBe("gateway/bad-request");
  expect(error.message).toContain("refused before Native dispatch");
  expect(error.message).toContain("ATTACHMENT_DEGRADATION_CONSENT_REQUIRED");
  expect(error.message).not.toContain("unresolved");
});
