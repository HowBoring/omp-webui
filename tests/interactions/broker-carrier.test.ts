import { expect, test } from "bun:test";
import { Context } from "@deepseek-ai/cordis";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import {
  isRemoteEventClientId, parseRemoteStreamServerMessage, REMOTE_EVENT_STREAM_ENDPOINT, REMOTE_EVENT_STREAM_PAYLOAD,
  type RemoteStreamServerMessage,
} from "@deepseek-ai/dsh-api-gateway/stream-protocol";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { startSessionComponentServer } from "../../apps/host/src/session-component-server.ts";
import { CatalogClient } from "../../packages/contracts/generated/catalog-client.ts";
import type { RespondUiParams } from "../../packages/contracts/generated/omp-wire.ts";
import {
  brokerContribution, brokerSnapshotContribution, readBrokerSnapshot,
} from "../../packages/contracts/interaction-broker.ts";
import { InteractionBroker, type PageIdentity } from "../../packages/interactions/broker.ts";

type Carrier = Awaited<ReturnType<typeof startSessionComponentServer>>;
type Credential = { cookie: string; csrf: string };
type Ready = { clientId: string; streamId: string; socket: WebSocket };
const statusSchema = z.object({ csrf: z.string().min(1) });

async function login(host: Carrier): Promise<Credential> {
  const exchange = await fetch(host.bootstrapLink(), { redirect: "manual" });
  expect(exchange.status).toBe(303);
  const cookie = exchange.headers.get("set-cookie")!.split(";")[0]!;
  const status = await fetch(new URL("/auth/status", host.server.url), { headers: { cookie } });
  expect(status.status).toBe(200);
  const { csrf } = statusSchema.parse(await status.json());
  return { cookie, csrf };
}

function connect(url: string, cookie: string, origin: string): WebSocket {
  // Bun supplies cookie and Origin as a browser would on the loopback connection.
  // @ts-expect-error Bun's headers constructor overload is absent from the DOM types.
  return new WebSocket(url, { headers: { cookie, origin } });
}

function observeReady(socket: WebSocket, ready: (info: Ready) => void, frames: RemoteStreamServerMessage[]): void {
  socket.addEventListener("message", event => {
    const frame = parseRemoteStreamServerMessage(String(event.data));
    frames.push(frame);
    if (frame.type !== "item") return;
    const value = frame.value;
    if (value && typeof value === "object" && "type" in value && value.type === "ready" &&
      "clientId" in value && isRemoteEventClientId(value.clientId)) {
      ready({ socket, streamId: frame.streamId, clientId: value.clientId });
    }
  });
}

function post(host: Carrier, access: Credential, path: string, body?: unknown, overrides?: HeadersInit) {
  const headers = new Headers({ cookie: access.cookie, origin: host.server.url.origin, "x-omp-csrf": access.csrf,
    "content-type": "application/json" });
  new Headers(overrides).forEach((value, name) => headers.set(name, value));
  return fetch(new URL(path, host.server.url), { method: "POST", headers, body: JSON.stringify(body) });
}

const pending = { type: "client-request", rpcId: "pending", method: "ompInteractionBroker/pending", payload: { args: {} } };

async function openPage(host: Carrier, access: Credential, contexts: Context[],
  sharedSnapshot: boolean, interactions: "answer" | "none") {
  const ctx = new Context();
  contexts.push(ctx);
  const ready = Promise.withResolvers<Ready>();
  const responses: number[] = [];
  const sockets: WebSocket[] = [];
  const frames: RemoteStreamServerMessage[] = [];
  const origin = host.server.url.origin;
  installConnection(ctx, { interactions, transport: {
    streamBaseUrl: host.server.url.href,
    createWebSocket(url) {
      const socket = connect(url, access.cookie, origin);
      sockets.push(socket);
      observeReady(socket, ready.resolve, frames);
      return socket;
    },
    async fetch(url, init) {
      const headers = new Headers(init.headers);
      headers.set("cookie", access.cookie);
      headers.set("origin", origin);
      headers.set("x-omp-csrf", access.csrf);
      const response = await fetch(new URL(url, origin), { ...init, headers });
      responses.push(response.status);
      return response;
    },
  } });
  registry(ctx);
  gateway(ctx);
  await ctx.remote.$mount(sharedSnapshot ? brokerSnapshotContribution : brokerContribution);
  return { ready: ready.promise, remote: ctx.remote.ompInteractionBroker, responses, sockets, frames,
    dispose: () => ctx.fiber.dispose() };
}

