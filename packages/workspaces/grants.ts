import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export type DirectoryStatus = "authorized" | "ungranted" | "unknown" | "missing" | "inaccessible" | "changed";
export interface DirectoryAccess { status: DirectoryStatus; canonical?: string }
export interface DirectoryGrant { id: string; path: string; grantedAt: string; status: "valid" | "changed" }
interface Row { id: string; path: string; identity: string; grantedAt: string }
interface Preview { path: string; identity: string; expires: number }
const identity = (path: string) => { const info = statSync(path, { bigint: true });
  if (!info.isDirectory()) throw new Error("DIRECTORY_INVALID"); return `${info.dev}:${info.ino}:${info.birthtimeNs}`; };
function canonical(path: string): string {
  if (!isAbsolute(path) || path.includes("\0") || path.length > 4096) throw new Error("DIRECTORY_INVALID");
  return realpathSync(path);
}

/** Host-owned directory authorization, separate from OMP profiles, sources and Session registration. */
export class DirectoryGrants {
  private readonly db: Database;
  private readonly state: string;
  private readonly stateIdentity: string;
  private readonly previews = new Map<string, Preview>();
  private closed = false;

  constructor(dataDir: string, private readonly now: () => number = Date.now) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    if (!lstatSync(dataDir).isDirectory() || lstatSync(dataDir).isSymbolicLink()) throw new Error("GRANTS_UNAVAILABLE");
    chmodSync(dataDir, 0o700);
    this.state = join(resolve(dataDir), "directory-grants.sqlite");
    try { closeSync(openSync(this.state, "wx", 0o600)); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
    const file = lstatSync(this.state, { bigint: true });
    if (!file.isFile() || file.isSymbolicLink()) throw new Error("GRANTS_UNAVAILABLE");
    chmodSync(this.state, 0o600); this.stateIdentity = `${file.dev}:${file.ino}`;
    this.db = new Database(this.state, { strict: true });
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL,
        identity TEXT NOT NULL, grantedAt TEXT NOT NULL);`);
  }

  private current(): void {
    const file = lstatSync(this.state, { bigint: true });
    if (this.closed || !file.isFile() || file.isSymbolicLink() || `${file.dev}:${file.ino}` !== this.stateIdentity) {
      throw new Error("GRANTS_UNAVAILABLE");
    }
  }

  /** Preview is temporary and grants no rights. Confirmation binds to this exact canonical directory object. */
  preview(input: string): { path: string; confirmation: string; expiresAt: string } {
    this.current();
    for (const [key, preview] of this.previews) if (preview.expires <= this.now()) this.previews.delete(key);
    if (this.previews.size >= 32) throw new Error("GRANT_PREVIEW_LIMIT");
    const path = canonical(input), confirmation = randomUUID(), expires = this.now() + 60_000;
    this.previews.set(confirmation, { path, identity: identity(path), expires });
    return { path, confirmation, expiresAt: new Date(expires).toISOString() };
  }

  confirm(confirmation: string): DirectoryGrant {
    this.current();
    const preview = this.previews.get(confirmation); this.previews.delete(confirmation);
    if (!preview || preview.expires <= this.now()) throw new Error("GRANT_PREVIEW_EXPIRED");
    if (canonical(preview.path) !== preview.path || identity(preview.path) !== preview.identity) {
      throw new Error("DIRECTORY_CHANGED");
    }
    const row = this.db.transaction(() => {
      if (this.db.query<{ count: number }, []>("SELECT count(*) AS count FROM grants").get()!.count >= 256
        && !this.db.query("SELECT id FROM grants WHERE path=?").get(preview.path)) throw new Error("GRANT_LIMIT");
      this.db.query(`INSERT INTO grants VALUES (?, ?, ?, ?) ON CONFLICT(path)
        DO UPDATE SET identity=excluded.identity, grantedAt=excluded.grantedAt`)
        .run(randomUUID(), preview.path, preview.identity, new Date(this.now()).toISOString());
      return this.db.query<Row, [string]>("SELECT * FROM grants WHERE path=?").get(preview.path)!;
    }).immediate();
    return { id: row.id, path: row.path, grantedAt: row.grantedAt, status: "valid" };
  }

  list(): DirectoryGrant[] {
    this.current();
    return this.rows().map(row => ({ id: row.id, path: row.path, grantedAt: row.grantedAt,
      status: this.valid(row) ? "valid" : "changed" }));
  }
  revoke(id: string): void { this.current(); this.db.query("DELETE FROM grants WHERE id=?").run(id); }
  private rows(): Row[] { return this.db.query<Row, []>("SELECT * FROM grants ORDER BY path").all(); }
  private valid(row: Row): boolean {
    try { return canonical(row.path) === row.path && identity(row.path) === row.identity; } catch { return false; }
  }

  /** Recheck on every operation/publication. This policy is not an OS sandbox or an OMP open guarantee. */
  authorize(recorded?: string, expectedCanonical?: string): DirectoryAccess {
    this.current();
    if (!recorded) return { status: "unknown" };
    let path: string;
    try { path = canonical(recorded); identity(path); }
    catch (error) { return { status: error instanceof Error && "code" in error && error.code === "ENOENT"
      ? "missing" : "inaccessible" }; }
    if (expectedCanonical !== undefined && path !== expectedCanonical) return { status: "changed", canonical: path };
    let changed = false;
    for (const row of this.rows()) {
      const child = relative(row.path, path);
      if (child !== "" && (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child))) continue;
      if (this.valid(row)) return { status: "authorized", canonical: path };
      changed = true;
    }
    return { status: changed ? "changed" : "ungranted", canonical: path };
  }
  close(): void { if (!this.closed) { this.closed = true; this.db.close(); this.previews.clear(); } }
}
