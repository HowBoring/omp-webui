import { expect, spyOn, test } from "bun:test";
import { Context } from "@deepseek-ai/cordis";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import {
  isRemoteEventClientId, parseRemoteStreamClientMessage, parseRemoteStreamServerMessage, REMOTE_EVENT_STREAM_ENDPOINT, REMOTE_EVENT_STREAM_PAYLOAD,
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
  brokerAnswerStreamContribution, brokerAnswerStreamEndpoint, brokerContribution, brokerPendingSnapshotEndpoint,
  brokerSnapshotContribution, readBrokerAnswer, readBrokerSnapshot, type BrokerSnapshot,
} from "../../packages/contracts/interaction-broker.ts";
import { InteractionBroker, type PageIdentity } from "../../packages/interactions/broker.ts";

type Carrier = Awaited<ReturnType<typeof startSessionComponentServer>>;
type Credential = { cookie: string; csrf: string };
type Mode = "shared-cookie-snapshot" | "shared-cookie-answer";
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
  mode: Mode | undefined, interactions: "answer" | "none") {
  const ctx = new Context();
  contexts.push(ctx);
  const ready = Promise.withResolvers<Ready>(), reconnected = Promise.withResolvers<Ready>();
  const responses: number[] = [];
  const sockets: WebSocket[] = [];
  const frames: RemoteStreamServerMessage[] = [];
  const opens: { endpoint: string; streamId: string; bytes: number }[] = [];
  const origin = host.server.url.origin;
  installConnection(ctx, { interactions, transport: {
    streamBaseUrl: host.server.url.href,
    createWebSocket(url) {
      const socket = connect(url, access.cookie, origin);
      sockets.push(socket);
      const send = socket.send.bind(socket);
      socket.send = data => {
        if (typeof data === "string") {
          const frame = parseRemoteStreamClientMessage(data);
          if (frame.type === "open") {
            opens.push({ endpoint: frame.endpoint, streamId: frame.streamId, bytes: Buffer.byteLength(data) });
          }
        }
        send(data);
      };
      observeReady(socket, sockets.length === 1 ? ready.resolve : reconnected.resolve, frames);
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
  await ctx.remote.$mount(mode === "shared-cookie-answer" ? brokerAnswerStreamContribution
    : mode === "shared-cookie-snapshot" ? brokerSnapshotContribution : brokerContribution);
  return { ready: ready.promise, reconnected: reconnected.promise, remote: ctx.remote.ompInteractionBroker, responses, sockets, frames, opens,
    dispose: () => ctx.fiber.dispose() };
}

async function delivery(page: Awaited<ReturnType<typeof openPage>>) {
  const result = await page.remote.pending();
  expect(page.responses.at(-1)).toBe(200);
  if (!result.ok) throw result.error;
  expect(result.value.pending).toHaveLength(1);
  return result.value.pending[0]!;
}

async function fixture(mode?: Mode) {
  const home = await mkdtemp(join(tmpdir(), "omp-broker-carrier-"));
  const contexts: Context[] = [];
  const pages = new Map<string, PageIdentity>();
  const reply = Promise.withResolvers<{ status: "answered" | "cancelled" }>();
  let clockFault = false, scopeCurrent = true, revokeOnRead = false;
  let scopeReadsBeforeLoss: number | undefined;
  let monotonic = 0;
  const timers = new Map<() => void, number>();
  const entered = Promise.withResolvers<RespondUiParams>(), repeated = Promise.withResolvers<RespondUiParams>();
  const commands: RespondUiParams[] = [], stops: string[] = [];
  const broker = new InteractionBroker({ kind: "startup", contextId: "controlled-startup" }, "worker", "root", {
    respondUi: async command => {
      commands.push(command);
      (commands.length === 1 ? entered : repeated).resolve(command);
      return reply.promise;
    },
    requestStop: async reason => { stops.push(reason); },
  }, page => {
    pages.set(page.clientId, page);
    if (scopeReadsBeforeLoss !== undefined && --scopeReadsBeforeLoss === 0) {
      scopeReadsBeforeLoss = undefined;
      queueMicrotask(() => { scopeCurrent = false; });
    }
    return scopeCurrent;
  }, {
    now() {
      if (clockFault) throw new Error("fixture private clock failure");
      if (revokeOnRead) scopeCurrent = false;
      return mode ? monotonic : performance.now();
    },
    wall: mode ? () => 10_000 + monotonic : Date.now,
    schedule(delay, callback) {
      if (mode) {
        timers.set(callback, monotonic + delay);
        return () => { timers.delete(callback); };
      }
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
      ...(mode ? { interactionBrokerMode: mode } : {}),
      catalog: new CatalogClient(async () => { throw new Error("UNEXPECTED_CATALOG_REQUEST"); }),
      launch: async () => { throw new Error("UNEXPECTED_WORKER_LAUNCH"); } });
  } catch (error) {
    broker.close();
    await rm(home, { recursive: true, force: true });
    throw error;
  }
  return { host, pages, receive, entered: entered.promise, repeated: repeated.promise, commands, stops,
    reply: (status: "answered" | "cancelled" = "answered") => reply.resolve({ status }),
    failClock: () => { clockFault = true; },
    loseScope: () => { scopeCurrent = false; },
    restoreScope: () => { scopeCurrent = true; },
    loseScopeAfterAdmission: () => { scopeReadsBeforeLoss = 2; },
    advance: (elapsed: number) => { monotonic += elapsed; },
    runDueTimers() {
      for (const [callback, deadline] of timers) {
        if (deadline > monotonic) continue;
        timers.delete(callback);
        callback();
      }
    },
    loseScopeOnRead: () => { revokeOnRead = true; },
    openPage: (access: Credential, interactions: "answer" | "none" = "answer") =>
      openPage(host, access, contexts, mode, interactions),
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
const answerFailure = { ...snapshotFailure, message: "Interaction answer failed." };
type Page = Awaited<ReturnType<typeof openPage>>;
type Delivery = BrokerSnapshot["pending"][number];

function openAnswer(page: Page, { card, deliveryId }: Delivery, csrf: string, value = "explicit") {
  return page.remote.answerStream(card.generation, card.id, deliveryId, { type: "value", value }, csrf);
}

function snapshot(page: Awaited<ReturnType<typeof openPage>>) {
  return readBrokerSnapshot(page.remote.pendingSnapshot());
}

test("shared-cookie Browser Views retain separate Broker snapshots across a logical end and reconnect", async () => {
  const f = await fixture("shared-cookie-snapshot");
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

test("same-credential DSH Clients reserve one Broker answer while its Native acknowledgement is held", async () => {
  const f = await fixture("shared-cookie-answer");
  try {
    const access = await login(f.host);
    const first = await f.openPage(access), second = await f.openPage(access);
    const firstReady = await first.ready, secondReady = await second.ready;
    f.receive("shared-answer");
    const a = (await snapshot(first)).pending[0]!, b = (await snapshot(second)).pending[0]!;
    expect(firstReady.clientId).not.toBe(secondReady.clientId);
    expect(f.pages.get(firstReady.clientId)?.credentialId).toBe(f.pages.get(secondReady.clientId)?.credentialId);
    expect(a.deliveryId).not.toBe(b.deliveryId);

    const input = { type: "value", value: "explicit ✓" } as const;
    const before = [first.frames.length, second.frames.length];
    const answers = [readBrokerAnswer(first.remote.answerStream(a.card.generation, a.card.id, a.deliveryId, input, access.csrf)),
      readBrokerAnswer(second.remote.answerStream(b.card.generation, b.card.id, b.deliveryId, input, access.csrf))];
    expect(await f.entered).toEqual({ targetId: "shared-answer", answer: input });
    expect(await Promise.race(answers)).toEqual({ status: "stale" });
    expect(f.commands).toHaveLength(1);
    f.reply();
    expect((await Promise.all(answers)).map(result => result.status).sort()).toEqual(["answered", "stale"]);
    for (const [i, page] of [first, second].entries()) {
      const frames = page.frames.slice(before[i]);
      expect(frames.map(frame => frame.type)).toEqual(["item", "end"]);
      expect(frames[1]?.streamId).toBe(frames[0]?.streamId);
      expect((await snapshot(page)).pending).toEqual([]);
      expect(page.responses).toEqual([]);
    }
    expect(f.commands).toHaveLength(1);
    expect(f.stops).toEqual([]);
  } finally { await f.close(); }
});

test("a sibling's explicit cancel is stale while the winning Broker answer awaits Native acknowledgement", async () => {
  const f = await fixture("shared-cookie-answer");
  try {
    const access = await login(f.host);
    const winner = await f.openPage(access), sibling = await f.openPage(access);
    await Promise.all([winner.ready, sibling.ready]);
    f.receive("held-before-cancel");
    const delivery = (await snapshot(winner)).pending[0]!;
    const { card, deliveryId } = (await snapshot(sibling)).pending[0]!;
    expect(await readBrokerAnswer(sibling.remote.answerStream(card.generation, card.id, deliveryId,
      { type: "cancel", timedOut: true }, access.csrf))).toEqual({ status: "invalid" });
    expect(f.commands).toEqual([]);

    const answer = readBrokerAnswer(openAnswer(winner, delivery, access.csrf));
    expect(await f.entered).toEqual({ targetId: card.id, answer: { type: "value", value: "explicit" } });
    const cancel = readBrokerAnswer(sibling.remote.answerStream(card.generation, card.id, deliveryId,
      { type: "cancel" }, access.csrf));
    const beforeAcknowledgement = await Promise.race([cancel, f.repeated]);
    const reservedCount = f.commands.length;
    f.reply();
    expect(await answer).toEqual({ status: "answered" });
    expect(beforeAcknowledgement).toEqual({ status: "stale" });
    expect(reservedCount).toBe(1);
    expect(f.commands).toHaveLength(1);
    expect(f.stops).toEqual([]);
  } finally { await f.close(); }
});

test("shared-cookie answer checks the ready Peer, credential proof and scope before reserving", async () => {
  const f = await fixture("shared-cookie-answer");
  try {
    const access = await login(f.host), other = await login(f.host);
    const page = await f.openPage(access), passive = await f.openPage(access, "none"), sibling = await f.openPage(access);
    const ready = await page.ready;
    await sibling.ready;
    f.receive("protected-answer");
    const entry = (await snapshot(page)).pending[0]!;
    for (const proof of ["", "a".repeat(44), other.csrf]) {
      const offset = page.frames.length;
      await expect(readBrokerAnswer(openAnswer(page, entry, proof))).rejects.toMatchObject(answerFailure);
      expect(page.frames.slice(offset)).toEqual([{ type: "error", streamId: expect.any(String), error: answerFailure }]);
    }
    await expect(readBrokerAnswer(openAnswer(passive, entry, access.csrf))).rejects.toMatchObject(answerFailure);
    expect(await readBrokerAnswer(openAnswer(sibling, entry, access.csrf))).toEqual({ status: "stale" });
    expect((await post(f.host, access, "/api/ompInteractionBroker/answer", pending)).status).toBe(501);
    expect(f.commands).toEqual([]);

    // Let both synchronous admission checks succeed, then withdraw scope at the Gateway's async boundary.
    f.loseScopeAfterAdmission();
    await expect(readBrokerAnswer(openAnswer(page, entry, access.csrf))).rejects.toMatchObject(answerFailure);
    expect(ready.socket.readyState).toBe(WebSocket.OPEN);
    expect(f.commands).toEqual([]);
    f.restoreScope();
    expect((await snapshot(page)).pending).toEqual([entry]);
    f.reply();
    expect(await readBrokerAnswer(openAnswer(page, entry, access.csrf))).toEqual({ status: "answered" });
    expect(f.commands).toHaveLength(1);
    expect(f.stops).toEqual([]);
  } finally { await f.close(); }
});

test.each(["answer", "events", "socket"] as const)(
  "ending a held Broker answer's %s releases the view while Native settlement continues once", async cancellation => {
    const f = await fixture("shared-cookie-answer");
    try {
      const access = await login(f.host);
      const first = await f.openPage(access), sibling = await f.openPage(access);
      const { socket, streamId, clientId } = await first.ready;
      await sibling.ready;
      f.receive("held-answer");
      const old = (await snapshot(first)).pending[0]!;
      const siblingDelivery = (await snapshot(sibling)).pending[0]!;
      const handle = openAnswer(first, old, access.csrf);
      const result = readBrokerAnswer(handle).catch((error: unknown) => error);
      expect(await f.entered).toEqual({ targetId: "held-answer", answer: { type: "value", value: "explicit" } });
      const answerId = first.opens.findLast(frame => frame.endpoint === brokerAnswerStreamEndpoint)?.streamId;
      if (!answerId) throw new Error("Missing Broker answer open");
      const offset = first.frames.length;
      f.receive("still-pending");
      const pending = (await snapshot(first)).pending[0]!;

      if (cancellation === "answer") {
        handle.dispose();
        expect(await result).toMatchObject({ code: "gateway/protocol" });
        // An ordered round trip on this Peer lets cancellation unwind before reusing the released logical ID.
        expect((await snapshot(first)).pending).toEqual([pending]);
        expect(first.frames.slice(offset).filter(frame => frame.streamId === answerId)).toEqual([]);
        socket.send(JSON.stringify({ type: "open", streamId: answerId, endpoint: brokerPendingSnapshotEndpoint,
          payload: { args: {} } }));
        expect((await snapshot(first)).pending).toEqual([pending]);
        expect(first.frames.filter(frame => frame.streamId === answerId).map(frame => frame.type)).toEqual(["item", "end"]);
      } else if (cancellation === "events") {
        socket.send(JSON.stringify({ type: "cancel", streamId }));
        expect(await result).toMatchObject(answerFailure);
        expect(first.frames.slice(offset).filter(frame => frame.streamId === answerId)).toEqual([
          { type: "error", streamId: answerId, error: answerFailure },
        ]);
        await expect(snapshot(first)).rejects.toMatchObject(snapshotFailure);
        expect(socket.readyState).toBe(WebSocket.OPEN);
      } else {
        const closed = waitForClose(socket);
        socket.close();
        await closed;
        expect(await result).toMatchObject({ name: "RemoteStreamCarrierError" });
        expect(first.frames.slice(offset).filter(frame => frame.streamId === answerId)).toEqual([]);
      }

      expect(await readBrokerAnswer(openAnswer(sibling, siblingDelivery, access.csrf))).toEqual({ status: "stale" });
      f.advance(600_000);
      const fresh = cancellation === "socket" ? first : await f.openPage(access);
      const ready = await (cancellation === "socket" ? fresh.reconnected : fresh.ready);
      expect(ready.clientId).not.toBe(clientId);
      expect(first.opens.filter(frame => frame.endpoint === brokerAnswerStreamEndpoint)).toHaveLength(1);
      const current = await snapshot(fresh);
      expect(current.pending).toHaveLength(1);
      expect(current.pending[0]?.card).toEqual(pending.card);
      expect(current.pending[0]?.deliveryId).not.toBe(pending.deliveryId);
      expect(await readBrokerAnswer(openAnswer(fresh, old, access.csrf))).toEqual({ status: "stale" });
      expect(f.commands).toHaveLength(1);
      f.reply();
      expect((await snapshot(fresh)).outcomes).toContainEqual({
        id: "held-answer", status: "answered", reason: "explicit-answer", stop: "none",
      });
      expect(f.commands).toHaveLength(1);
      expect(f.stops).toEqual([]);
    } finally { await f.close(); }
  },
);

test("the shared-cookie answer budget counts the complete UTF-8 open frame", async () => {
  const f = await fixture("shared-cookie-answer");
  try {
    const access = await login(f.host);
    const first = await f.openPage(access);
    const { socket } = await first.ready;
    f.receive("budget-answer");
    const entry = (await snapshot(first)).pending[0]!;
    const prefix = '😀"\n';
    const overhead = Buffer.byteLength(JSON.stringify({
      type: "open", streamId: "00000000-0000-0000-0000-000000000000", endpoint: brokerAnswerStreamEndpoint,
      payload: { args: { generation: entry.card.generation, interactionId: entry.card.id, deliveryId: entry.deliveryId,
        answer: { type: "value", value: prefix }, csrf: access.csrf } },
    }));
    const room = 16_384 - overhead;
    const fitted = prefix + "界".repeat(Math.floor(room / 3)) + "x".repeat(room % 3);
    const oversized = readBrokerAnswer(openAnswer(first, entry, access.csrf, fitted + "x"));
    await expect(oversized).rejects.toMatchObject({ name: "RemoteStreamCarrierError" });
    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect(first.opens.at(-1)?.bytes).toBe(16_385);
    expect(f.commands).toEqual([]);

    const fresh = await f.openPage(access);
    await fresh.ready;
    const renewed = (await snapshot(fresh)).pending[0]!;
    f.reply();
    expect(await readBrokerAnswer(openAnswer(fresh, renewed, access.csrf, fitted))).toEqual({ status: "answered" });
    expect(fresh.opens.at(-1)?.bytes).toBe(16_384);
    expect(f.commands).toEqual([{ targetId: "budget-answer", answer: { type: "value", value: fitted } }]);
    expect(f.stops).toEqual([]);
  } finally { await f.close(); }
});

test("an overdue Broker snapshot omits the card while expiry waits for its timer", async () => {
  const f = await fixture("shared-cookie-snapshot");
  try {
    const page = await f.openPage(await login(f.host));
    await page.ready;
    f.receive("overdue");
    expect((await snapshot(page)).pending[0]?.card.deadline).toBe(1_810_000);

    f.advance(1_800_001);
    const start = page.frames.length;
    const overdue = await snapshot(page);
    expect(overdue).toMatchObject({ accepting: true, pending: [], outcomes: [] });
    const frames = page.frames.slice(start);
    expect(frames).toEqual([
      { type: "item", streamId: expect.any(String), value: overdue },
      { type: "end", streamId: frames[0]?.streamId ?? "" },
    ]);
    expect(f.commands).toEqual([]);
    expect(f.stops).toEqual([]);

    f.runDueTimers();
    const cancellation: RespondUiParams = { targetId: "overdue", answer: { type: "cancel", timedOut: true } };
    expect(await f.entered).toEqual(cancellation);
    expect(f.commands).toEqual([cancellation]);
    expect(f.stops).toEqual(["expired"]);
    f.reply("cancelled");
  } finally { await f.close(); }
});

function waitForClose(socket: WebSocket): Promise<number> {
  return new Promise(resolve => socket.addEventListener("close", event => resolve(event.code), { once: true }));
}

test.each([
  { terminal: "end", status: 0, mode: "shared-cookie-snapshot" },
  { terminal: "end", status: -1, mode: "shared-cookie-snapshot" },
  { terminal: "error", status: 0, mode: "shared-cookie-snapshot" },
  { terminal: "error", status: -1, mode: "shared-cookie-snapshot" },
  { terminal: "end", status: 0, mode: "shared-cookie-answer" },
  { terminal: "error", status: -1, mode: "shared-cookie-answer" },
] as const)("a $mode $terminal write returning $status closes the carrier once", async ({ terminal, status, mode }) => {
  const wire: RemoteStreamServerMessage["type"][] = [];
  const closures: (number | undefined)[] = [];
  let armed = false, intercept = true;
  const serve = Bun.serve;
  const stub = spyOn(Bun, "serve").mockImplementation(options => {
    const websocket = options.websocket;
    if (!websocket) throw new Error("Expected the Broker WebSocket adapter");
    const open = websocket.open;
    websocket.open = function (socket) {
      if (intercept) {
        intercept = false;
        const send = socket.send.bind(socket);
        socket.send = (message, compress) => {
          if (!armed || typeof message !== "string") return send(message, compress);
          const frame = parseRemoteStreamServerMessage(message);
          wire.push(frame.type);
          return frame.type === terminal ? status : send(message, compress);
        };
        const close = socket.close.bind(socket);
        socket.close = (code, reason) => {
          if (armed) closures.push(code);
          close(code, reason);
        };
      }
      return open?.call(this, socket);
    };
    return serve(options);
  });
  const f = await fixture(mode).finally(() => { stub.mockRestore(); });
  try {
    const access = await login(f.host);
    const page = await f.openPage(access);
    const { socket } = await page.ready;
    f.receive("terminal-write");
    const entry = (await snapshot(page)).pending[0]!;
    f.reply();
    const closed = waitForClose(socket);
    if (terminal === "error") f.loseScope();
    armed = true;

    const result = mode === "shared-cookie-answer" ? readBrokerAnswer(openAnswer(page, entry, access.csrf)) : snapshot(page);
    const failure = result.catch((error: unknown) => error);
    expect(await Promise.race([closed, Bun.sleep(1_000).then(() => "socket remained open")])).toBe(1011);
    expect(await failure).toMatchObject({ name: "RemoteStreamCarrierError" });
    expect(wire).toEqual(terminal === "end" ? ["item", "end"] : ["error"]);
    expect(closures).toEqual([1011]);
    expect(f.commands).toHaveLength(mode === "shared-cookie-answer" && terminal === "end" ? 1 : 0);
    expect(f.stops).toEqual([]);
  } finally { await f.close(); }
});

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
