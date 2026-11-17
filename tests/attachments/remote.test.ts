import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { Context } from "@deepseek-ai/cordis";
import TypertRegistry from "@deepseek-ai/dsh-typert-registry";
import RemoteAccessService from "@deepseek-ai/dsh-api-remote-access";
import { TypertGatewayService } from "@deepseek-ai/dsh-api-gateway";
import { Peer, clientRequestSchema } from "@deepseek-ai/dsh-client-connection";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { z } from "zod";
import { attachmentContribution, attachmentHostContribution, type AttachmentRequest } from "../../packages/contracts/attachments.ts";
import { OriginalStore } from "../../packages/attachments/store.ts";
import { AttachmentRemote } from "../../packages/attachments/service.ts";

const base64 = "R0lGODlhAQABAAAAADs=";
const target = { sessionId: "native", draftId: "draft" };
const descriptor = { displayName: "../../unsafe.gif", mediaType: "image/gif" as const, byteLength: 14 };
async function fixture() {
  const dataDir = mkdtempSync("/tmp/attachment-remote-");
  const store = new OriginalStore({ dataDir, recovery: "exclusive-host-startup", limits: { totalBytes: 1024 } });
  const host = new Context(), client = new Context();
  await host.plugin(TypertRegistry); await host.plugin(RemoteAccessService); await host.plugin(TypertGatewayService, {});
  host.typert.register(attachmentHostContribution);
  const peer = new Peer(host, { principal: { kind: "owner" }, interactions: "none" });
  let permitted = true, opened = true, pageId = "page";
  new AttachmentRemote(host, store, (caller, requested) => {
    if (!permitted || caller !== peer || !opened) throw Error("synthetic refusal");
    return { hostId: "host", browserId: "browser", pageId, profileId: "profile", sourceId: "source",
      instanceId: "instance", sessionId: requested.sessionId, draftId: requested.draftId,
      canonicalCwd: "/synthetic/project", explicitOpen: true, authorityEpoch: "epoch" };
  });
  installConnection(client, { interactions: "none", transport: {
    async fetch(_url, init) {
      const call = clientRequestSchema.parse(JSON.parse(String(init.body)));
      const method = Object.values(attachmentContribution.methods)
        .find(value => `${value.namespace}/${value.method}` === call.method);
      if (!method) throw Error("unexpected endpoint");
      const payload = z.strictObject({ args: z.record(z.string(), z.unknown()) }).parse(call.payload);
      try {
        const value = await host.typertGateway.invoke({ namespace: method.namespace, method: method.method,
          args: payload.args, peer });
        return Response.json({ type: "server-response", rpcId: call.rpcId, result: { ok: true, value } });
      } catch {
        return Response.json({ type: "server-response", rpcId: call.rpcId,
          result: { ok: false, error: { code: "gateway/bad-request", message: "Original refused", details: {} } } });
      }
    }, openStream: async function* () {},
  } });
  registry(client); gateway(client); await client.remote.$mount(attachmentContribution);
  return { remote: client.remote.ompOriginals,
    revoke: () => { permitted = false; }, unopen: () => { opened = false; }, otherPage: () => { pageId = "other"; },
    dispose: async () => { await client.fiber.dispose(); await peer.dispose(); await host.fiber.dispose();
      store.close(); rmSync(dataDir, { recursive: true, force: true }); } };
}

test("proposed Host Remote stages and reads exact originals without preparation or Native claims", async () => {
  const f = await fixture();
  try {
    const result = await f.remote.exchange({ operation: "stage-base64", target, descriptor, base64 });
    expect(result).toMatchObject({ ok: true, value: { status: "staged" } });
    if (!result.ok || result.value.status !== "staged") throw Error("stage refused");
    expect(result.value.original.state).toBe("staged-unprepared");
    expect(result.value.original.nativeAssociation).toBe("unassociated");
    const read = await f.remote.exchange({ operation: "read-base64", target, objectId: result.value.original.objectId });
    expect(read.ok && read.value.status === "read" && read.value.base64).toBe(base64);
    f.otherPage();
    const refused = await f.remote.exchange({ operation: "read-base64", target, objectId: result.value.original.objectId });
    expect(refused.ok && refused.value).toEqual({ status: "error", code: "attachment_object_unavailable" });
  } finally { await f.dispose(); }
});

test("revoked or unopened scopes and noncanonical base64 never stage originals through an owner Peer", async () => {
  for (const change of ["revoke", "unopen", "malformed"] as const) {
    const f = await fixture();
    try {
      if (change !== "malformed") f[change]();
      const request: AttachmentRequest = { operation: "stage-base64", target, descriptor,
        base64: change === "malformed" ? `${base64}\n` : base64 };
      const result = await f.remote.exchange(request);
      expect(!result.ok || result.value.status === "error").toBe(true);
    } finally { await f.dispose(); }
  }
});
