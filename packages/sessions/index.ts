import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CatalogDescriptor } from "../contracts/generated/omp-wire.ts";

const text = z.string().min(1).max(4096);
import { sessionAttempt, type SessionAttempt } from "../contracts/session-index.ts";
export type { SessionAttempt } from "../contracts/session-index.ts";
const recordSchema = z.strictObject({ id: z.string().uuid(), reference: text, nativeSessionId: text,
  sourceId: text, instanceId: text, cwd: text.optional(), title: z.string().max(8192).optional(),
  registeredAt: z.string().datetime(), observedAt: z.string().datetime(), attempt: sessionAttempt });
export type RegisteredSession = z.infer<typeof recordSchema>;
interface Row { body: string }
interface Snapshot { records: RegisteredSession[]; offset: number; expires: number; size: number }

/** Metadata-only, FULL synchronous Host persistence. Native files, history, prompts and credentials never enter this store. */
export class SessionIndex {
  readonly #db: Database;
  readonly #file: string;
  readonly #identity: string;
  readonly #directory: string;
  readonly #directoryIdentity: string;
  readonly #pages = new Map<string, Snapshot>();
  #closed = false;
  constructor(dataDir: string, readonly now: () => number = Date.now) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const directory = fs.lstatSync(dataDir, { bigint: true });
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("INDEX_UNAVAILABLE");
    fs.chmodSync(dataDir, 0o700); this.#directory = path.resolve(dataDir);
    this.#directoryIdentity = `${directory.dev}:${directory.ino}`;
    this.#file = path.join(this.#directory, "session-index.sqlite");
    try { fs.closeSync(fs.openSync(this.#file, "wx", 0o600)); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
    const file = fs.lstatSync(this.#file, { bigint: true });
    if (!file.isFile() || file.isSymbolicLink()) throw new Error("INDEX_UNAVAILABLE");
    fs.chmodSync(this.#file, 0o600); this.#identity = `${file.dev}:${file.ino}`;
    this.#db = new Database(this.#file, { strict: true });
    this.#db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, instance TEXT NOT NULL,
        native TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(source, instance, native));`);
    const stored = this.#db.query<{ bytes: number; count: number }, []>(
      "SELECT coalesce(sum(length(CAST(body AS BLOB))),0) AS bytes, count(*) AS count FROM sessions").get()!;
    if (stored.bytes > 16 * 1024 * 1024 || stored.count > 10_000) throw new Error("INDEX_STORAGE_LIMIT");
    for (const record of this.#records()) {
      if (["opening", "open"].includes(record.attempt.state)) {
        record.attempt = { state: "outcome_unknown", code: "SESSION_HOST_RESTARTED_MANUAL_OPEN_REQUIRED" };
        this.#write(record);
      }
    }
  }
  #current(): void {
    try {
      const file = fs.lstatSync(this.#file, { bigint: true });
      const directory = fs.lstatSync(this.#directory, { bigint: true });
      if (this.#closed || !file.isFile() || file.isSymbolicLink() || !directory.isDirectory() || directory.isSymbolicLink()
        || `${file.dev}:${file.ino}` !== this.#identity || `${directory.dev}:${directory.ino}` !== this.#directoryIdentity) {
        throw new Error("INDEX_UNAVAILABLE");
      }
    } catch { throw new Error("INDEX_UNAVAILABLE"); }
  }
  #decode(row: Row): RegisteredSession { return recordSchema.parse(JSON.parse(row.body)); }
  #records(): RegisteredSession[] {
    return this.#db.query<Row, []>("SELECT body FROM sessions ORDER BY id").all().map(row => this.#decode(row));
  }
  #write(record: RegisteredSession): void {
    const checked = recordSchema.parse(record), body = JSON.stringify(checked);
    const bytes = this.#db.query<{ bytes: number }, [string]>(
      "SELECT coalesce(sum(length(CAST(body AS BLOB))),0) AS bytes FROM sessions WHERE id<>?").get(record.id)!.bytes;
    if (bytes + Buffer.byteLength(body) > 16 * 1024 * 1024) throw new Error("INDEX_STORAGE_LIMIT");
    this.#db.query(`INSERT INTO sessions VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body`)
      .run(checked.id, checked.sourceId, checked.instanceId, checked.nativeSessionId, body);
  }
  /** Invoke only for explicit Open or a native-confirmed explicit New. No discovery path calls this operation. */
  register(descriptor: CatalogDescriptor): RegisteredSession {
    this.#current();
    return this.#db.transaction(() => {
      const row = this.#db.query<Row, [string, string, string]>("SELECT body FROM sessions WHERE source=? AND instance=? AND native=?")
        .get(descriptor.sourceId, descriptor.instanceId, descriptor.nativeSessionId);
      const existing = row ? this.#decode(row) : undefined;
      if (!existing && this.#db.query<{ count: number }, []>("SELECT count(*) AS count FROM sessions").get()!.count >= 10_000) {
        throw new Error("INDEX_RECORD_LIMIT");
      }
      const record: RegisteredSession = { ...(existing ?? { id: randomUUID(), registeredAt: new Date(this.now()).toISOString(),
        attempt: { state: "registered" } }), reference: descriptor.reference, nativeSessionId: descriptor.nativeSessionId,
        sourceId: descriptor.sourceId, instanceId: descriptor.instanceId, observedAt: descriptor.observedAt,
        ...(descriptor.cwd.canonical ? { cwd: descriptor.cwd.canonical } : {}), ...(descriptor.title ? { title: descriptor.title } : {}) };
      this.#write(record); return structuredClone(record);
    }).immediate();
  }
  get(id: string): RegisteredSession | undefined {
    this.#current(); const row = this.#db.query<Row, [string]>("SELECT body FROM sessions WHERE id=?").get(id);
    return row ? this.#decode(row) : undefined;
  }
  observe(id: string, attempt: SessionAttempt): RegisteredSession {
    this.#current(); const record = this.get(id); if (!record) throw new Error("INDEX_REFERENCE_UNKNOWN");
    record.attempt = sessionAttempt.parse(attempt); record.observedAt = new Date(this.now()).toISOString(); this.#write(record); return record;
  }
  async page(options: { cursor?: string; pageSize?: number }): Promise<{ records: RegisteredSession[]; nextCursor?: string }> {
    this.#current();
    const size = options.pageSize ?? 32;
    if (!Number.isInteger(size) || size < 1 || size > 32) throw new Error("INDEX_PAGE_LIMIT");
    for (const [id, snapshot] of this.#pages) if (snapshot.expires <= this.now()) this.#pages.delete(id);
    let snapshot: Snapshot;
    if (options.cursor) {
      const found = this.#pages.get(options.cursor); this.#pages.delete(options.cursor);
      if (!found || found.size !== size) throw new Error("INDEX_CURSOR_EXPIRED"); snapshot = found;
    } else {
      if (this.#pages.size >= 8) throw new Error("INDEX_SNAPSHOT_LIMIT");
      snapshot = { records: this.#records(), offset: 0, expires: this.now() + 30_000, size };
      if (Buffer.byteLength(JSON.stringify(snapshot.records)) > 16 * 1024 * 1024) throw new Error("INDEX_SNAPSHOT_LIMIT");
    }
    const records = snapshot.records.slice(snapshot.offset, snapshot.offset + size); snapshot.offset += records.length;
    if (snapshot.offset >= snapshot.records.length) return { records: structuredClone(records) };
    const nextCursor = randomUUID(); this.#pages.set(nextCursor, snapshot);
    return { records: structuredClone(records), nextCursor };
  }
  close(): void { if (!this.#closed) { this.#closed = true; this.#pages.clear(); this.#db.close(); } }
}
