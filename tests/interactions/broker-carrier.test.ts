import { expect, test } from "bun:test";
import { Context } from "@deepseek-ai/cordis";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import {
  isRemoteEventClientId, parseRemoteStreamServerMessage, REMOTE_EVENT_STREAM_ENDPOINT, REMOTE_EVENT_STREAM_PAYLOAD,
} from "@deepseek-ai/dsh-api-gateway/stream-protocol";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSessionComponentServer } from "../../apps/host/src/session-component-server.ts";
import { CatalogClient } from "../../packages/contracts/generated/catalog-client.ts";
import type { RespondUiParams } from "../../packages/contracts/generated/omp-wire.ts";
import { brokerContribution } from "../../packages/contracts/interaction-broker.ts";
import { InteractionBroker, type PageIdentity } from "../../packages/interactions/broker.ts";

type Carrier = Awaited<ReturnType<typeof startSessionComponentServer>>;
type Credential = { cookie: string; csrf: string };
type Ready = { clientId: string; streamId: string; socket: WebSocket };

async function login(host: Carrier): Promise<Credential> {
  const exchange = await fetch(host.bootstrapLink(), { redirect: "manual" });
  expect(exchange.status).toBe(303);
  const cookie = exchange.headers.get("set-cookie")!.split(";")[0]!;
  const status = await fetch(new URL("/auth/status", host.server.url), { headers: { cookie } });
  const { csrf } = await status.json() as { csrf: string };
  return { cookie, csrf };
}

function connect(url: string, cookie: string, origin: string): WebSocket {
  // Bun supplies cookie and Origin as a browser would on the loopback connection.
  // @ts-expect-error Bun's headers constructor overload is absent from the DOM types.
  return new WebSocket(url, { headers: { cookie, origin } });
}

function observeReady(socket: WebSocket, ready: (info: Ready) => void): void {
  socket.addEventListener("message", event => {
    const frame = parseRemoteStreamServerMessage(String(event.data));
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

async function openPage(host: Carrier, access: Credential, contexts: Context[]) {
  const ctx = new Context();
  contexts.push(ctx);
  const ready = Promise.withResolvers<Ready>();
  const responses: number[] = [];
  const origin = host.server.url.origin;
  installConnection(ctx, { interactions: "answer", transport: {
    streamBaseUrl: host.server.url.href,
    createWebSocket(url) {
      const socket = connect(url, access.cookie, origin);
      observeReady(socket, ready.resolve);
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
  await ctx.remote.$mount(brokerContribution);
  return { ready: ready.promise, remote: ctx.remote.ompInteractionBroker, responses,
    dispose: () => ctx.fiber.dispose() };
}

async function delivery(page: Awaited<ReturnType<typeof openPage>>) {
  const result = await page.remote.pending();
  expect(page.responses.at(-1)).toBe(200);
  if (!result.ok) throw result.error;
  expect(result.value.pending).toHaveLength(1);
  return result.value.pending[0]!;
}

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "omp-broker-carrier-"));
  const contexts: Context[] = [];
  const pages = new Map<string, PageIdentity>();
  const reply = Promise.withResolvers<{ status: "answered" }>();
  const entered = Promise.withResolvers<RespondUiParams>();
  const commands: RespondUiParams[] = [], stops: string[] = [];
  const broker = new InteractionBroker({ kind: "startup", contextId: "controlled-startup" }, "worker", "root", {
    respondUi: async command => { commands.push(command); entered.resolve(command); return reply.promise; },
    requestStop: async reason => { stops.push(reason); },
  }, page => { pages.set(page.clientId, page); return true; });
  broker.receive({ type: "ready", interactionPolicy: { version: "1", explicitAnswersOnly: true,
    nativeExpiry: "cancel", toolExpiry: "cancel", invalidAnswer: "pending" } });
  const receive = (id: string) => broker.receive({ type: "extension_ui_request", id, method: "input", title: "Explicit" });
  let host: Carrier;
  try {
    host = await startSessionComponentServer({ dataDir: join(home, "state"), port: 0,
      manifest: join(home, "absent-manifest"), launcher: join(home, "absent-launcher"), interactionBroker: broker,
      catalog: new CatalogClient(async () => { throw new Error("UNEXPECTED_CATALOG_REQUEST"); }),
      launch: async () => { throw new Error("UNEXPECTED_WORKER_LAUNCH"); } });
  } catch (error) {
    broker.close();
    await rm(home, { recursive: true, force: true });
    throw error;
  }
  return { host, pages, receive, entered: entered.promise, reply: () => reply.resolve({ status: "answered" }), commands, stops,
    openPage: (access: Credential) => openPage(host, access, contexts),
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
