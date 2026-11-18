import { expect, test } from "bun:test";
import { Context } from "@deepseek-ai/cordis";
import TypertRegistry from "@deepseek-ai/dsh-typert-registry";
import RemoteAccessService from "@deepseek-ai/dsh-api-remote-access";
import { TypertGatewayService } from "@deepseek-ai/dsh-api-gateway";
import { Peer } from "@deepseek-ai/dsh-client-connection";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import sessionContribution from "@deepseek-ai/dsh-api-session-controller/remote";
import { parseProjectionBinding } from "@deepseek-ai/dsh-api-session-controller/projection";
import type { SessionRequestId } from "@deepseek-ai/dsh-api-session-controller/types";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { brandString } from "@deepseek-ai/dsh-brand";
import { ChatViewAdmission, type ChatViewEnrollment } from "../../apps/host/src/chat-view-admission.ts";
import { createChatSessionDispatch, dispatchSessionRequest } from "../../apps/host/src/session-remote-dispatch.ts";
import { ChatGateway, type ChatWorkerPort } from "../../packages/chat/gateway.ts";
import { ChatLookupService, ChatPromptService } from "../../packages/chat/service.ts";
import { chatContribution, chatHostContribution } from "../../packages/contracts/chat.ts";
import type { SubmissionResult } from "../../packages/contracts/candidates/durable-submission-v1/omp-wire.ts";
import { sourceFixture } from "../sessions/source-fixture.ts";

const projection = parseProjectionBinding({ source: "source", generation: "projection" });

const prompt = (sessionId: SessionId, id = "draft-a") => ({ sessionId,
  requestId: brandString<SessionRequestId>(id), projection, mode: "queue" as const,
  content: [{ type: "text" as const, text: "fixture text" }] });

const promptEnvelope = (sessionId: SessionId) => JSON.stringify({ type: "client-request", rpcId: "body-check",
  method: "session/prompt", payload: { args: { request: prompt(sessionId) } } });

