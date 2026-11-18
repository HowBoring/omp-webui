import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";
import { isAttachmentError, type AttachmentErrorName } from "./errors.ts";
import { documentOriginalBytes, imageOriginalBytes, isOriginalMediaType, type OriginalMediaType } from "./media.ts";

export type { ImageMediaType } from "./media.ts";

/** Trusted Host authority, never decoded from browser JSON. No Native access is performed by this store. */
export interface OriginalScope {
  hostId: string; browserId: string; pageId: string; profileId: string; sourceId: string; instanceId: string;
  sessionId: string; canonicalCwd: string; draftId: string; authorityEpoch: string; explicitOpen: true;
}
/** Recheck live browser, directory, exact native identity and trusted page binding on every invocation. */
export type OriginalAccess = () => OriginalScope;
export interface OriginalDescriptor { displayName: string; mediaType: OriginalMediaType; byteLength: number }
export type StagedOriginal = Omit<OriginalDescriptor, "mediaType"> & {
  objectId: string; sha256: string; state: "staged-unprepared"; nativeAssociation: "unassociated";
  stagedAt: number;
} & ({ mediaType: "text/plain"; validation: "utf8-only" }
  | { mediaType: Exclude<OriginalMediaType, "text/plain">; validation: "signature-only" });
export interface OriginalLimits {
  totalBytes: number;
  /** Per-image ceiling. Text and documents have an independent 5 MiB ceiling. */
  objectBytes: number;
  draftBytes: number; draftObjects: number; objects: number; intakes: number;
}
export const originalLimits: Readonly<OriginalLimits> = Object.freeze({ totalBytes: 10 * 1024 ** 3,
  objectBytes: imageOriginalBytes, draftBytes: 32 * 1024 ** 2, draftObjects: 8, objects: 100_000, intakes: 16 });
export interface OriginalStoreOptions {
  dataDir: string;
  /** Only the exclusive Host startup owner may recover interrupted writes; other connections must join. */
  recovery: "exclusive-host-startup" | "shared-connection";
  limits?: Partial<OriginalLimits>;
}
interface Row {
  id: string; scope: string; size: number; displayName: string; mediaType: OriginalMediaType;
  state: "receiving" | "staged-unprepared"; sha256: string | null; stagedAt: number;
}
function fail(code: AttachmentErrorName): never { throw new Error(`attachment_${code}`); }
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const scopeKey = (scope: OriginalScope) => JSON.stringify([scope.hostId, scope.browserId, scope.pageId,
  scope.profileId, scope.sourceId, scope.instanceId, scope.sessionId, scope.canonicalCwd, scope.draftId]);
const scopeFields = ["hostId", "browserId", "pageId", "profileId", "sourceId", "instanceId", "sessionId",
  "canonicalCwd", "draftId", "authorityEpoch"] as const;

/** Exact-byte private store. Its only publication state is staged-unprepared, never a Native receipt. */
export class OriginalStore {
  private readonly db: Database;
  private readonly root: string;
  private readonly rootIdentity: string;
  private readonly limits: OriginalLimits;
  private readonly pending = new Set<string>();
  private closed = false;

