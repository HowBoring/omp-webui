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
import { OriginalStore, type OriginalProtection } from "../../packages/attachments/store.ts";
import { AttachmentRemote } from "../../packages/attachments/service.ts";

const base64 = "R0lGODlhAQABAAAAADs=";
const target = { sessionId: "native", draftId: "draft" };
const descriptor = { displayName: "../../unsafe.gif", mediaType: "image/gif" as const, byteLength: 14 };
async function fixture(protection?: () => OriginalProtection) {
  const dataDir = mkdtempSync("/tmp/attachment-remote-");
  const store = new OriginalStore({ dataDir, recovery: "exclusive-host-startup", limits: { totalBytes: 1024 },
    ...(protection ? { protection } : {}) });
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
  return { remote: client.remote.ompOriginals, store,
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

test("typed Host Remote renews only exact current staged Originals for an explicit draft action", async () => {
  const f = await fixture();
  try {
    const source = { displayName: "notes.txt", mediaType: "text/plain" as const, byteLength: 4 };
    const stage = await f.remote.exchange({ operation: "stage-base64", target, descriptor: source, base64: "bm90ZQ==" });
    if (!stage.ok || stage.value.status !== "staged") throw Error("stage refused");
    const objectId = stage.value.original.objectId;
    const touched = await f.remote.exchange({ operation: "touch", target, activity: "explicit-edit", objectIds: [objectId] });
    expect(touched.ok && touched.value).toEqual({ status: "touched", renewed: [objectId], unavailable: [] });
    const other = "d503e8d2-a0f8-459c-a4fa-ecc916078a14";
    const partial = await f.remote.exchange({ operation: "touch", target, activity: "active-recovery", objectIds: [objectId, other] });
    expect(partial.ok && partial.value).toEqual({ status: "touched", renewed: [objectId], unavailable: [other] });
    const malformed = await f.remote.exchange({ operation: "touch", target,
      // @ts-expect-error The public codec must refuse an unknown retention activity.
      activity: "background-refresh", objectIds: [objectId] });
    expect(malformed.ok).toBe(false);
    f.revoke();
    const refused = await f.remote.exchange({ operation: "touch", target, activity: "explicit-edit", objectIds: [objectId] });
    expect(refused.ok && refused.value.status).toBe("error");
  } finally { await f.dispose(); }
});

test("authorized usage and confirmed deletion preview the whole logical Original over the Host Remote", async () => {
  let protection: OriginalProtection = { status: "unreferenced", revision: "review-1" };
  const f = await fixture(() => protection);
  try {
    const source = { displayName: "notes.txt", mediaType: "text/plain" as const, byteLength: 4 };
    const first = await f.remote.exchange({ operation: "stage-base64", target, descriptor: source, base64: "bm90ZQ==" });
    const second = await f.remote.exchange({ operation: "stage-base64", target, descriptor: source, base64: "bm90ZQ==" });
    if (!first.ok || first.value.status !== "staged" || !second.ok || second.value.status !== "staged") throw Error("stage refused");
    const objectId = first.value.original.objectId;
    const usage = await f.remote.exchange({ operation: "usage", target });
    expect(usage.ok && usage.value).toEqual({ status: "usage", chargedBytes: 8, objects: 2, totalBytes: 1024 });

    const preview = await f.remote.exchange({ operation: "preview-delete", target, objectId });
    if (!preview.ok || preview.value.status !== "deletion-preview") throw Error("preview refused");
    expect(preview.value).toMatchObject({ original: { objectId }, impact: { draftId: "draft",
      losesOriginalAccess: true, laterToolReadsMayFail: true } });
    expect(preview.value.expiresAt).toBeGreaterThan(Date.now());
    protection = { status: "unreferenced", revision: "review-2" };
    expect(await f.remote.exchange({ operation: "delete", target, objectId,
      confirmationId: preview.value.confirmationId })).toEqual({ ok: true,
      value: { status: "error", code: "attachment_deletion_confirmation_required" } });

    const reviewed = await f.remote.exchange({ operation: "preview-delete", target, objectId });
    if (!reviewed.ok || reviewed.value.status !== "deletion-preview") throw Error("preview refused again");
    expect(await f.remote.exchange({ operation: "delete", target, objectId,
      confirmationId: reviewed.value.confirmationId })).toEqual({ ok: true,
      value: { status: "deleted", objectId, reclaimed: true } });
    expect(await f.remote.exchange({ operation: "delete", target, objectId,
      confirmationId: reviewed.value.confirmationId })).toEqual({ ok: true,
      value: { status: "error", code: "attachment_deletion_confirmation_required" } });
    expect(await f.remote.exchange({ operation: "read-base64", target, objectId })).toEqual({ ok: true,
      value: { status: "error", code: "attachment_object_unavailable" } });
    const sibling = await f.remote.exchange({ operation: "read-base64", target, objectId: second.value.original.objectId });
    expect(sibling.ok && sibling.value).toMatchObject({ status: "read", base64: "bm90ZQ==" });
    const afterUsage = await f.remote.exchange({ operation: "usage", target });
    expect(afterUsage.ok && afterUsage.value).toEqual({ status: "usage", chargedBytes: 4, objects: 1, totalBytes: 1024 });
  } finally { await f.dispose(); }
});

test("occupation, execution, unresolved submission, expiry or revoked authority refuse deletion", async () => {
  let protection: OriginalProtection = { status: "occupied" };
  const f = await fixture(() => protection);
  try {
    const source = { displayName: "notes.txt", mediaType: "text/plain" as const, byteLength: 4 };
    const staged = await f.remote.exchange({ operation: "stage-base64", target, descriptor: source, base64: "bm90ZQ==" });
    if (!staged.ok || staged.value.status !== "staged") throw Error("stage refused");
    const objectId = staged.value.original.objectId;
    for (const status of ["occupied", "executing", "unresolved-submission", "native-associated", "unknown"] as const) {
      protection = { status };
      expect(await f.remote.exchange({ operation: "preview-delete", target, objectId })).toEqual({ ok: true,
        value: { status: "error", code: "attachment_original_protected" } });
    }
    protection = { status: "unreferenced", revision: "review" };
    const preview = await f.remote.exchange({ operation: "preview-delete", target, objectId });
    if (!preview.ok || preview.value.status !== "deletion-preview") throw Error("preview refused");
    f.revoke();
    const refused = await f.remote.exchange({ operation: "delete", target, objectId,
      confirmationId: preview.value.confirmationId });
    expect(refused.ok && refused.value.status).toBe("error");
    await expect(f.store.read(() => ({ hostId: "host", browserId: "browser", pageId: "page", profileId: "profile",
      sourceId: "source", instanceId: "instance", sessionId: "native", canonicalCwd: "/synthetic/project",
      draftId: "draft", authorityEpoch: "epoch", explicitOpen: true }), objectId)).resolves.toMatchObject({ objectId });
  } finally { await f.dispose(); }
});
