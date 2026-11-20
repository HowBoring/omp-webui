/** Actual shared Session carrier + Gateway/Connection/Remote, all envelopes in memory. No sockets/listeners. */
import { expect, spyOn, test } from "bun:test";
import { Context } from "@deepseek-ai/cordis";
import TypertRegistry from "@deepseek-ai/dsh-typert-registry";
import RemoteAccessService from "@deepseek-ai/dsh-api-remote-access";
import { TypertGatewayService } from "@deepseek-ai/dsh-api-gateway";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { Peer, clientRequestSchema } from "@deepseek-ai/dsh-client-connection";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { dispatchSessionRequest } from "../../apps/host/src/session-remote-dispatch.ts";
import { sessionsContribution, sessionsHostContribution } from "../../packages/contracts/sessions.ts";
import { SessionsService, sessionCaller } from "../../packages/sessions/service.ts";
import { sourceFixture } from "./source-fixture.ts";

async function fixture() {
  const f = await sourceFixture(), host = new Context(), client = new Context();
  await host.plugin(TypertRegistry); await host.plugin(RemoteAccessService); await host.plugin(TypertGatewayService, {});
  host.typert.register(sessionsHostContribution);
  new SessionsService(host, f);
  const peer = new Peer(host, { principal: { kind: "owner" }, interactions: "none" });
  const observed: { status: number; body: string; requestId: string }[] = [];
  const dispatch = (request: Request) => sessionCaller.run(f.identity,
    () => dispatchSessionRequest(request, host, peer, () => f.authority.revalidate(f.identity)));
  installConnection(client, { interactions: "none", transport: {
    async fetch(url, init) {
      const request = new Request(new URL(url, f.origin), { ...init, headers: { "content-type": "application/json" } });
      const response = await dispatch(request);
      observed.push({ status: response.status, body: await response.clone().text(),
        requestId: clientRequestSchema.parse(JSON.parse(String(init.body))).rpcId });
      return response;
    }, openStream: async function* () {},
  } });
  registry(client); gateway(client); await client.remote.$mount(sessionsContribution);
  const page = await client.remote.ompSessions.catalog({});
  if (!page.ok) throw page.error;
  const [first, second] = page.value.choices;
  if (!first || !second) throw new Error("SYNTHETIC_CHOICES_MISSING");
  return { ...f, remote: client.remote.ompSessions, first, second, observed, dispatch,
    async close() { await client.fiber.dispose(); await peer.dispose(); await host.fiber.dispose(); await f.close(); } };
}

test("a fresh explicit Open clears an expired selection failure while sharing the same worker", async () => {
  const f = await fixture(), clock = spyOn(Date, "now").mockReturnValue(Date.now());
  try {
    const first = await f.remote.open(f.first.selectionId);
    if (!first.ok) throw first.error;
    clock.mockReturnValue(Date.now() + 60_001);
    expect(await f.remote.open(f.first.selectionId)).toMatchObject({ ok: false,
      error: { code: "SESSION_SELECTION_EXPIRED" } });
    expect(await f.remote.index({})).toMatchObject({ ok: true, value: { records: [
      { attempt: { state: "failed", code: "SESSION_SELECTION_EXPIRED" } } ] } });
    expect(await f.remote.recheck()).toMatchObject({ ok: true, value: {
      registration: { attempt: { state: "failed", code: "SESSION_SELECTION_EXPIRED" } } } });
    const catalog = await f.remote.catalog({});
    if (!catalog.ok) throw catalog.error;
    const choice = catalog.value.choices.find(item => item.nativeSessionId === f.first.nativeSessionId)!;
    expect(await f.remote.open(choice.selectionId)).toMatchObject({ ok: true, value: {
      workerId: first.value.workerId, generation: first.value.generation, state: "open",
      registration: { id: first.value.registration.id, attempt: { state: "open" } } } });
    expect(await f.remote.index({})).toMatchObject({ ok: true,
      value: { records: [{ id: first.value.registration.id, attempt: { state: "open" } }] } });
    expect(f.supervisor.starts).toBe(1); expect(f.controls.closed).toBe(false);
    expect(await f.remote.revoke(f.grant.id)).toMatchObject({ ok: true });
    expect(f.controls.closed).toBe(true);
    expect(await f.remote.index({})).toMatchObject({ ok: true,
      value: { records: [{ attempt: { state: "closed" } }] } });
  } finally { clock.mockRestore(); await f.close(); }
});