async function delivery(page: Awaited<ReturnType<typeof openPage>>) {
  const result = await page.remote.pending();
  expect(page.responses.at(-1)).toBe(200);
  if (!result.ok) throw result.error;
  expect(result.value.pending).toHaveLength(1);
  return result.value.pending[0]!;
}

async function fixture(sharedSnapshot = false) {
  const home = await mkdtemp(join(tmpdir(), "omp-broker-carrier-"));
  const contexts: Context[] = [];
  const pages = new Map<string, PageIdentity>();
  const reply = Promise.withResolvers<{ status: "answered" | "cancelled" }>();
  let clockFault = false, scopeCurrent = true, revokeOnRead = false;
  let monotonic = 0;
  const entered = Promise.withResolvers<RespondUiParams>();
  const commands: RespondUiParams[] = [], stops: string[] = [];
  const broker = new InteractionBroker({ kind: "startup", contextId: "controlled-startup" }, "worker", "root", {
    respondUi: async command => { commands.push(command); entered.resolve(command); return reply.promise; },
    requestStop: async reason => { stops.push(reason); },
  }, page => { pages.set(page.clientId, page); return scopeCurrent; }, {
    now() {
      if (clockFault) throw new Error("fixture private clock failure");
      if (revokeOnRead) scopeCurrent = false;
      return sharedSnapshot ? monotonic : performance.now();
    },
    wall: sharedSnapshot ? () => 10_000 + monotonic : Date.now,
    schedule(delay, callback) {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    },
  });
  broker.receive({ type: "ready", interactionPolicy: { version: "1", explicitAnswersOnly: true,
    nativeExpiry: "cancel", toolExpiry: "cancel", invalidAnswer: "pending" } });
  const receive = (id: string) => broker.receive({ type: "extension_ui_request", id, method: "input", title: "Explicit" });
  let host: Carrier;
  try {
    host = await startSessionComponentServer({ dataDir: join(home, "state"), port: 0,
      manifest: join(home, "absent-manifest"), launcher: join(home, "absent-launcher"), interactionBroker: broker,
      ...(sharedSnapshot ? { interactionBrokerMode: "shared-cookie-snapshot" as const } : {}),
      catalog: new CatalogClient(async () => { throw new Error("UNEXPECTED_CATALOG_REQUEST"); }),
      launch: async () => { throw new Error("UNEXPECTED_WORKER_LAUNCH"); } });
  } catch (error) {
    broker.close();
    await rm(home, { recursive: true, force: true });
    throw error;
  }
  return { host, pages, receive, entered: entered.promise, commands, stops,
    reply: (status: "answered" | "cancelled" = "answered") => reply.resolve({ status }),
    failClock: () => { clockFault = true; },
    loseScope: () => { scopeCurrent = false; },
    advance: (elapsed: number) => { monotonic += elapsed; },
    loseScopeOnRead: () => { revokeOnRead = true; },
    openPage: (access: Credential, interactions: "answer" | "none" = "answer") =>
      openPage(host, access, contexts, sharedSnapshot, interactions),
    async close() {
      reply.resolve({ status: "answered" });
      for (const ctx of contexts) await ctx.fiber.dispose();
      await host.stop();
      await rm(home, { recursive: true, force: true });
    },
  };
}

