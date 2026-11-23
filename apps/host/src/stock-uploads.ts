/**
 * Stock `fileUploads/upload` transport: the stock composer posts raw bytes, then submits the receipt
 * inside a normal `session/prompt`. Authority is the attached View; bytes stay in the private Store.
 */
import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import { TYPERT_REMOTE as FILE_UPLOAD_REMOTE } from "@deepseek-ai/dsh-client-file-upload/remote";
import type { EncodedFileUploadRequest, FileUploadValue } from "@deepseek-ai/dsh-client-file-upload/types";
import { Remote, RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";
import type { BrowserAccess } from "../../../packages/access/index.ts";
import { attachmentName, classifyAttachment } from "../../../packages/attachments/classify.ts";
import { documentOriginalBytes, imageDimensions, imageOriginalBytes, isImageMediaType,
  sniffImage, type OriginalMediaType } from "../../../packages/attachments/media.ts";
import type { AttachmentTarget, OriginalDescriptor } from "../../../packages/contracts/attachments.ts";
import { chatSessionId } from "../../../packages/contracts/chat.ts";
import type { SessionPromptRequest } from "@deepseek-ai/dsh-api-session-controller/types";
import { sessionCaller } from "../../../packages/sessions/service.ts";

/** Host face of the stock `fileUploads` Remote; the browser Blob path still uses the HTTP route. */
export const stockUploadsHostContribution: TypertContribution = {
  package: FILE_UPLOAD_REMOTE.package, face: "host", schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: FILE_UPLOAD_REMOTE.descriptors.filter(value => value.namespace === "fileUploads"),
};
/** The two Host seams this transport needs; the real authority and runtime satisfy them. */
export interface StockAuthority {
  stageStock(caller: BrowserAccess, target: AttachmentTarget, descriptor: OriginalDescriptor,
    body: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<{ objectId: string }>;
}
export interface StockRuntime {
  attached(identity: BrowserAccess, sessionId: string): { sessionId: string; draftId: string } | undefined;
}

const receiptLifetimeMs = 30 * 60_000;
const receiptLimit = 256;
const imageDataCeiling = 4 * Math.ceil(imageOriginalBytes / 3);

interface Receipt {
  readonly credential: string;
  readonly sessionId: string;
  readonly draftId: string;
  readonly objectId: string;
  readonly mediaType: OriginalMediaType;
  readonly name: string;
  readonly bytes: number;
  readonly at: number;
}

export class StockUploadError extends Error {
  constructor(message: string, readonly reason = "invalid_request") { super(message); }
}

const extension: Record<OriginalMediaType, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "text/plain": "txt", "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/epub+zip": "epub",
};

async function* oneShot(bytes: Uint8Array): AsyncGenerator<Uint8Array> { yield bytes; }

function refusal(error: unknown): StockUploadError {
  if (error instanceof StockUploadError) return error;
  const code = error instanceof Error ? error.message : "";
  const message = code === "attachment_draft_budget" || code === "attachment_object_budget"
    ? "The draft can hold at most 8 attachments and 32 MiB."
    : code === "attachment_authority_unavailable" || code === "attachment_binding_changed"
      ? "The Session view is no longer attached."
      : code === "attachment_media_mismatch" || code === "attachment_invalid_utf8" || code === "attachment_size_mismatch"
        ? "The file content changed or does not match its declared type."
        : code === "attachment_storage_unavailable" || code === "attachment_store_full"
          ? "The attachment store is full or unavailable."
          : "The attachment was refused.";
  return new StockUploadError(message, code || "invalid_request");
}

function jsonFailure(error: StockUploadError): Response {
  return Response.json({ ok: false, error: { code: "session/attachment-invalid", message: error.message,
    details: { reason: error.reason } } }, { headers: { "cache-control": "no-store" } });
}

export class StockUploads {
  readonly #receipts = new Map<string, Receipt>();
  constructor(private readonly authority: StockAuthority, private readonly runtime: () => StockRuntime) {}

  /** `POST /api/session/uploadFileBinary` with octet-stream bytes; errors stay HTTP-200 business results. */
  async handle(identity: BrowserAccess, request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
    if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/octet-stream") {
      return new Response("content type must be application/octet-stream", { status: 415 });
    }
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");
    const name = url.searchParams.get("name") ?? undefined;
    const declared = url.searchParams.get("mediaType") ?? undefined;
    if (!sessionId || !chatSessionId.safeParse(sessionId).success) return jsonFailure(new StockUploadError("The Session is unavailable."));
    const target = this.runtime().attached(identity, sessionId);
    if (!target) return jsonFailure(new StockUploadError("The Session view is not attached."));
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await request.arrayBuffer()); }
    catch { return jsonFailure(new StockUploadError("The upload was interrupted.")); }
    try {
      return Response.json({ ok: true, value: await this.#stage(identity, target, bytes, name, declared, request.signal) },
        { headers: { "cache-control": "no-store" } });
    } catch (error) { return jsonFailure(refusal(error)); }
  }

  /** `fileUploads/upload` for encoded bytes; staging, receipts and refusals match {@link handle}. */
  async upload(identity: BrowserAccess, sessionId: string, request: EncodedFileUploadRequest,
    signal?: AbortSignal): Promise<FileUploadValue> {
    if (!chatSessionId.safeParse(sessionId).success) throw new StockUploadError("The Session is unavailable.");
    const target = this.runtime().attached(identity, sessionId);
    if (!target) throw new StockUploadError("The Session view is not attached.");
    if (typeof request.data !== "string" || request.data.length % 4 !== 0
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(request.data)) {
      throw new StockUploadError("The upload is invalid.", "attachment_invalid_base64");
    }
    const bytes = Buffer.from(request.data, "base64");
    if (bytes.toString("base64") !== request.data) throw new StockUploadError("The upload is invalid.", "attachment_invalid_base64");
    const staged = await this.#stage(identity, target, bytes, request.name, undefined,
      signal ?? new AbortController().signal);
    if (!("file" in staged)) throw new StockUploadError("Only files are accepted by this transport.", "unsupported");
    return { receiptId: staged.receiptId as FileUploadValue["receiptId"],
      file: staged.file as unknown as FileUploadValue["file"] };
  }

  /** Exact prompt content for one attempt: text and receipt-backed or inline originals, never browser bytes. */
  async resolve(identity: BrowserAccess, target: AttachmentTarget, content: SessionPromptRequest["content"],
    signal: AbortSignal): Promise<{ message: string; originalIds: string[] }> {
    const parts = content.filter(part => part.type !== "text");
    if (!parts.length) throw Error("ATTACHMENT_NOT_READY");
    if (parts.length > 8) throw Error("ATTACHMENT_DRAFT_BUDGET");
    let total = 0, message = "";
    const originalIds: string[] = [];
    for (const part of content) {
      if (part.type === "text") { message += part.text; continue; }
      if (part.type === "file") {
        const receipt = this.#receipt(part.receiptId, identity, target);
        if (originalIds.includes(receipt.objectId)) throw Error("ATTACHMENT_DRAFT_CHANGED");
        originalIds.push(receipt.objectId); total += receipt.bytes;
        continue;
      }
      if (!isImageMediaType(part.mediaType) || part.data.length > imageDataCeiling
        || part.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(part.data)) throw Error("ATTACHMENT_FORMAT_UNSUPPORTED");
      const bytes = Buffer.from(part.data, "base64");
      if (bytes.toString("base64") !== part.data || !bytes.length) throw Error("ATTACHMENT_INVALID_BASE64");
      if (bytes.length > imageOriginalBytes || sniffImage(bytes) !== part.mediaType
        || !imageDimensions(bytes, part.mediaType)) throw Error("ATTACHMENT_FORMAT_UNSUPPORTED");
      const descriptor = { displayName: attachmentName(part.name ?? `image.${extension[part.mediaType]}`),
        mediaType: part.mediaType, byteLength: bytes.length } as const;
      const staged = await this.authority.stageStock(identity, target, descriptor, oneShot(bytes), signal);
      originalIds.push(staged.objectId); total += bytes.length;
    }
    if (!originalIds.length || total > 32 * 1024 ** 2) throw Error("ATTACHMENT_DRAFT_BUDGET");
    return { message, originalIds };
  }

  #receipt(id: string, identity: BrowserAccess, target: AttachmentTarget): Receipt {
    const receipt = this.#receipts.get(id);
    if (!receipt || receipt.at < Date.now() - receiptLifetimeMs) throw Error("ATTACHMENT_ORIGINAL_UNAVAILABLE");
    if (receipt.credential !== identity.credentialId || receipt.sessionId !== target.sessionId
      || receipt.draftId !== target.draftId) throw Error("ATTACHMENT_DRAFT_CHANGED");
    return receipt;
  }

  async #stage(identity: BrowserAccess, target: AttachmentTarget, bytes: Uint8Array, name: string | undefined,
    declared: string | undefined, signal: AbortSignal) {
    if (!bytes.length) throw new StockUploadError("The file is empty.");
    if (bytes.length > imageOriginalBytes) throw new StockUploadError("The file exceeds the 10 MiB attachment limit.");
    let mediaType: OriginalMediaType;
    if (declared !== undefined) {
      if (!isImageMediaType(declared)) throw new StockUploadError("Only PNG, JPEG, WebP, or GIF images are supported.");
      if (sniffImage(bytes) !== declared) {
        throw new StockUploadError("The image content does not match its declared type.", "attachment_media_mismatch");
      }
      mediaType = declared;
    } else {
      try { mediaType = classifyAttachment(bytes, name === undefined ? {} : { name }); }
      catch (error) { throw new StockUploadError(error instanceof Error ? error.message : "The file is not supported.", "unsupported"); }
    }
    if (!mediaType.startsWith("image/") && bytes.length > documentOriginalBytes) {
      throw new StockUploadError("The file exceeds the 5 MiB document limit.");
    }
    const size = isImageMediaType(mediaType) ? imageDimensions(bytes, mediaType) : undefined;
    if (isImageMediaType(mediaType) && (!size || size.width < 1 || size.height < 1)) {
      throw new StockUploadError("The image dimensions cannot be read.", "attachment_decoded_invalid");
    }
    const displayName = attachmentName(name ?? (isImageMediaType(mediaType) ? `image.${extension[mediaType]}` : "attachment"));
    const staged = await this.authority.stageStock(identity, target, { displayName, mediaType, byteLength: bytes.length },
      oneShot(bytes), signal);
    const receiptId = randomUUID();
    this.#prune();
    this.#receipts.set(receiptId, { credential: identity.credentialId, sessionId: target.sessionId,
      draftId: target.draftId, objectId: staged.objectId, mediaType, name: displayName,
      bytes: bytes.length, at: Date.now() });
    return isImageMediaType(mediaType)
      ? { receiptId, image: { attachmentId: staged.objectId, mediaType, bytes: bytes.length,
        width: size!.width, height: size!.height, name: displayName } }
      : { receiptId, file: { attachmentId: staged.objectId, name: displayName, bytes: bytes.length } };
  }

  #prune(): void {
    const now = Date.now();
    for (const [id, receipt] of this.#receipts) if (receipt.at < now - receiptLifetimeMs) this.#receipts.delete(id);
    while (this.#receipts.size >= receiptLimit) {
      const oldest = this.#receipts.keys().next().value;
      if (oldest === undefined) break;
      this.#receipts.delete(oldest);
    }
  }
}

/** Host service answering the stock `fileUploads/upload` Remote with the same private Store authority. */
export class FileUploadsRemote extends TypertRemoteService {
  constructor(ctx: Context, private readonly uploads: StockUploads) { super(ctx, "fileUploads"); }

  @Remote("upload") async upload(agent: { readonly id: string }, request: EncodedFileUploadRequest,
    signal?: AbortSignal): Promise<FileUploadValue> {
    const identity = sessionCaller.getStore();
    if (!identity) throw new RemoteError("gateway/bad-request", "Upload authority is unavailable.", {});
    try { return await this.uploads.upload(identity, agent.id, request, signal); }
    catch (error) {
      const reason = error instanceof StockUploadError ? error.reason : "invalid_request";
      throw new RemoteError("session/attachment-invalid" as never,
        error instanceof Error ? error.message : "The upload was refused.", { reason } as never);
    }
  }
}
