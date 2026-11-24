/** Synthetic public Connection/Gateway/Remote fixture; no browser or native runtime. */
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
import type {} from "@deepseek-ai/dsh-settings/types";
import { TYPERT_REMOTE } from "@deepseek-ai/dsh-api-settings-controller/remote";
import { WebPreferences, preferencesHostContribution } from "../../packages/preferences/service.ts";

/** The stock theme subscriber reads a complete section, so every read carries its defaults. */
const THEME = Object.freeze({ preference: "system", fontSize: 14, codeFontSize: 11, terminalFontSize: 13,
  textFontFamily: "", codeFontFamily: "", terminalFontFamily: "" });

async function fixture() {
  const host = new Context(), client = new Context();
  await host.plugin(TypertRegistry);
  await host.plugin(RemoteAccessService);
  await host.plugin(TypertGatewayService, {});
  host.typert.register(preferencesHostContribution);
  const createPeer = () => new Peer(host, { principal: { kind: "owner" }, interactions: "none" });
  let peer = createPeer();
  let authorized = true;
  let cancelInvocation = false;
  let cancelPeer = false;
  const notifications: { ns: string; revision: number }[] = [];
  host.on("settings/document-updated", (ns, revision) => { notifications.push({ ns, revision }); });
  new WebPreferences(host, caller => {
    if (caller !== peer || !authorized) throw new Error("PREFERENCES_AUTH_REQUIRED");
  });
  installConnection(client, { interactions: "none", transport: {
    async fetch(_url, init) {
      const call = clientRequestSchema.parse(JSON.parse(String(init.body)));
      const method = Object.values(TYPERT_REMOTE.methods)
        .find(value => `${value.namespace}/${value.method}` === call.method);
      if (!method) throw new Error("unknown fixture endpoint");
      const payload = z.strictObject({ args: z.record(z.string(), z.unknown()) }).parse(call.payload);
      const args = z.record(z.string(), z.unknown()).parse(method.input({ strict: true }).create().parse(payload.args));
      const signal = cancelInvocation ? AbortSignal.abort(new Error("Synthetic carrier cancellation")) : undefined;
      const disposePeer = cancelPeer;
      cancelInvocation = false;
      cancelPeer = false;
      let peerDisposal: Promise<void> | undefined;
      try {
        const pending = host.typertGateway.invoke({ namespace: method.namespace, method: method.method, args, peer,
          ...(signal === undefined ? {} : { signal }) });
        // invoke has admitted the live Peer and yielded during public receiver preparation.
        // Keep that Peer as the authorized credential until the pending invocation settles.
        if (disposePeer) peerDisposal = peer.dispose();
        const value = await pending;
        return Response.json({ type: "server-response", rpcId: call.rpcId, result: { ok: true, value } });
      } catch {
        // Carrier deliberately withholds host/provider error text and all configuration material.
        return Response.json({ type: "server-response", rpcId: call.rpcId,
          result: { ok: false, error: {
            code: "gateway/bad-request", message: "Preference edit refused", details: {},
          } } });
      } finally {
        await peerDisposal;
        if (disposePeer) peer = createPeer();
      }
    }, openStream: async function* () {},
  } });
  registry(client); gateway(client);
  await client.remote.$mount(TYPERT_REMOTE);
  return { remote: client.remote.settings, notifications,
    revoke: () => { authorized = false; }, authorize: () => { authorized = true; },
    cancelNextInvocation: () => { cancelInvocation = true; }, cancelNextPeer: () => { cancelPeer = true; },
    dispose: async () => { await client.fiber.dispose(); await peer.dispose(); await host.fiber.dispose(); } };
}

test("a WebUI theme preference is read and changed through the actual settings Remote", async () => {
  const f = await fixture();
  try {
    const before = await f.remote.describe();
    expect(before.ok && before.value.namespaces.map(row => row.ns)).toEqual(["ui-theme", "locale"]);
    const saved = await f.remote.mutate("ui-theme", [{ op: "set", path: ["preference"], value: "dark" }], 0);
    expect(saved.ok && { value: saved.value.value, revision: saved.value.revision }).toEqual({
      value: { ...THEME, preference: "dark" }, revision: 1,
    });
    const after = await f.remote.describe();
    expect(after.ok && after.value.namespaces[0]?.value).toEqual({ ...THEME, preference: "dark" });
    expect(after.ok && after.value.hasDocument).toBe(false);
  } finally { await f.dispose(); }
});

test("a canceled carrier invocation cannot change a preference, its revision or its public notification", async () => {
  const f = await fixture();
  try {
    f.cancelNextInvocation();
    expect((await f.remote.mutate("ui-theme", [{ op: "set", path: ["preference"], value: "dark" }], 0)).ok).toBe(false);
    const after = await f.remote.describe();
    expect(after.ok && after.value.namespaces.map(row => ({ value: row.value, revision: row.revision })))
      .toEqual([{ value: THEME, revision: 0 }, { value: {}, revision: 0 }]);
    expect(f.notifications).toEqual([]);
  } finally { await f.dispose(); }
});