test("the isolated carrier binds each admitted Broker Remote to its own ready DSH logical Peer", async () => {
  const f = await fixture();
  try {
    const a = await login(f.host), b = await login(f.host);
    expect((await post(f.host, a, "/api/ompInteractionBroker/pending", pending)).status).toBe(401);
    f.receive("synthetic");
    const first = await f.openPage(a), second = await f.openPage(b);
    const firstReady = await first.ready, secondReady = await second.ready;
    expect(firstReady.clientId).not.toBe(secondReady.clientId);
    const firstDelivery = await delivery(first), secondDelivery = await delivery(second);
    expect(firstDelivery.card).toEqual(secondDelivery.card);
    expect(firstDelivery.deliveryId).not.toBe(secondDelivery.deliveryId);
    const firstBinding = f.pages.get(firstReady.clientId), secondBinding = f.pages.get(secondReady.clientId);
    expect(firstBinding?.credentialId).toBeString();
    expect(secondBinding?.credentialId).toBeString();
    expect(firstBinding?.credentialId).not.toBe(secondBinding?.credentialId);
    expect(firstBinding?.peerId).toBeString();
    expect(secondBinding?.peerId).toBeString();
    expect(firstBinding?.peerId).not.toBe(secondBinding?.peerId);

    for (const headers of [{ "x-omp-csrf": "wrong", origin: f.host.server.url.origin },
      { "x-omp-csrf": a.csrf, origin: "null" }]) {
      expect((await post(f.host, a, "/api/ompInteractionBroker/pending", pending, headers)).status).toBe(403);
    }
    expect((await post(f.host, a, "/api/ompInteractionBroker/answer", pending)).status).toBe(400);
    expect((await post(f.host, a, "/api/ompInteractionBroker/pending", { ...pending,
      payload: { args: { clientId: secondReady.clientId, peerId: secondBinding?.peerId } } })).status).toBe(400);
    expect(await second.remote.answer(firstDelivery.card.generation, "synthetic", firstDelivery.deliveryId,
      { type: "value", value: "cross-view" })).toEqual({ ok: true, value: { status: "stale" } });
    expect(f.commands).toEqual([]);
  } finally { await f.close(); }
});

const snapshotFailure = { code: "gateway/internal", message: "Interaction snapshot failed.", details: {} };

function snapshot(page: Awaited<ReturnType<typeof openPage>>) {
  return readBrokerSnapshot(page.remote.pendingSnapshot());
}

test("shared-cookie Browser Views retain separate Broker snapshots across a logical end and reconnect", async () => {
  const f = await fixture(true);
  try {
    const access = await login(f.host);
    const unready = await f.openPage(access, "none");
    await expect(snapshot(unready)).rejects.toMatchObject(snapshotFailure);
    expect(unready.sockets).toHaveLength(1);
    expect(unready.sockets[0]?.readyState).toBe(WebSocket.OPEN);
    expect(f.pages.size).toBe(0);
    await unready.dispose();

    const first = await f.openPage(access);
    const firstReady = await first.ready;
    f.receive("shared");
    f.advance(600_000);
    const firstRead = first.frames.length;
    const initial = await snapshot(first);
    expect(initial.pending).toHaveLength(1);
    const firstItem = first.frames[firstRead];
    if (firstItem?.type !== "item") throw new Error("Expected a Broker snapshot item");
    const { streamId } = firstItem;
    expect(streamId).not.toBe(firstReady.streamId);
    expect(first.frames.slice(firstRead)).toEqual([
      { type: "item", streamId, value: initial }, { type: "end", streamId },
    ]);

    const second = await f.openPage(access);
    const secondReady = await second.ready;
    expect(secondReady.clientId).not.toBe(firstReady.clientId);
    const firstBinding = f.pages.get(firstReady.clientId), secondBinding = f.pages.get(secondReady.clientId);
    expect(firstBinding?.credentialId).toBeString();
    expect(secondBinding?.credentialId).toBe(firstBinding?.credentialId);
    expect(firstBinding?.peerId).toBeString();
    expect(secondBinding?.peerId).toBeString();
    expect(secondBinding?.peerId).not.toBe(firstBinding?.peerId);
    const other = await snapshot(second);
    expect(other.pending).toHaveLength(1);
    expect(other.pending[0]?.card).toEqual(initial.pending[0]?.card);
    expect(other.pending[0]?.card.deadline).toBe(1_810_000);
    expect(other.pending[0]?.deliveryId).not.toBe(initial.pending[0]?.deliveryId);

    const duplicate = "duplicate-events";
    firstReady.socket.send(JSON.stringify({ type: "open", streamId: duplicate,
      endpoint: REMOTE_EVENT_STREAM_ENDPOINT, payload: REMOTE_EVENT_STREAM_PAYLOAD }));
    expect(await snapshot(first)).toEqual(initial);
    expect(first.frames.filter(frame => frame.streamId === duplicate)).toEqual([
      { type: "error", streamId: duplicate,
        error: { ...snapshotFailure, message: "Interaction event stream failed." } },
    ]);

    firstReady.socket.send(JSON.stringify({ type: "cancel", streamId: firstReady.streamId }));
    await expect(snapshot(first)).rejects.toMatchObject(snapshotFailure);
    expect(firstReady.socket.readyState).toBe(WebSocket.OPEN);
    expect(secondReady.socket.readyState).toBe(WebSocket.OPEN);
    expect(await snapshot(second)).toEqual(other);
    expect(first.sockets).toEqual([firstReady.socket]);
    expect(second.sockets).toEqual([secondReady.socket]);
    expect([...first.responses, ...second.responses]).toEqual([]);
    expect((await post(f.host, access, "/api/ompInteractionBroker/pending", pending)).status).toBe(501);

    const closed = waitForClose(firstReady.socket);
    await first.dispose();
    await closed;
    f.advance(600_000);
    const replacement = await f.openPage(access);
    const replacementReady = await replacement.ready;
    const reoffered = await snapshot(replacement);
    expect(replacementReady.clientId).not.toBe(firstReady.clientId);
    expect(f.pages.get(replacementReady.clientId)?.peerId).not.toBe(firstBinding?.peerId);
    expect(replacement.sockets).toEqual([replacementReady.socket]);
    expect(reoffered.pending).toHaveLength(1);
    expect(reoffered.pending[0]?.card).toEqual(initial.pending[0]?.card);
    expect(reoffered.pending[0]?.deliveryId).not.toBe(initial.pending[0]?.deliveryId);
    expect(reoffered.pending[0]?.deliveryId).not.toBe(other.pending[0]?.deliveryId);
    expect(await snapshot(second)).toEqual(other);

    const denied = replacement.frames.length;
    f.loseScopeOnRead();
    await expect(snapshot(replacement)).rejects.toMatchObject(snapshotFailure);
    expect(replacement.frames.slice(denied)).toEqual([
      { type: "error", streamId: expect.any(String), error: snapshotFailure },
    ]);
    expect(replacementReady.socket.readyState).toBe(WebSocket.OPEN);
    expect(f.commands).toEqual([]);
    expect(f.stops).toEqual([]);
  } finally { await f.close(); }
});