  constructor(options: OriginalStoreOptions) {
    this.root = resolve(options.dataDir);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const root = lstatSync(this.root);
    if (!root.isDirectory() || root.isSymbolicLink() || realpathSync(this.root) !== this.root) fail("unsafe_store");
    chmodSync(this.root, 0o700);
    this.rootIdentity = `${root.dev}:${root.ino}`;
    this.limits = { ...originalLimits, ...options.limits };
    if (Object.values(this.limits).some(value => !Number.isSafeInteger(value) || value < 1)) fail("invalid_limits");
    const path = join(this.root, "originals.sqlite");
    try { closeSync(openSync(path, "wx", 0o600)); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
    const file = lstatSync(path);
    if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1) fail("unsafe_store");
    chmodSync(path, 0o600);
    this.db = new Database(path, { strict: true });
    try {
      this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS budget (id INTEGER PRIMARY KEY CHECK(id=1), limits TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS originals (id TEXT PRIMARY KEY, scope TEXT NOT NULL, size INTEGER NOT NULL,
          displayName TEXT NOT NULL, mediaType TEXT NOT NULL, state TEXT NOT NULL,
          sha256 TEXT, stagedAt INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS original_scope ON originals(scope);`);
      this.db.transaction(() => {
        const saved = this.db.query<{ limits: string }, []>("SELECT limits FROM budget WHERE id=1").get();
        if (saved && saved.limits !== JSON.stringify(this.limits)) fail("limits_changed");
        if (!saved) this.db.query("INSERT INTO budget VALUES(1, ?)").run(JSON.stringify(this.limits));
      }).immediate();
      if (options.recovery === "exclusive-host-startup") this.recover();
    } catch (error) { this.db.close(); throw error; }
  }

  private current(access: OriginalAccess, expected?: OriginalScope, signal?: AbortSignal): OriginalScope {
    this.assertRoot();
    if (signal?.aborted) fail("canceled");
    let scope: OriginalScope;
    try { scope = access(); } catch { return fail("authority_unavailable"); }
    if (scope.explicitOpen !== true || scopeFields.some(field => typeof scope[field] !== "string"
      || !scope[field] || scope[field].length > 4096)) fail("authority_unavailable");
    if (expected && (scopeKey(scope) !== scopeKey(expected) || scope.authorityEpoch !== expected.authorityEpoch)) {
      fail("binding_changed");
    }
    return { ...scope };
  }

  private assertRoot(): void {
    if (this.closed) fail("store_closed");
    let root;
    try { root = lstatSync(this.root); } catch { return fail("unsafe_store"); }
    if (!root.isDirectory() || root.isSymbolicLink() || `${root.dev}:${root.ino}` !== this.rootIdentity) {
      fail("unsafe_store");
    }
  }

  private path(id: string, suffix: "partial" | "original"): string {
    if (!idPattern.test(id)) fail("object_unavailable");
    return join(this.root, `${id}.${suffix}`);
  }

  private reserve(scope: OriginalScope, descriptor: OriginalDescriptor): Row {
    if (!descriptor.displayName || descriptor.displayName.length > 255 || /[\u0000-\u001f\u007f]/.test(descriptor.displayName)
      || !isOriginalMediaType(descriptor.mediaType)) fail("invalid_descriptor");
    if (!Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength < 1
      || descriptor.byteLength > this.objectCeiling(descriptor.mediaType)) fail("object_budget");
    return this.db.transaction(() => {
      const total = this.db.query<{ bytes: number; count: number; intakes: number }, []>(
        "SELECT coalesce(sum(size),0) AS bytes, count(*) AS count, "
          + "coalesce(sum(state='receiving'),0) AS intakes FROM originals").get()!;
      const draft = this.db.query<{ bytes: number; count: number }, [string]>(
        "SELECT coalesce(sum(size),0) AS bytes, count(*) AS count FROM originals WHERE scope=?").get(scopeKey(scope))!;
      if (total.bytes + descriptor.byteLength > this.limits.totalBytes || total.count >= this.limits.objects) {
        fail("store_full");
      }
      if (total.intakes >= this.limits.intakes) fail("intake_budget");
      if (draft.count >= this.limits.draftObjects || draft.bytes + descriptor.byteLength > this.limits.draftBytes) {
        fail("draft_budget");
      }
      const row: Row = { id: randomUUID(), scope: scopeKey(scope), size: descriptor.byteLength,
        displayName: descriptor.displayName, mediaType: descriptor.mediaType, state: "receiving", sha256: null,
        stagedAt: Date.now() };
      this.db.query("INSERT INTO originals VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(row.id, row.scope, row.size, row.displayName, row.mediaType, row.state, row.sha256, row.stagedAt);
      return row;
    }).immediate();
  }

  private objectCeiling(mediaType: OriginalMediaType): number {
    return mediaType.startsWith("image/") ? this.limits.objectBytes : documentOriginalBytes;
  }

  async stage(access: OriginalAccess, descriptor: OriginalDescriptor, body: AsyncIterable<Uint8Array>,
    signal?: AbortSignal): Promise<StagedOriginal> {
    const scope = this.current(access, undefined, signal);
    const row = this.reserve(scope, { ...descriptor });
    this.pending.add(row.id);
    let fd: number | undefined;
    try {
      fd = openSync(this.path(row.id, "partial"), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        | constants.O_NOFOLLOW, 0o600);
      const hash = createHash("sha256"), prefix: number[] = [];
      const utf8 = row.mediaType === "text/plain" ? new TextDecoder("utf-8", { fatal: true }) : undefined;
      let written = 0;
      for await (const chunk of cancelableChunks(body, signal)) {
        this.current(access, scope, signal);
        if (!(chunk instanceof Uint8Array) || chunk.byteLength > row.size - written) fail("size_mismatch");
        if (utf8) checkUtf8(utf8, chunk);
        else for (const byte of chunk.subarray(0, 12 - prefix.length)) prefix.push(byte);
        let offset = 0;
        while (offset < chunk.length) offset += writeSync(fd, chunk, offset);
        hash.update(chunk); written += chunk.byteLength;
      }
      this.current(access, scope, signal);
      if (written !== row.size) fail("size_mismatch");
      if (utf8) checkUtf8(utf8);
      else if (!matchesSignature(row.mediaType, prefix)) fail("media_mismatch");
      fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(this.path(row.id, "partial"), this.path(row.id, "original"));
      this.syncDirectory();
      this.current(access, scope, signal);
      row.sha256 = hash.digest("hex"); row.state = "staged-unprepared";
      this.db.query("UPDATE originals SET state=?, sha256=? WHERE id=?").run(row.state, row.sha256, row.id);
      return this.metadata(row);
    } catch (error) {
      if (fd !== undefined) { closeSync(fd); fd = undefined; }
      this.cleanup(row.id);
      if (isAttachmentError(error)) throw error;
      fail("storage_unavailable");
    } finally { this.pending.delete(row.id); }
  }

  async read(access: OriginalAccess, objectId: string, signal?: AbortSignal): Promise<StagedOriginal & { bytes: Uint8Array }> {
    const scope = this.current(access, undefined, signal);
    if (!idPattern.test(objectId)) fail("object_unavailable");
    const row = this.db.query<Row, [string, string]>("SELECT * FROM originals WHERE id=? AND scope=?")
      .get(objectId, scopeKey(scope));
    if (!row || row.state !== "staged-unprepared") fail("object_unavailable");
    const bytes = this.payload(row);
    this.current(access, scope, signal);
    if (bytes.length !== row.size || createHash("sha256").update(bytes).digest("hex") !== row.sha256) {
      fail("original_corrupt");
    }
    return { ...this.metadata(row), bytes };
  }

  private payload(row: Row): Uint8Array {
    let fd: number | undefined;
    try {
      fd = openSync(this.path(row.id, "original"), constants.O_RDONLY | constants.O_NOFOLLOW);
      const file = fstatSync(fd);
      if (!file.isFile() || file.nlink !== 1 || file.size !== row.size || file.size > this.objectCeiling(row.mediaType)) {
        fail("original_corrupt");
      }
      return readFileSync(fd);
    } catch (error) {
      if (error instanceof Error && error.message === "attachment_original_corrupt") throw error;
      return fail("original_unavailable");
    } finally { if (fd !== undefined) closeSync(fd); }
  }

  usage(access: OriginalAccess): { chargedBytes: number; objects: number; totalBytes: number } {
    this.current(access);
    const row = this.db.query<{ chargedBytes: number; objects: number }, []>(
      "SELECT coalesce(sum(size),0) AS chargedBytes, count(*) AS objects FROM originals").get()!;
    return { ...row, totalBytes: this.limits.totalBytes };
  }

  private metadata(row: Row): StagedOriginal {
    if (row.state !== "staged-unprepared" || !row.sha256) fail("object_unavailable");
    const { mediaType } = row;
    const metadata = { objectId: row.id, displayName: row.displayName, byteLength: row.size,
      sha256: row.sha256, state: row.state, nativeAssociation: "unassociated" as const, stagedAt: row.stagedAt };
    return mediaType === "text/plain"
      ? { ...metadata, mediaType, validation: "utf8-only" }
      : { ...metadata, mediaType, validation: "signature-only" };
  }

  private syncDirectory(): void {
    const fd = openSync(this.root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }

  private cleanup(id: string): void {
    // Failed physical cleanup retains the full reservation; never promise quota before reclaiming bytes.
    try {
      this.assertRoot();
      for (const suffix of ["partial", "original"] as const) {
        try { unlinkSync(this.path(id, suffix)); }
        catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
      }
      this.syncDirectory();
      this.db.query("DELETE FROM originals WHERE id=? AND state='receiving'").run(id);
    } catch { /* Startup retries cleanup; bytes remain charged. */ }
  }

  private recover(): void {
    const rows = this.db.query<{ id: string }, []>("SELECT id FROM originals WHERE state='receiving'").all();
    for (const row of rows) this.cleanup(row.id);
    // Unknown payloads indicate a broken exclusive-root contract. Refuse instead of silently omitting their bytes.
    const known = new Map(this.db.query<Row, []>("SELECT * FROM originals").all().map(row => [row.id, row]));
    const physical = new Map<string, number>();
    for (const name of readdirSync(this.root)) {
      if (["originals.sqlite", "originals.sqlite-journal"].includes(name)) continue;
      const match = /^(.*)\.(partial|original)$/.exec(name), id = match?.[1];
      const row = id ? known.get(id) : undefined;
      if (!id || !row || (row.state === "staged-unprepared" && match?.[2] !== "original")) fail("unaccounted_data");
      const file = lstatSync(join(this.root, name)), size = (physical.get(id) ?? 0) + file.size;
      if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || size > row.size) fail("unaccounted_data");
      physical.set(id, size);
    }
  }

  close(): void {
    if (this.closed) return;
    if (this.pending.size) fail("intake_active");
    this.closed = true; this.db.close();
  }
}

function matchesSignature(type: OriginalMediaType, prefix: number[]): boolean {
  const starts = (values: number[]) => values.every((value, index) => prefix[index] === value);
  switch (type) {
    case "image/png": return starts([137, 80, 78, 71, 13, 10, 26, 10]);
    case "image/jpeg": return starts([255, 216, 255]);
    case "image/gif": return starts([71, 73, 70, 56, 55, 97]) || starts([71, 73, 70, 56, 57, 97]);
    case "image/webp": return starts([82, 73, 70, 70]) && prefix.slice(8, 12).join(",") === "87,69,66,80";
    case "application/pdf": return starts([37, 80, 68, 70, 45]); // %PDF-
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/epub+zip": return starts([80, 75, 3, 4]); // ZIP local file header
    case "text/plain": return false; // UTF-8 has no required byte signature.
  }
}

function checkUtf8(decoder: TextDecoder, chunk?: Uint8Array): void {
  // Decode only to validate the stream, including any unfinished character at EOF. Store bytes unchanged.
  try { decoder.decode(chunk, { stream: chunk !== undefined }); }
  catch { fail("invalid_utf8"); }
}

async function* cancelableChunks(body: AsyncIterable<Uint8Array>, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();
  let complete = false;
  try {
    while (true) {
      if (signal?.aborted) fail("canceled");
      let cancel: (() => void) | undefined;
      try {
        const aborted = new Promise<never>((_, reject) => {
          cancel = () => reject(new Error("attachment_canceled"));
          signal?.addEventListener("abort", cancel, { once: true });
        });
        const next = await Promise.race([iterator.next(), aborted]);
        if (next.done) { complete = true; return; }
        yield next.value;
      } finally { if (cancel) signal?.removeEventListener("abort", cancel); }
    }
  } finally {
    // A malicious/stalled producer cannot hold physical cleanup hostage to its return() promise.
    if (!complete) void Promise.resolve(iterator.return?.()).catch(() => {});
  }
}