test("an older shared Open cannot clear a selection failure recorded while its confirmation was pending", async () => {
  const f = await fixture(), clock = spyOn(Date, "now").mockReturnValue(Date.now());
  const reached = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let pending: Promise<unknown> | undefined;
  try {
    expect((await f.remote.open(f.first.selectionId)).ok).toBe(true);
    const observe = f.controls.observe;
    f.controls.observe = async () => { reached.resolve(); await release.promise; return observe(); };
    pending = f.remote.open(f.first.selectionId); await reached.promise;
    clock.mockReturnValue(Date.now() + 60_001);
    expect(await f.remote.open(f.first.selectionId)).toMatchObject({ ok: false,
      error: { code: "SESSION_SELECTION_EXPIRED" } });
    release.resolve(); await pending;
    expect(await f.remote.index({})).toMatchObject({ ok: true,
      value: { records: [{ attempt: { state: "failed", code: "SESSION_SELECTION_EXPIRED" } }] } });
    expect(f.supervisor.starts).toBe(1); expect(f.controls.closed).toBe(false);
  } finally { release.resolve(); await pending; clock.mockRestore(); await f.close(); }
});

test("an unconfirmed shared Open leaves the expired-selection failure durable", async () => {
  const f = await fixture(), clock = spyOn(Date, "now").mockReturnValue(Date.now());
  try {
    expect((await f.remote.open(f.first.selectionId)).ok).toBe(true);
    clock.mockReturnValue(Date.now() + 60_001);
    expect(await f.remote.open(f.first.selectionId)).toMatchObject({ ok: false,
      error: { code: "SESSION_SELECTION_EXPIRED" } });
    const catalog = await f.remote.catalog({});
    if (!catalog.ok) throw catalog.error;
    const choice = catalog.value.choices.find(item => item.nativeSessionId === f.first.nativeSessionId)!;
    f.controls.observe = async () => ({ version: "strict-start-v1", phase: "outcome_unknown", code: "STRICT_START_OUTCOME_UNKNOWN" });
    expect(await f.remote.open(choice.selectionId)).toMatchObject({ ok: false,
      error: { code: "STRICT_START_OUTCOME_UNKNOWN" } });
    expect(await f.remote.index({})).toMatchObject({ ok: true,
      value: { records: [{ attempt: { state: "failed", code: "SESSION_SELECTION_EXPIRED" } }] } });
    expect(f.supervisor.starts).toBe(1); expect(f.controls.closed).toBe(false);
  } finally { clock.mockRestore(); await f.close(); }
});

test("busy New and Switch return correlated typed lifecycle failures with an explicit recovery action", async () => {
  const f = await fixture();
  try {
    expect((await f.remote.open(f.first.selectionId)).ok).toBe(true);
    f.controls.busy = true;
    for (const result of [await f.remote.new(f.grant.id), await f.remote.switch(f.second.selectionId)]) {
      expect(result).toMatchObject({ ok: false, error: { code: "SESSION_WORKER_BUSY_STOP_REQUIRED", details: {},
        message: "Stop the active Session and wait for confirmed quiescence, then explicitly retry New or Switch." } });
      if (result.ok) throw new Error("expected busy refusal");
      if (result.error.code === "SESSION_WORKER_BUSY_STOP_REQUIRED") expect(result.error.details).toEqual({});
    }
    expect(f.observed.every(call => call.status === 200 && JSON.parse(call.body).rpcId === call.requestId)).toBe(true);
    expect(f.supervisor.starts).toBe(1);
  } finally { await f.close(); }
});


