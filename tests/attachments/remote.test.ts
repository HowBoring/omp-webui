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
import { attachmentContribution, attachmentHostContribution, attachmentResult,
  type AttachmentRequest } from "../../packages/contracts/attachments.ts";
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

test("typed Host Remote retains selected document bytes and reports only signature checks", async () => {
  const f = await fixture();
  try {
    const documents = [
      ["application/pdf", "JVBERi0xLjcK"],
      ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "UEsDBAE="],
      ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "UEsDBAI="],
      ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "UEsDBAM="],
      ["application/epub+zip", "UEsDBAQ="],
    ] as const;
    for (const [mediaType, encoded] of documents) {
      const document = { mediaType, displayName: "@other.gif", byteLength: Buffer.from(encoded, "base64").length };
      const result = await f.remote.exchange({ operation: "stage-base64", target, descriptor: document, base64: encoded });
      expect(result).toMatchObject({ ok: true, value: { status: "staged", original: { ...document,
        state: "staged-unprepared", nativeAssociation: "unassociated", validation: "signature-only" } } });
      if (!result.ok || result.value.status !== "staged") throw Error("stage refused");
      const read = await f.remote.exchange({ operation: "read-base64", target, objectId: result.value.original.objectId });
      expect(read.ok && read.value).toEqual({ status: "read", original: result.value.original, base64: encoded });
    }
  } finally { await f.dispose(); }
});

test("typed Host Remote reports document quota, signature and UTF-8 refusals without losing a staged original", async () => {
  const f = await fixture();
  try {
    const source = { displayName: "source.ts", mediaType: "text/plain" as const, byteLength: 3 };
    const accepted = await f.remote.exchange({ operation: "stage-base64", target, descriptor: source, base64: "w6kK" });
    if (!accepted.ok || accepted.value.status !== "staged") throw Error("stage refused");
    expect(accepted.value.original.validation).toBe("utf8-only");
    const invalidUtf8 = await f.remote.exchange({ operation: "stage-base64", target, descriptor: source, base64: "YXjh" });
    expect(invalidUtf8.ok && invalidUtf8.value).toEqual({ status: "error", code: "attachment_invalid_utf8" });
    const mislabeled = await f.remote.exchange({ operation: "stage-base64", target,
      descriptor: { ...descriptor, mediaType: "application/pdf" }, base64 });
    expect(mislabeled.ok && mislabeled.value).toEqual({ status: "error", code: "attachment_media_mismatch" });
    const oversized = await f.remote.exchange({ operation: "stage-base64", target, base64: "w6kK",
      descriptor: { ...source, byteLength: 5 * 1024 ** 2 + 1 } });
    expect(oversized.ok && oversized.value).toEqual({ status: "error", code: "attachment_object_budget" });
    const unsupported = await f.remote.exchange({ operation: "stage-base64", target, base64: "UEsDBAE=",
      // @ts-expect-error The public codec must refuse unsupported media declared by a runtime caller.
      descriptor: { displayName: "package.zip", mediaType: "application/zip", byteLength: 5 } });
    expect(unsupported.ok).toBe(false);
    const read = await f.remote.exchange({ operation: "read-base64", target, objectId: accepted.value.original.objectId });
    expect(read.ok && read.value).toEqual({ status: "read", original: accepted.value.original, base64: "w6kK" });
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

test("typed Host Remote checks the reserved base64 length before canonical decoding", async () => {
  const f = await fixture();
  try {
    const source = { displayName: "source.ts", mediaType: "text/plain" as const, byteLength: 1 };
    const stage = (encoded: string, byteLength = 1) => f.remote.exchange({ operation: "stage-base64", target,
      descriptor: { ...source, byteLength }, base64: encoded });
    for (const [encoded, code] of [["!!!!!!!!", "attachment_size_mismatch"],
      ["YWJj", "attachment_size_mismatch"], ["YR==", "attachment_invalid_base64"]] as const) {
      const refused = await stage(encoded);
      expect(refused.ok && refused.value).toEqual({ status: "error", code });
    }
    const full = await stage("!", 1025);
    expect(full.ok && full.value).toEqual({ status: "error", code: "attachment_store_full" });
    const accepted = await stage("YQ==");
    expect(accepted).toMatchObject({ ok: true, value: { status: "staged" } });
    f.unopen();
    const unopened = await stage("!!!!!!!!");
    expect(unopened.ok && unopened.value).toEqual({ status: "error", code: "attachment_authority_unavailable" });
  } finally { await f.dispose(); }
});

test("typed Host Remote result codec refuses validation claims for the wrong media type", () => {
  const metadata = { objectId: "d503e8d2-a0f8-459c-a4fa-ecc916078a14", sha256: "a".repeat(64), stagedAt: 0,
    state: "staged-unprepared", nativeAssociation: "unassociated", displayName: "sample", byteLength: 1 };
  const text = { ...metadata, mediaType: "text/plain", validation: "signature-only" };
  const binary = { ...metadata, mediaType: "application/pdf", validation: "utf8-only" };
  for (const original of [text, binary]) {
    expect(attachmentResult.safeParse({ status: "staged", original }).success).toBe(false);
    expect(attachmentResult.safeParse({ status: "read", original, base64: "YQ==" }).success).toBe(false);
  }
});

test("typed Host Remote result codec accepts known error codes and refuses arbitrary iterator text", () => {
  expect(attachmentResult.safeParse({ status: "error", code: "attachment_invalid_utf8" }).success).toBe(true);
  expect(attachmentResult.safeParse({ status: "error", code: "attachment_foo_834" }).success).toBe(false);
});