async function fixture() {
  const source = await sourceFixture();
  const host = new Context();
  const clients = new Set<Context>();
  const enrollment = new ChatViewAdmission(source.authority, source.grants, source.supervisor);
  const workerLifetime = new AbortController();
  const close = async () => {
    enrollment.close();
    for (const client of clients) await client.fiber.dispose();
    await host.fiber.dispose();
    await source.close();
  };
  try {
    const { nativeSessionId, sourceId, instanceId } = source.selected;
    const sessionId = SessionId(nativeSessionId);
    const target = { nativeSessionId, sourceId, instanceId };
    const worker = await source.supervisor.open(source.identity, source.selected);
    const admissions: string[] = [];
    const readIdle = async () => ({ sessionId, isSettled: true, isStreaming: false, isCompacting: false,
      hasPendingAsyncWork: false, queuedMessageCount: 0, queuedMessages: { steering: [], followUp: [] } });
    let state = readIdle, beforeReceipt = async () => {};
    const port: ChatWorkerPort = {
      sessionId, generation: worker.generation, lifetime: workerLifetime.signal, target, matchedCohort: "test-fixture",
      authorize: (caller, requested) => enrollment.authorize(caller, requested, port),
      stop: () => ({ generation: "stop", workerGeneration: worker.generation, scope: { kind: "session", sessionId },
        status: "idle", nativeSettled: true, acceptingWork: true, pending: { interactions: 0, history: 0, queued: 0, other: 0 },
        failures: [], forceAvailable: false, restored: null, draftConflict: false }),
      state: () => state(),
      async request(command) {
        const clientSubmissionId = command.clientSubmissionId;
        if (command.type === "submission_submit") admissions.push(clientSubmissionId);
        const ack = command.type === "submission_submit";
        if (!ack) await beforeReceipt();
        const data: SubmissionResult = {
          version: "durable-submission-v1", clientSubmissionId, target, found: true, duplicate: false,
          admission: "local", origin: { ...target, clientSubmissionId }, reservation: "committed", nextOffset: null,
          operationOutcome: "unknown", inputOutcome: ack ? "unresolved" : "generated", terminal: false,
          persistence: "unresolved", relations: ack ? [] : [{ relationId: "entry:real-input", role: "input",
            status: "observed", persistence: "committed", entryId: "real-input", availability: "retained" }],
        };
        return { type: "response", id: command.id, command: command.type, success: true, data };
      },
    };
    const chat = new ChatGateway(port);
    await host.plugin(TypertRegistry);
    await host.plugin(RemoteAccessService);
    await host.plugin(TypertGatewayService, {});
    host.typert.register(chatHostContribution);
    host.typert.register({ package: sessionContribution.package, face: "host", schemas: [],
      model: { services: [], events: [], objects: [] }, invocations: sessionContribution.descriptors });
    new ChatPromptService(host, id => id === sessionId ? chat : undefined);
    new ChatLookupService(host, id => id === sessionId ? chat : undefined);
    const peer = new Peer(host, { principal: { kind: "owner" }, interactions: "none" });
    const attached = new WeakMap<Request, ChatViewEnrollment>();
    const dispatch = createChatSessionDispatch(enrollment, request => attached.get(request));
    function openView() {
      const lifetime = new AbortController();
      const view = enrollment.enroll(source.identity, { workerId: worker.workerId, grantId: source.grant.id,
        lifetime: AbortSignal.any([lifetime.signal, workerLifetime.signal]), projection: () => projection });
      if (!view) throw new Error("Fixture view unavailable");
      return { view, lifetime };
    }
    async function getCsrf(cookie: string): Promise<string> {
      const status = await source.authority.handle(new Request(`${source.origin}/auth/status`, {
        headers: { host: new URL(source.origin).host, cookie },
      }));
      return (await status!.json()).csrf;
    }
    async function chatRequest(view: ChatViewEnrollment, init: RequestInit) {
      const headers = new Headers(init.headers);
      headers.set("host", new URL(source.origin).host);
      headers.set("origin", source.origin);
      headers.set("cookie", source.cookie);
      headers.set("x-omp-csrf", await getCsrf(source.cookie));
      headers.set("content-type", "application/json");
      const request = new Request(`${source.origin}/api/session/prompt`, { ...init, method: "POST", headers });
      attached.set(request, view);
      return dispatch(request, host, peer);
    }
    async function connect(view?: ChatViewEnrollment, cookie = source.cookie, extraHeaders: HeadersInit = {}) {
      const ctx = new Context();
      clients.add(ctx);
      const csrf = await getCsrf(cookie);
      const responses: number[] = [];
      const transport: Parameters<typeof installConnection>[1] = { interactions: "none", transport: {
        fetch: async (url, init) => {
          const headers = new Headers(init?.headers);
          headers.set("host", new URL(source.origin).host);
          headers.set("origin", source.origin);
          headers.set("cookie", cookie);
          headers.set("x-omp-csrf", csrf);
          for (const [name, value] of new Headers(extraHeaders)) headers.set(name, value);
          const request = new Request(new URL(url, source.origin), { ...init, headers });
          if (view) attached.set(request, view);
          const response = await dispatch(request, host, peer);
          responses.push(response.status);
          return response;
        }, openStream: async function* () {},
      } };
      installConnection(ctx, transport);
      registry(ctx);
      gateway(ctx);
      await ctx.remote.$mount(sessionContribution);
      await ctx.remote.$mount(chatContribution);
      return { remote: ctx.remote, responses };
    }
    return { source, host, peer, worker, sessionId, admissions, openView, connect, chatRequest, close,
      setState: (callback: typeof state) => { state = callback; }, readIdle,
      beforeReceipt: (callback: typeof beforeReceipt) => { beforeReceipt = callback; } };
  } catch (error) { await close(); throw error; }
}