test("known typed errors keep safe codes while arbitrary native messages and forged objects are sanitized", async () => {
  const f = await fixture(), secret = `SYNTHETIC_SECRET ${f.home}/private-history`;
  try {
    for (const thrown of [new Error(secret), secret, { code: "STRICT_OCCUPIED", message: secret,
      details: { secret }, isDSHRemoteError: true }, Object.assign(new Error(secret), { code: "STRICT_" + "A".repeat(200) })]) {
      f.controls.catalogFailure = thrown;
      expect(await f.remote.catalog({})).toMatchObject({ ok: false,
        error: { code: "gateway/internal", message: "Session request failed.", details: {} } });
    }
    for (const [thrown, code] of [
      [new RemoteError("SESSION_NATIVE_REPLACED", secret, {}), "SESSION_NATIVE_REPLACED"],
      [new RemoteError("SESSION_NATIVE_REPLACED", "STRICT_OCCUPIED", {}), "SESSION_NATIVE_REPLACED"],
      [Object.assign(new Error(secret), { code: "EIO", path: secret }), "EIO"],
      [new Error("STRICT_OCCUPIED"), "STRICT_OCCUPIED"],
    ] as const) {
      f.controls.catalogFailure = thrown;
      expect(await f.remote.catalog({})).toMatchObject({ ok: false, error: { code, details: {} } });
    }
    for (const call of f.observed) {
      expect(call.status).toBe(200); expect(JSON.parse(call.body).rpcId).toBe(call.requestId);
      expect(call.body).not.toContain(secret); expect(call.body).not.toContain('"stack"');
    }
  } finally { await f.close(); }
});

test("malformed carrier envelopes reject before invocation while a valid stale choice returns a correlated failure", async () => {
  const f = await fixture();
  try {
    const endpoint = f.origin + "/api/ompSessions/open";
    const valid = { type: "client-request", rpcId: "synthetic-call", method: "ompSessions/open",
      payload: { args: { selectionId: crypto.randomUUID() } } };
    for (const body of ["{", JSON.stringify({ ...valid, rpcId: 123 }), JSON.stringify({ ...valid, method: "ompSessions/new" }),
      JSON.stringify({ ...valid, payload: { args: { selectionId: "invalid" } } })]) {
      const response = await f.dispatch(new Request(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body }));
      expect(response.status).toBe(400); expect(await response.text()).not.toContain("rpcId");
    }
    const media = await f.dispatch(new Request(endpoint, { method: "POST", body: "{" })); expect(media.status).toBe(415);
    const response = await f.dispatch(new Request(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(valid) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ type: "server-response", rpcId: "synthetic-call", result: { ok: false,
      error: { code: "SESSION_SELECTION_EXPIRED", message: "Refresh discovered Sessions and explicitly select the Session again.", details: {} } } });
    expect(f.supervisor.starts).toBe(0);
  } finally { await f.close(); }
});

test("unconfirmed New returns manual recovery through Remote without inventing a registration", async () => {
  const f = await fixture();
  try {
    f.controls.start = async () => ({ version: "strict-start-v1", phase: "outcome_unknown", code: "STRICT_NEW_OUTCOME_UNKNOWN" });
    expect(await f.remote.new(f.grant.id)).toMatchObject({ ok: false,
      error: { code: "STRICT_NEW_OUTCOME_UNKNOWN", message:
        "The Session outcome is unconfirmed. Observe its state manually before another explicit action; do not replay work.", details: {} } });
    expect(await f.remote.index({})).toEqual({ ok: true, value: { records: [] } });
    expect(f.controls.closed).toBe(false); expect(f.supervisor.starts).toBe(1);
  } finally { await f.close(); }
});