test("a Peer canceled after admission cannot change preferences, revisions or notifications", async () => {
  const f = await fixture();
  try {
    f.cancelNextPeer();
    expect((await f.remote.mutate("locale", [{ op: "set", path: ["preference"], value: "zh-CN" }], 0)).ok).toBe(false);
    const after = await f.remote.describe();
    expect(after.ok && after.value.namespaces.map(row => ({ value: row.value, revision: row.revision })))
      .toEqual([{ value: THEME, revision: 0 }, { value: {}, revision: 0 }]);
    expect(f.notifications).toEqual([]);
  } finally { await f.dispose(); }
});

test("locale preference edits preserve theme and unset delegates language selection to the browser", async () => {
  const f = await fixture();
  try {
    expect((await f.remote.mutate("locale", [{ op: "set", path: ["preference"], value: "zh-CN" }], 0)).ok).toBe(true);
    const saved = await f.remote.describe();
    expect(saved.ok && saved.value.namespaces.map(row => row.value)).toEqual([
      THEME, { preference: "zh-CN" },
    ]);
    const cleared = await f.remote.mutate("locale", [{ op: "unset", path: ["preference"] }], 1);
    expect(cleared.ok && { value: cleared.value.value, revision: cleared.value.revision })
      .toEqual({ value: {}, revision: 2 });
  } finally { await f.dispose(); }
});

test("stale or unconditional edits cannot overwrite another page's accepted preference", async () => {
  const f = await fixture();
  try {
    await f.remote.mutate("ui-theme", [{ op: "set", path: ["preference"], value: "dark" }], 0);
    for (const revision of [0, undefined, -1, 0.5]) {
      expect((await f.remote.mutate("ui-theme", [{ op: "set", path: ["preference"], value: "light" }], revision)).ok)
        .toBe(false);
    }
    const after = await f.remote.describe();
    expect(after.ok && after.value.namespaces[0]?.value).toEqual({ ...THEME, preference: "dark" });
  } finally { await f.dispose(); }
});

test("expired browser authority refuses reads and edits even for the DSH owner principal", async () => {
  const f = await fixture();
  try {
    f.revoke();
    expect((await f.remote.describe()).ok).toBe(false);
    expect((await f.remote.mutate("ui-theme", [{ op: "set", path: ["preference"], value: "dark" }], 0)).ok).toBe(false);
    f.authorize();
    const after = await f.remote.describe();
    expect(after.ok && after.value.namespaces[0]?.value).toEqual(THEME);
  } finally { await f.dispose(); }
});

test("global configuration, unknown capabilities and malformed edits cannot change WebUI state", async () => {
  const f = await fixture();
  try {
    for (const ns of ["providers", "credentials", "plugins", "default-model", "ui-theme/extra"]) {
      expect((await f.remote.mutate(ns, [{ op: "set", path: ["preference"], value: "dark" }], 0)).ok).toBe(false);
    }
    for (const op of [
      { op: "set", path: [], value: "dark" },
      { op: "set", path: ["apiKey"], value: "SYNTHETIC_REJECTED_VALUE" },
      { op: "set", path: ["preference", "nested"], value: "dark" },
      { op: "set", path: ["preference"], value: "unknown-theme" },
      { op: "set", path: ["preference"], value: { token: "SYNTHETIC_REJECTED_VALUE" } },
    ] as const) {
      expect((await f.remote.mutate("ui-theme", [structuredClone({ ...op, path: [...op.path] })], 0)).ok).toBe(false);
    }
    expect((await f.remote.update("ui-theme", { preference: "dark" }, 0)).ok).toBe(false);
    expect((await f.remote.replace("ui-theme", { preference: "dark" }, 0)).ok).toBe(false);
    expect((await f.remote.openSettingsDocument()).ok).toBe(false);
    const after = await f.remote.describe();
    expect(after.ok && after.value.namespaces.map(row => ({
      value: row.value, revision: row.revision, secrets: row.secrets,
    }))).toEqual([
      { value: THEME, revision: 0, secrets: [] }, { value: {}, revision: 0, secrets: [] },
    ]);
  } finally { await f.dispose(); }
});


test("accepted preference changes publish the public settings invalidation event for other views", async () => {
  const f = await fixture();
  try {
    await f.remote.mutate("ui-theme", [{ op: "set", path: ["preference"], value: "dark" }], 0);
    await f.remote.mutate("ui-theme", [{ op: "set", path: ["preference"], value: "light" }], 0);
    expect(f.notifications).toEqual([{ ns: "ui-theme", revision: 1 }]);
  } finally { await f.dispose(); }
});