test("two Browser Views on the same DSH Peer retain distinct draft recovery authority", async () => {
  const f = await fixture();
  try {
    const first = f.openView(), second = f.openView();
    const a = await f.connect(first.view), b = await f.connect(second.view);
    expect(await a.remote.ompChat.state(f.sessionId)).toEqual({ ok: true, value: undefined });
    const request = prompt(f.sessionId);
    const result = await a.remote.session.prompt(request);
    expect(result).toMatchObject({ ok: true, value: { accepted: true } });
    expect(await b.remote.ompChat.lookup(f.sessionId, request.requestId)).toMatchObject({ ok: true, value: { outcome: "unknown" } });
    const reconnected = await f.connect(first.view);
    expect(await reconnected.remote.ompChat.lookup(f.sessionId, request.requestId))
      .toMatchObject({ ok: true, value: { outcome: "accepted" } });
    expect(f.admissions).toEqual([request.requestId]);
  } finally { await f.close(); }
});

test("neither a shared Peer nor a valid browser credential substitutes for the exact trusted View attachment", async () => {
  const f = await fixture();
  try {
    const { view } = f.openView();
    const other = await f.source.browser();
    const wrongBrowser = await f.connect(view, other.cookie);
    const noView = await f.connect(undefined, f.source.cookie, { "x-fixture-view": "claimed-view-key" });
    const wrongCsrf = await f.connect(view, f.source.cookie, { "x-omp-csrf": "invalid" });
    for (const client of [wrongBrowser, noView, wrongCsrf]) {
      expect(await client.remote.session.prompt(prompt(f.sessionId))).toMatchObject({ ok: false });
    }
    expect([wrongBrowser.responses, noView.responses, wrongCsrf.responses]).toEqual([[401], [401], [403]]);
    expect(f.admissions).toEqual([]);
    const rightBrowser = await f.connect(view);
    expect(await rightBrowser.remote.session.prompt(prompt(f.sessionId))).toMatchObject({ ok: true });
  } finally { await f.close(); }
});

test("the default unary Session carrier refuses Chat even when the Gateway descriptors exist", async () => {
  const f = await fixture();
  try {
    const request = new Request(`${f.source.origin}/api/session/prompt`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "client-request", rpcId: "default-off",
        method: "session/prompt", payload: { args: { request: prompt(f.sessionId) } } }) });
    expect((await dispatchSessionRequest(request, f.host, f.peer, () => true)).status).toBe(400);
    expect(f.admissions).toEqual([]);
  } finally { await f.close(); }
});

test.each(["grant", "view", "browser", "worker"] as const)(
  "late %s revocation withdraws the pending Chat invocation before Native submission", async cause => {
    const f = await fixture();
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    try {
      const { view, lifetime } = f.openView();
      const client = await f.connect(view);
      f.setState(async () => { entered.resolve(); await release.promise; return f.readIdle(); });
      const submission = client.remote.session.prompt(prompt(f.sessionId));
      await Promise.race([entered.promise, submission.then(() => { throw new Error("Native state was not reached"); })]);
      if (cause === "grant") {
        f.source.grants.confirm(f.source.grants.preview(f.source.home).confirmation);
        f.source.grants.revoke(f.source.grant.id);
        expect(f.source.grants.authorize(f.source.cwd).status).toBe("authorized");
      } else if (cause === "view") {
        lifetime.abort();
      } else if (cause === "browser") {
        f.source.authority.revokeAll();
      } else {
        await f.source.supervisor.close();
      }
      release.resolve();
      expect(await submission).toMatchObject({ ok: false });
      expect(await client.remote.ompChat.lookup(f.sessionId, "draft-a")).toMatchObject({ ok: false });
      expect(client.responses).toEqual([401, 401]);
      expect(f.admissions).toEqual([]);
    } finally { release.resolve(); await f.close(); }
  },
);

test("revocation after the Native write suppresses the old View's response and leaves the write single", async () => {
  const f = await fixture();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  try {
    const first = f.openView(), second = f.openView();
    f.beforeReceipt(async () => { entered.resolve(); await release.promise; });
    const old = await f.connect(first.view);
    const pending = old.remote.session.prompt(prompt(f.sessionId));
    await Promise.race([entered.promise, pending.then(() => { throw new Error("Native query was not reached"); })]);
    first.view.revoke();
    release.resolve();
    expect(await pending).toMatchObject({ ok: false });
    expect(old.responses).toEqual([401]);
    const other = await f.connect(second.view);
    expect(await other.remote.ompChat.lookup(f.sessionId, "draft-a")).toEqual({ ok: true, value: { outcome: "unknown" } });
    expect(f.admissions).toEqual(["draft-a"]);
  } finally { release.resolve(); await f.close(); }
});

