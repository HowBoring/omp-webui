import { Database } from "bun:sqlite";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

const random = () => randomBytes(32).toString("base64url");
export const lifetime = 30 * 86_400_000;
export interface Credential { id: string; expiresAt: number }

/** Private durable state; synchronous FULL transactions commit before access is acknowledged. */
export class AccessStore {
  private readonly db: Database;
  private readonly scope: string;
  private readonly generation: string;
  private readonly path: string;
  private readonly fileIdentity: string;
  private closed = false;

  constructor(dataDir: string, origin: string) {
    dataDir = resolve(dataDir);
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const directory = lstatSync(dataDir);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("Unsafe data directory");
    chmodSync(dataDir, 0o700);
    const path = join(dataDir, "browser-access.sqlite");
    try { closeSync(openSync(path, "wx", 0o600)); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error("Unsafe access state");
    chmodSync(path, 0o600);
    this.path = path;
    const file = lstatSync(path);
    this.fileIdentity = `${file.dev}:${file.ino}`;
    this.scope = `${origin}\n${realpathSync(dataDir)}`;
    this.db = new Database(path, { strict: true });
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS material (id INTEGER PRIMARY KEY CHECK(id=1), scope TEXT NOT NULL,
        secret TEXT NOT NULL, bootstrap TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL);`);
    this.db.transaction(() => {
      const current = this.material();
      if (current?.scope === this.scope) return;
      this.db.exec("DELETE FROM credentials; DELETE FROM material;");
      this.db.query("INSERT INTO material VALUES (1, ?, ?, ?)").run(this.scope, random(), random());
    }).immediate();
    this.generation = this.material()!.secret;
  }

  private material() {
    return this.db.query<{ scope: string; secret: string; bootstrap: string }, []>(
      "SELECT scope, secret, bootstrap FROM material WHERE id=1",
    ).get();
  }

  private liveMaterial() {
    if (!this.present()) return "lost";
    const material = this.material();
    if (!material || material.scope !== this.scope || material.secret !== this.generation) return "changed";
    return material;
  }

  private digest(value: string) {
    const material = this.liveMaterial();
    if (typeof material === "string") return null;
    return createHmac("sha256", material.secret).update(value).digest("base64url");
  }

  bootstrap() {
    const material = this.liveMaterial();
    if (material === "lost") throw new Error("Access material lost; restart Host");
    if (material === "changed") {
      throw new Error("Access scope changed; restart Host");
    }
    return material.bootstrap;
  }

  exchange(token: string, now: number): { token: string; expiresAt: number } | null {
    return this.db.transaction(() => {
      if (!equal(token, this.bootstrap())) return null;
      const credential = random();
      const expiresAt = now + lifetime;
      this.db.query("INSERT INTO credentials VALUES (?, ?)").run(this.digest(credential), expiresAt);
      this.db.query("UPDATE material SET bootstrap=? WHERE id=1").run(random());
      return { token: credential, expiresAt };
    }).immediate();
  }

  lookup(token: string, now: number): Credential | null {
    const id = this.digest(token);
    return id ? this.current({ id, expiresAt: 0 }, now) : null;
  }

  current(credential: Credential, now: number): Credential | null {
    if (typeof this.liveMaterial() === "string") return null;
    return this.db.query<Credential, [string, number]>(
      "SELECT id, expiresAt FROM credentials WHERE id=? AND expiresAt>?",
    ).get(credential.id, now);
  }

  csrf(credential: Credential) { return this.digest(`csrf:${credential.id}`)!; }
  identity() { return createHmac("sha256", this.generation).update(`host:${this.scope}`).digest("base64url"); }
  revoke(credential: Credential) { this.db.query("DELETE FROM credentials WHERE id=?").run(credential.id); }
  /** Trusted local revocation: preserve this authority generation, rotate the one-use bootstrap capability. */
  revokeAll(): void {
    this.db.transaction(() => {
      if (typeof this.liveMaterial() === "string") throw new Error("ACCESS_STATE_UNAVAILABLE");
      this.db.exec("DELETE FROM credentials");
      this.db.query("UPDATE material SET bootstrap=? WHERE id=1").run(random());
    }).immediate();
  }
  close() { if (!this.closed) { this.closed = true; this.db.close(); } }

  private present() {
    if (this.closed) return false;
    try {
      const file = lstatSync(this.path);
      return file.isFile() && !file.isSymbolicLink() && `${file.dev}:${file.ino}` === this.fileIdentity;
    } catch { return false; }
  }
}

export function equal(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