function waitForClose(socket: WebSocket): Promise<number> {
  return new Promise(resolve => socket.addEventListener("close", event => resolve(event.code), { once: true }));
}

test("a logical end fences a held answer and allows redelivery after physical reconnect", async () => {
  const f = await fixture();
  try {
    const a = await login(f.host), b = await login(f.host);
    const first = await f.openPage(a), second = await f.openPage(b);
    const { socket, streamId } = await first.ready;
    await second.ready;

    const origin = f.host.server.url.origin;
    const duplicate = connect(origin.replace("http:", "ws:") + "/api/remote.mux", a.cookie, origin);
    duplicate.addEventListener("open", () => duplicate.send(JSON.stringify({ type: "open", streamId: "duplicate",
      endpoint: REMOTE_EVENT_STREAM_ENDPOINT, payload: REMOTE_EVENT_STREAM_PAYLOAD })), { once: true });
    expect(await waitForClose(duplicate)).toBe(1011);

    f.receive("settling");
    const old = await delivery(first);
    const answer = first.remote.answer(old.card.generation, old.card.id, old.deliveryId, { type: "value", value: "explicit" });
    expect(await f.entered).toEqual({ targetId: "settling", answer: { type: "value", value: "explicit" } });
    f.receive("redelivery");
    const retired = await delivery(first);
    socket.send(JSON.stringify({ type: "cancel", streamId }));
    await waitForUnbound(f.host, a);
    expect(socket.readyState).toBe(WebSocket.OPEN);
    f.reply();
    expect(await answer).toMatchObject({ ok: false });
    expect(first.responses.at(-1)).toBe(401);
    const settled = await second.remote.pending();
    if (!settled.ok) throw settled.error;
    expect(settled.value.outcomes).toEqual([{ id: "settling", status: "answered", reason: "explicit-answer", stop: "none" }]);

    const other = await delivery(second);
    const reconnected = await f.openPage(a);
    const replacement = await reconnected.ready;
    expect(replacement.socket).not.toBe(socket);
    const current = await delivery(reconnected);
    expect(current.card.deadline).toBe(other.card.deadline);
    expect(current.deliveryId).not.toBe(other.deliveryId);
    expect(await reconnected.remote.answer(retired.card.generation, retired.card.id, retired.deliveryId,
      { type: "value", value: "retired" })).toEqual({ ok: true, value: { status: "stale" } });

    const closed = waitForClose(replacement.socket);
    replacement.socket.close();
    await reconnected.dispose();
    await closed;
    await waitForUnbound(f.host, a);

    const otherClosed = waitForClose((await second.ready).socket);
    expect((await post(f.host, b, "/auth/logout")).status).toBe(204);
    expect(await otherClosed).toBe(4001);
    expect((await post(f.host, b, "/api/ompInteractionBroker/pending", pending)).status).toBe(401);
    expect(f.commands).toHaveLength(1);
    expect(f.stops).toEqual([]);
  } finally { await f.close(); }
});