test("Native busy returns the Chat Remote draft-retention error through the unary carrier", async () => {
  const f = await fixture();
  try {
    const client = await f.connect(f.openView().view);
    f.setState(async () => ({ ...await f.readIdle(), isStreaming: true, isSettled: false }));
    const result = await client.remote.session.prompt(prompt(f.sessionId));
    expect(result).toMatchObject({ ok: false,
      error: { code: "gateway/bad-request", message: "Native Session is busy. Your draft is retained." } });
    expect(client.responses).toEqual([200]);
    expect(f.admissions).toEqual([]);
  } finally { await f.close(); }
});

test("Chat refuses an oversized declared length before interpreting an otherwise valid DSH prompt", async () => {
  const f = await fixture();
  try {
    const response = await f.chatRequest(f.openView().view, {
      headers: { "content-length": String(2 * 1024 * 1024 + 1) }, body: promptEnvelope(f.sessionId),
    });
    expect(response.status).toBe(413);
    expect(f.admissions).toEqual([]);
  } finally { await f.close(); }
});

test.each(["chunked", "underreported"] as const)("Chat caps actual bytes in a %s Request body", async mode => {
  const f = await fixture();
  try {
    const text = new TextEncoder().encode(promptEnvelope(f.sessionId));
    const padding = new Uint8Array(1024 * 1024).fill(0x20);
    const parts = [text, padding, padding].values();
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      const chunk = parts.next();
      if (chunk.done) controller.close();
      else controller.enqueue(chunk.value);
    } });
    const headers: HeadersInit = mode === "underreported" ? { "content-length": String(text.byteLength) } : {};
    const response = await f.chatRequest(f.openView().view, { headers, body });
    expect(response.status).toBe(413);
    expect(f.admissions).toEqual([]);
  } finally { await f.close(); }
});

test("Chat rejects malformed wire UTF-8 inside otherwise valid JSON", async () => {
  const f = await fixture();
  try {
    const envelope = promptEnvelope(f.sessionId);
    const body = new TextEncoder().encode(envelope);
    body[envelope.indexOf("fixture text")] = 0xff;
    expect((await f.chatRequest(f.openView().view, { body })).status).toBe(400);
    expect(f.admissions).toEqual([]);
  } finally { await f.close(); }
});

test("the body limit admits a fully escaped maximum-length Chat input", async () => {
  const f = await fixture();
  try {
    const body = promptEnvelope(f.sessionId).replace("fixture text", "\\u0061".repeat(256 * 1024));
    const response = await f.chatRequest(f.openView().view, { body });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { ok: true, value: { accepted: true } } });
    expect(f.admissions).toEqual(["draft-a"]);
  } finally { await f.close(); }
});

function stalledBody(prefix: string) {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let sent = false, cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(new TextEncoder().encode(prefix));
        return;
      }
      entered.resolve();
      return release.promise;
    },
    cancel() { cancelled = true; return release.promise; },
  }, { highWaterMark: 0 });
  return { body, entered: entered.promise, release: release.resolve, cancelled: () => cancelled };
}

test.each(["view", "grant", "request", "deadline"] as const)(
  "Chat drops a stalled request body on %s without awaiting stream cancellation", async cause => {
    const f = await fixture();
    const stream = stalledBody(promptEnvelope(f.sessionId));
    try {
      const { view } = f.openView();
      const abort = new AbortController();
      const pending = f.chatRequest(view, { body: stream.body, signal: abort.signal });
      await Promise.race([stream.entered, pending.then(() => { throw new Error("Body read did not reach the stall"); })]);
      if (cause === "view") view.revoke();
      if (cause === "grant") f.source.grants.revoke(f.source.grant.id);
      if (cause === "request") abort.abort();
      const response = await pending;
      expect(response.status).toBe(cause === "deadline" ? 408 : 401);
      expect(stream.cancelled()).toBe(true);
      expect(f.admissions).toEqual([]);
    } finally { stream.release(); await f.close(); }
  }, 7000,
);
