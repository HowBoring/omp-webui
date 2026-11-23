import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { OriginalStore, type OriginalScope } from "../../packages/attachments/store.ts";
import { StockUploads } from "../../apps/host/src/stock-uploads.ts";
import { whitePngAtBytes } from "./png-literal.ts";

const roots: string[] = [];
const stores: OriginalStore[] = [];
const scope: OriginalScope = { hostId: "host", browserId: "browser", pageId: "browser", profileId: "host",
  sourceId: "source", instanceId: "instance", sessionId: "native", canonicalCwd: "/synthetic/project",
  draftId: "draft", authorityEpoch: "epoch", explicitOpen: true };
const identity = { credentialId: "browser", expiresAt: Date.now() + 60_000 };
const png = whitePngAtBytes(200);
const pngBase64 = png.toString("base64");

function fixture() {
  const dataDir = mkdtempSync(join("/tmp", "stock-uploads-"));
  roots.push(dataDir);
  const store = new OriginalStore({ dataDir, recovery: "exclusive-host-startup" });
  stores.push(store);
  let view: { sessionId: string; draftId: string } | undefined = { sessionId: "native", draftId: "draft" };
  const uploads = new StockUploads({
    stageStock: (_caller, _target, descriptor, body, signal) =>
      store.stage(() => ({ ...scope }), descriptor, body, signal),
  }, () => ({ attached: () => view }));
  return { store, uploads, hide: () => { view = undefined; },
    redraft: () => { view = { sessionId: "native", draftId: "other" }; } };
}

async function upload(uploads: StockUploads, bytes: Uint8Array, query: Record<string, string>) {
  const params = new URLSearchParams({ sessionId: "native", ...query });
  const request = new Request(`http://host/api/session/uploadFileBinary?${params}`, {
    method: "POST", headers: { "content-type": "application/octet-stream" }, body: bytes as unknown as BodyInit });
  return (await uploads.handle(identity, request)).json() as Promise<Record<string, any>>;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("a text upload becomes one staged original resolved from its receipt", async () => {
  const f = fixture();
  const bytes = new TextEncoder().encode("hello attachment\n");
  const result = await upload(f.uploads, bytes, { name: "notes.txt" });
  expect(result.ok).toBe(true);
  expect(result.value.file).toMatchObject({ name: "notes.txt", bytes: bytes.length });
  expect(typeof result.value.file.attachmentId).toBe("string");
  const resolved = await f.uploads.resolve(identity, { sessionId: "native", draftId: "draft" },
    [{ type: "text", text: "see " }, { type: "file", receiptId: result.value.receiptId }], new AbortController().signal);
  expect(resolved).toEqual({ message: "see ", originalIds: [result.value.file.attachmentId] });
  expect((await f.store.read(() => ({ ...scope }), result.value.file.attachmentId)).bytes).toEqual(bytes);
});

test("unsupported bytes and a mismatched declared image are explicit business refusals", async () => {
  const f = fixture();
  const binary = await upload(f.uploads, Uint8Array.from([0xff, 0xfe, 0x00]), { name: "opaque.bin" });
  expect(binary).toMatchObject({ ok: false, error: { code: "session/attachment-invalid" } });
  expect(binary.error.details.reason).toBe("unsupported");
  const mismatched = await upload(f.uploads, png, { mediaType: "image/jpeg", name: "renamed.jpg" });
  expect(mismatched).toMatchObject({ ok: false, error: { code: "session/attachment-invalid" } });
  expect(mismatched.error.details.reason).toBe("attachment_media_mismatch");
});

test("a stock image upload reports content geometry from bounded header parsing", async () => {
  const f = fixture();
  const result = await upload(f.uploads, png, { mediaType: "image/png", name: "pixel.png" });
  expect(result.ok).toBe(true);
  expect(result.value.image).toMatchObject({ mediaType: "image/png", bytes: png.length, width: 1, height: 1,
    name: "pixel.png" });
});

test("inline prompt images are staged under the same authority and bounded base64", async () => {
  const f = fixture();
  const resolved = await f.uploads.resolve(identity, { sessionId: "native", draftId: "draft" },
    [{ type: "image", mediaType: "image/png", data: pngBase64, name: "pixel.png" }], new AbortController().signal);
  expect(resolved.message).toBe("");
  expect(resolved.originalIds).toHaveLength(1);
  expect((await f.store.read(() => ({ ...scope }), resolved.originalIds[0]!)).bytes).toEqual(png);
  await expect(f.uploads.resolve(identity, { sessionId: "native", draftId: "draft" },
    [{ type: "image", mediaType: "image/png", data: "not base64!" }], new AbortController().signal))
    .rejects.toThrow("ATTACHMENT_FORMAT_UNSUPPORTED");
});

test("a receipt is bound to the attached draft and never survives a detach", async () => {
  const f = fixture();
  const result = await upload(f.uploads, new TextEncoder().encode("draft bound\n"), { name: "notes.txt" });
  f.redraft();
  await expect(f.uploads.resolve(identity, { sessionId: "native", draftId: "other" },
    [{ type: "file", receiptId: result.value.receiptId }], new AbortController().signal))
    .rejects.toThrow("ATTACHMENT_DRAFT_CHANGED");
  f.hide();
  const detached = await upload(f.uploads, new TextEncoder().encode("detached\n"), { name: "notes.txt" });
  expect(detached.ok).toBe(false);
});

test("the encoded Remote upload shares staging and receipt authority with the raw route", async () => {
  const f = fixture();
  const bytes = new TextEncoder().encode("remote upload\n");
  const value = await f.uploads.upload(identity, "native", {
    data: Buffer.from(bytes).toString("base64"), name: "remote.txt" });
  expect(value.file).toMatchObject({ name: "remote.txt", bytes: bytes.length });
  const resolved = await f.uploads.resolve(identity, { sessionId: "native", draftId: "draft" },
    [{ type: "file", receiptId: value.receiptId }], new AbortController().signal);
  expect(resolved.originalIds).toEqual([value.file.attachmentId]);
  await expect(f.uploads.upload(identity, "native", { data: pngBase64, name: "pixel.png" }))
    .rejects.toThrow("Only files are accepted by this transport.");
  f.hide();
  await expect(f.uploads.upload(identity, "native", { data: "", name: "late.txt" }))
    .rejects.toThrow("not attached");
});
