/** Public Session Remote settings: synthetic worker state through the actual Host service and carrier. */
import { expect, test } from "bun:test";
import { Context } from "@deepseek-ai/cordis";
import TypertRegistry from "@deepseek-ai/dsh-typert-registry";
import RemoteAccessService from "@deepseek-ai/dsh-api-remote-access";
import { TypertGatewayService } from "@deepseek-ai/dsh-api-gateway";
import { Peer } from "@deepseek-ai/dsh-client-connection";
import { brandString } from "@deepseek-ai/dsh-brand";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { dispatchSessionRequest } from "../../apps/host/src/session-remote-dispatch.ts";
import { sessionsContribution, sessionsHostContribution } from "../../packages/contracts/sessions.ts";
import { SessionsService, sessionCaller } from "../../packages/sessions/service.ts";
import { preferencesRemoteContribution } from "../../packages/preferences/remote.ts";
import type { SessionWorkerId } from "../../packages/contracts/sessions.ts";
import { sourceFixture } from "./source-fixture.ts";

async function fixture() {
  const f = await sourceFixture(), host = new Context(), client = new Context();
  await host.plugin(TypertRegistry); await host.plugin(RemoteAccessService); await host.plugin(TypertGatewayService, {});
  host.typert.register(sessionsHostContribution);
  new SessionsService(host, f);
  const peer = new Peer(host, { principal: { kind: "owner" }, interactions: "none" });
  installConnection(client, { interactions: "none", transport: {
    async fetch(url, init) {
      const request = new Request(new URL(url, f.origin), { ...init, headers: { "content-type": "application/json" } });
      return sessionCaller.run(f.identity,
        () => dispatchSessionRequest(request, host, peer, () => f.authority.revalidate(f.identity)));
    }, openStream: async function* () {},
  } });
  registry(client); gateway(client); await client.remote.$mount(sessionsContribution);
  const page = await client.remote.ompSessions.catalog({});
  if (!page.ok) throw page.error;
  const [first] = page.value.choices;
  if (!first) throw new Error("SYNTHETIC_CHOICES_MISSING");
  const opened = await client.remote.ompSessions.open(first.selectionId);
  if (!opened.ok) throw opened.error;
  return { ...f, remote: client.remote.ompSessions, view: opened.value,
    async close() { await client.fiber.dispose(); await peer.dispose(); await host.fiber.dispose(); await f.close(); } };
}

const identity = (view: { workerId: string; generation: string; revision?: number }) => ({
  workerId: brandString<SessionWorkerId>(view.workerId), generation: view.generation, revision: view.revision ?? 0 });

test("native model and thinking write through and read back the final worker state", async () => {
  const f = await fixture();
  try {
    const before = await f.remote.preferences(f.view.workerId);
    if (!before.ok) throw before.error;
    expect(identity(before.value)).toEqual({ workerId: f.view.workerId, generation: f.view.generation, revision: 0 });
    expect(before.value.busy).toBe(false);
    expect(before.value.model).toEqual({ provider: "synthetic", id: "fixture", name: "Fixture" });
    expect(before.value.thinking).toEqual({ level: "off", levels: ["off", "low", "high"] });
    expect(before.value.models.map(model => model.id)).toEqual(["fixture", "other"]);

    const changed = await f.remote.applyPreferences({ ...identity(before.value),
      model: { provider: "synthetic", id: "other" }, thinking: "high" });
    if (!changed.ok) throw changed.error;
    expect(changed.value.revision).toBe(1);
    expect(changed.value.model).toEqual({ provider: "synthetic", id: "other", name: "other" });
    expect(changed.value.thinking.level).toBe("high");
    expect(f.controls.model.id).toBe("other"); expect(f.controls.thinkingLevel).toBe("high");
    expect(await f.remote.preferences(f.view.workerId)).toMatchObject({ ok: true, value: {
      revision: 1, model: { id: "other" }, thinking: { level: "high" } } });
    expect(await f.remote.recheck()).toMatchObject({ ok: true, value: {
      workerId: f.view.workerId, generation: f.view.generation, state: "open" } });
    expect(f.controls.closed).toBe(false);
  } finally { await f.close(); }
});

test("stale revision, replaced generation, busy and revoked authority cannot report success", async () => {
  const f = await fixture();
  try {
    const before = await f.remote.preferences(f.view.workerId);
    if (!before.ok) throw before.error;
    expect(await f.remote.applyPreferences({ ...identity(before.value), revision: 0,
      thinking: "low" })).toMatchObject({ ok: true, value: { revision: 1 } });
    expect(await f.remote.applyPreferences({ ...identity(before.value), revision: 0,
      thinking: "high" })).toMatchObject({ ok: false, error: { code: "gateway/bad-request" } });
    expect(f.controls.thinkingLevel).toBe("low");

    expect(await f.remote.applyPreferences({ ...identity(before.value), revision: 1,
      generation: crypto.randomUUID(), thinking: "high" }))
      .toMatchObject({ ok: false, error: { code: "gateway/bad-request" } });
    expect(f.controls.thinkingLevel).toBe("low");

    f.controls.busy = true;
    expect(await f.remote.applyPreferences({ ...identity(before.value), revision: 1,
      thinking: "high" })).toMatchObject({ ok: false, error: { code: "gateway/bad-request" } });
    expect(f.controls.thinkingLevel).toBe("low");
    f.controls.busy = false;

    f.authority.revokeAll();
    expect(await f.remote.applyPreferences({ ...identity(before.value), revision: 1,
      thinking: "high" })).toMatchObject({ ok: false });
    expect(f.controls.thinkingLevel).toBe("low");
  } finally { await f.close(); }
});

test("unknown model and unsupported thinking level fail closed without a native write", async () => {
  const f = await fixture();
  try {
    const before = await f.remote.preferences(f.view.workerId);
    if (!before.ok) throw before.error;
    expect(await f.remote.applyPreferences({ ...identity(before.value), revision: 0,
      model: { provider: "synthetic", id: "missing" } }))
      .toMatchObject({ ok: false, error: { code: "gateway/bad-request" } });
    expect(f.controls.model.id).toBe("fixture");
    expect(await f.remote.applyPreferences({ ...identity(before.value), revision: 0, thinking: "max" }))
      .toMatchObject({ ok: false, error: { code: "gateway/bad-request" } });
    expect(f.controls.thinkingLevel).toBe("off");
    expect(await f.remote.preferences(f.view.workerId)).toMatchObject({ ok: true, value: { revision: 0 } });
  } finally { await f.close(); }
});

test("the Chat client mounts only the WebUI presentation settings methods", () => {
  expect(preferencesRemoteContribution.package).toBe("@deepseek-ai/dsh-api-settings-controller");
  expect(preferencesRemoteContribution.descriptors.map(value => `${value.namespace}/${value.method}`))
    .toEqual(["settings/describe", "settings/mutate"]);
  expect(Object.keys(preferencesRemoteContribution.methods)).toEqual(["settings/describe", "settings/mutate"]);
  expect(preferencesRemoteContribution.descriptors.some(value => value.namespace === "credentials"
    || value.namespace === "settings" && (value.method === "document" || value.method === "replace"
      || value.method === "update"))).toBe(false);
});