async function waitForUnbound(host: Carrier, access: Credential): Promise<void> {
  const deadline = performance.now() + 1000;
  for (;;) {
    const response = await post(host, access, "/api/ompInteractionBroker/pending", pending);
    const { status } = response;
    await response.body?.cancel();
    if (status === 401) return;
    if (status !== 200 || performance.now() >= deadline) {
      throw new Error("The ended Browser View was not retired");
    }
    await Bun.sleep(5);
  }
}

test("a valid invocation failure retains DSH correlation and redacts the Host exception", async () => {
  const f = await fixture();
  try {
    const page = await f.openPage(await login(f.host));
    await page.ready;
    f.receive("query");
    f.failClock();
    expect(await page.remote.pending()).toMatchObject({ ok: false, error: {
      code: "gateway/internal", message: "Interaction request failed.", details: {},
    } });
    expect(page.responses.at(-1)).toBe(200);
  } finally { await f.close(); }
});

test("trusted revoke-all fences the current Broker before awaiting its Native cancellation", async () => {
  const f = await fixture();
  try {
    const access = await login(f.host), page = await f.openPage(access);
    await page.ready;
    f.receive("revoke");
    await delivery(page);

    let returned = false;
    const revoked = f.host.revokeAll().then(() => { returned = true; });
    await Promise.race([f.entered, revoked.then(() => { throw new Error("revoke-all skipped Broker cancellation"); })]);
    expect(f.commands).toEqual([{ targetId: "revoke", answer: { type: "cancel" } }]);
    expect(f.stops).toEqual(["all-browser-access-revoked"]);
    const fresh = await f.openPage(await login(f.host));
    await fresh.ready;
    expect(await fresh.remote.pending()).toMatchObject({ ok: false });
    expect(fresh.responses.at(-1)).toBe(401);
    expect(returned).toBe(false);
    f.reply("cancelled");
    await revoked;
    expect(returned).toBe(true);
  } finally { await f.close(); }
});

function brokerRequest(host: Carrier, access: Credential, body: BodyInit, signal?: AbortSignal) {
  const request = new Request(new URL("/api/ompInteractionBroker/pending", host.server.url), {
    method: "POST", body, ...(signal ? { signal } : {}), headers: {
      host: host.server.url.host, origin: host.server.url.origin, cookie: access.cookie,
      "x-omp-csrf": access.csrf, "content-type": "application/json",
    },
  });
  return host.server.fetch(request);
}

test("the carrier bounds actual bytes through the same fetch handler before invocation", async () => {
  const f = await fixture();
  try {
    const access = await login(f.host), page = await f.openPage(access);
    await page.ready;
    const body = JSON.stringify(pending) + " ".repeat(16_384);
    expect((await brokerRequest(f.host, access, body)).status).toBe(413);
  } finally { await f.close(); }
});

test.each(["request", "logical", "scope", "deadline"] as const)("the %s boundary cuts off a stalled Broker body", async ended => {
  const f = await fixture();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let sent = false, cancelled = false;
  let finishBody: (() => void) | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { finishBody = () => controller.close(); },
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(new TextEncoder().encode(JSON.stringify(pending)));
        return;
      }
      entered.resolve();
      return release.promise;
    },
    cancel() { cancelled = true; return release.promise; },
  }, { highWaterMark: 0 });
  try {
    const access = await login(f.host), page = await f.openPage(access);
    const { socket, streamId } = await page.ready;
    const controller = new AbortController();
    const reply = brokerRequest(f.host, access, body, controller.signal);
    await entered.promise;
    if (ended === "request") controller.abort();
    if (ended === "logical") socket.send(JSON.stringify({ type: "cancel", streamId }));
    if (ended === "scope") f.loseScope();
    const outerDeadline = ended === "deadline" ? 6500 : 1000;
    const result = await Promise.race([reply, Bun.sleep(outerDeadline).then(() => null)]);
    expect(result?.status).toBe(ended === "deadline" ? 408 : 401);
    // This assertion runs while the source's pull and cancel are still held.
  } finally {
    if (!cancelled) finishBody?.();
    release.resolve();
    await f.close();
  }
}, 7500);
