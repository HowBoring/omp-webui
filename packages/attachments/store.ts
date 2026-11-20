import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";
import { originalPreparation, originalSubmissionAssociation, type OriginalEntryAssociation,
  type OriginalSubmissionAssociation, type OriginalSubmissionAttempt } from "./association-evidence.ts";
import { isAttachmentError, type AttachmentErrorName } from "./errors.ts";
import { documentOriginalBytes, imageOriginalBytes, isOriginalMediaType, type OriginalMediaType } from "./media.ts";

export type { ImageMediaType } from "./media.ts";
export type { OriginalSubmissionAttempt } from "./association-evidence.ts";

/** Trusted Host authority, never decoded from browser JSON. No Native access is performed by this store. */
export interface OriginalScope {
  hostId: string; browserId: string; pageId: string; profileId: string; sourceId: string; instanceId: string;
  sessionId: string; canonicalCwd: string; draftId: string; authorityEpoch: string; explicitOpen: true;
}
type OriginalBinding = Omit<OriginalScope, "authorityEpoch" | "explicitOpen">;
/** An unreferenced revision changes whenever protection or the known references change. */
export type OriginalProtection = { status: "unreferenced"; revision: string }
  | { status: "occupied" | "executing" | "unresolved-submission" | "native-associated" | "unknown" };
/** Read-only trusted inspection. Coordinate reference admission with removal commits on all Store connections. */
export type OriginalProtectionGate = (original: Readonly<{ objectId: string; binding: Readonly<OriginalBinding> }>) =>
  OriginalProtection;
/** Recheck live browser, directory, exact native identity and trusted page binding on every invocation. */
export type OriginalAccess = () => OriginalScope;
export type DraftOriginalActivity = "explicit-edit" | "active-recovery";
export interface OriginalDescriptor { displayName: string; mediaType: OriginalMediaType; byteLength: number }
export type StagedOriginal = Omit<OriginalDescriptor, "mediaType"> & {
  objectId: string; sha256: string; state: "staged-unprepared"; nativeAssociation: "unassociated";
  stagedAt: number;
} & ({ mediaType: "text/plain"; validation: "utf8-only" }
  | { mediaType: Exclude<OriginalMediaType, "text/plain">; validation: "signature-only" });
export type AssociatedOriginal = OriginalDescriptor & {
  objectId: string; sha256: string; state: "native-associated";
  nativeAssociation: Omit<OriginalEntryAssociation, "objectId"> & { clientSubmissionId: string };
};
/**
 * Historical read authority: the same browser/page/source/instance and the Host's current admitted
 * Session. It deliberately omits draftId: a retained entry also exists in a branch copy.
 */
export interface OriginalHistoryScope {
  hostId: string; browserId: string; pageId: string; profileId: string; sourceId: string; instanceId: string;
  sessionId: string; canonicalCwd: string; authorityEpoch: string;
}
/** Recheck browser, page, directory and exact Session binding on every historical read. */
export type OriginalHistoryAccess = () => OriginalHistoryScope;
export interface OriginalHistoryItem {
  entryId: string; objectId: string; displayName: string; mediaType: OriginalMediaType; byteLength: number;
  sha256: string; availability: "available" | "missing";
}
export interface OriginalDeletionPreview {
  original: StagedOriginal;
  impact: { draftId: string; losesOriginalAccess: true; laterToolReadsMayFail: true };
  confirmationId: string;
  expiresAt: number;
}
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
  clock?: () => number;
  /** With no trusted gate, published Originals are retained. */
  protection?: OriginalProtectionGate;
}
interface Row {
  id: string; scope: string; size: number; displayName: string; mediaType: OriginalMediaType;
  state: "receiving" | "staged-unprepared" | "native-associated" | "deleting";
  sha256: string | null; stagedAt: number; activityAt: number;
}
interface SubmissionRow { scope: string; preparationId: string; preparation: string; associations: string | null }
interface PendingDeletion {
  objectId: string; scope: OriginalScope; revision: string; reviewedAt: number; expiresAt: number;
}
type PayloadSuffix = "partial" | "original";
function fail(code: AttachmentErrorName): never { throw new Error(`attachment_${code}`); }
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const entryPattern = /^[A-Za-z0-9_-]{1,256}$/;
const bindingFields = ["hostId", "browserId", "pageId", "profileId", "sourceId", "instanceId", "sessionId",
  "canonicalCwd", "draftId"] as const;
const scopeKey = (scope: OriginalBinding) => JSON.stringify(bindingFields.map(field => scope[field]));
const submissionTarget = (scope: OriginalBinding) => ({ sourceId: scope.sourceId, instanceId: scope.instanceId,
  nativeSessionId: scope.sessionId });
const submissionTargetKey = (scope: OriginalBinding) => JSON.stringify(submissionTarget(scope));
const scopeFields = [...bindingFields, "authorityEpoch"] as const;
const validIdentity = (value: unknown): value is string => typeof value === "string" && value.length > 0
  && value.length <= 4096;
const unsentLifetimeMs = 24 * 60 * 60 * 1000;
const expiryBatchSize = 128;
const deletionConfirmationMs = 5 * 60 * 1000;
const deletionConfirmationLimit = 128;

function storedLinks(value: unknown): value is { links: { objectId: string; entryId: string }[] } {
  if (!value || typeof value !== "object" || !("links" in value) || !Array.isArray(value.links)) return false;
  return value.links.every(link => !!link && typeof link === "object" && "objectId" in link && "entryId" in link
    && typeof link.objectId === "string" && typeof link.entryId === "string");
}

function storedBinding(key: string): Readonly<OriginalBinding> | undefined {
  const fields: unknown = JSON.parse(key);
  if (!Array.isArray(fields) || fields.length !== bindingFields.length || !fields.every(validIdentity)) return;
  const [hostId = "", browserId = "", pageId = "", profileId = "", sourceId = "", instanceId = "",
    sessionId = "", canonicalCwd = "", draftId = ""] = fields;
  return Object.freeze({ hostId, browserId, pageId, profileId, sourceId, instanceId, sessionId, canonicalCwd, draftId });
}

/** Exact-byte private store. Staging and locally evidenced Native associations use separate read ports. */
export class OriginalStore {
  private readonly db: Database;
  private readonly root: string;
  private readonly rootIdentity: string;
  private readonly limits: OriginalLimits;
  private readonly clock: () => number;
  private readonly protection: OriginalProtectionGate | undefined;
  private readonly pending = new Set<string>();
  private readonly confirmations = new Map<string, PendingDeletion>();
  private closed = false;

  constructor(options: OriginalStoreOptions) {
    this.clock = options.clock ?? Date.now;
    this.protection = options.protection;
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
      this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS budget (id INTEGER PRIMARY KEY CHECK(id=1), limits TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS originals (id TEXT PRIMARY KEY, scope TEXT NOT NULL, size INTEGER NOT NULL,
          displayName TEXT NOT NULL, mediaType TEXT NOT NULL, state TEXT NOT NULL,
          sha256 TEXT, stagedAt INTEGER NOT NULL, activityAt INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS original_scope ON originals(scope);
        CREATE TABLE IF NOT EXISTS original_submissions (target TEXT NOT NULL, submissionId TEXT NOT NULL,
          scope TEXT NOT NULL, preparationId TEXT NOT NULL, preparation TEXT NOT NULL, associations TEXT,
          PRIMARY KEY(target, submissionId));
        CREATE TABLE IF NOT EXISTS original_submission_holds (objectId TEXT PRIMARY KEY REFERENCES originals(id),
          target TEXT NOT NULL, submissionId TEXT NOT NULL,
          FOREIGN KEY(target, submissionId) REFERENCES original_submissions(target, submissionId));
        CREATE TABLE IF NOT EXISTS original_entry_links (sessionId TEXT NOT NULL, instanceId TEXT NOT NULL,
          entryId TEXT NOT NULL, objectId TEXT NOT NULL, target TEXT NOT NULL, submissionId TEXT NOT NULL,
          PRIMARY KEY(sessionId, instanceId, entryId, objectId));`);
      this.db.transaction(() => {
        const saved = this.db.query<{ limits: string }, []>("SELECT limits FROM budget WHERE id=1").get();
        if (saved && saved.limits !== JSON.stringify(this.limits)) fail("limits_changed");
        if (!saved) this.db.query("INSERT INTO budget VALUES(1, ?)").run(JSON.stringify(this.limits));
        this.migrateActivityClock();
        this.backfillLinks();
      }).immediate();
      if (options.recovery === "exclusive-host-startup") this.recover();
    } catch (error) { this.db.close(); throw error; }
  }

  private migrateActivityClock(): void {
    const columns = this.db.query<{ name: string }, []>("PRAGMA table_info(originals)").all();
    if (!columns.some(column => column.name === "activityAt")) {
      this.db.exec("ALTER TABLE originals ADD COLUMN activityAt INTEGER NOT NULL DEFAULT 0;"
        + "UPDATE originals SET activityAt=stagedAt;");
    }
  }

  /**
   * Historical links are keyed by the Native entry/copy relation, not by the Session that first
   * committed them, so a branch copy stays readable. Existing associations are replayed once.
   */
  private backfillLinks(): void {
    const rows = this.db.query<{ target: string; submissionId: string; scope: string; associations: string }, []>(
      "SELECT target, submissionId, scope, associations FROM original_submissions WHERE associations IS NOT NULL").all();
    const insert = this.db.query(`INSERT OR IGNORE INTO original_entry_links
      (sessionId, instanceId, entryId, objectId, target, submissionId) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const row of rows) {
      const binding = storedBinding(row.scope);
      if (!binding) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(row.associations); } catch { continue; }
      if (!storedLinks(parsed)) continue;
      for (const link of parsed.links) {
        if (!idPattern.test(link.objectId) || !entryPattern.test(link.entryId)) continue;
        insert.run(binding.sessionId, binding.instanceId, link.entryId, link.objectId, row.target, row.submissionId);
      }
    }
  }

  private now(): number {
    const time = this.clock();
    if (!Number.isSafeInteger(time) || time < 0 || time > Number.MAX_SAFE_INTEGER - deletionConfirmationMs) {
      fail("storage_unavailable");
    }
    return time;
  }

  private current(access: OriginalAccess, expected?: OriginalScope, signal?: AbortSignal): OriginalScope {
    this.assertRoot();
    if (signal?.aborted) fail("canceled");
    let scope: OriginalScope;
    try { scope = { ...access() }; } catch { return fail("authority_unavailable"); }
    if (scope.explicitOpen !== true || scopeFields.some(field => !validIdentity(scope[field]))) fail("authority_unavailable");
    if (expected && (scopeKey(scope) !== scopeKey(expected) || scope.authorityEpoch !== expected.authorityEpoch)) {
      fail("binding_changed");
    }
    return scope;
  }

  private assertRoot(): void {
    if (this.closed) fail("store_closed");
    let root;
    try { root = lstatSync(this.root); } catch { return fail("unsafe_store"); }
    if (!root.isDirectory() || root.isSymbolicLink() || `${root.dev}:${root.ino}` !== this.rootIdentity) {
      fail("unsafe_store");
    }
  }

  private path(id: string, suffix: PayloadSuffix): string {
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
        "SELECT coalesce(sum(size),0) AS bytes, count(*) AS count FROM originals WHERE scope=? AND state<>'native-associated'")
        .get(scopeKey(scope))!;
      if (total.bytes + descriptor.byteLength > this.limits.totalBytes || total.count >= this.limits.objects) {
        fail("store_full");
      }
      if (total.intakes >= this.limits.intakes) fail("intake_budget");
      if (draft.count >= this.limits.draftObjects || draft.bytes + descriptor.byteLength > this.limits.draftBytes) {
        fail("draft_budget");
      }
      const stagedAt = this.now();
      const row: Row = { id: randomUUID(), scope: scopeKey(scope), size: descriptor.byteLength,
        displayName: descriptor.displayName, mediaType: descriptor.mediaType, state: "receiving", sha256: null,
        stagedAt, activityAt: stagedAt };
      this.db.query(`INSERT INTO originals (id, scope, size, displayName, mediaType, state, sha256, stagedAt, activityAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(row.id, row.scope, row.size, row.displayName, row.mediaType, row.state, row.sha256, row.stagedAt, row.activityAt);
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
      row.activityAt = Math.max(row.stagedAt, this.now());
      this.db.query("UPDATE originals SET state=?, sha256=?, activityAt=? WHERE id=?")
        .run(row.state, row.sha256, row.activityAt, row.id);
      return this.metadata(row);
    } catch (error) {
      if (fd !== undefined) { closeSync(fd); fd = undefined; }
      this.cleanup(row.id, "receiving");
      if (isAttachmentError(error)) throw error;
      fail("storage_unavailable");
    } finally { this.pending.delete(row.id); }
  }

  /** Reads the Host staging view. With a lifecycle gate, only current unreferenced Originals are visible here. */
  async read(access: OriginalAccess, objectId: string, signal?: AbortSignal): Promise<StagedOriginal & { bytes: Uint8Array }> {
    const scope = this.current(access, undefined, signal);
    // Hold the SQLite read lock until the file closes so removal cannot reclaim its charge early.
    const { row, bytes } = this.db.transaction(() => {
      const row = this.stagedObject(objectId, scope);
      this.requireStagingView(row);
      return { row, bytes: this.payload(row) };
    }).deferred();
    this.requireStagingView(row);
    this.current(access, scope, signal);
    this.checkBytes(row, bytes);
    // The final authority check can admit a hold on another connection. Read eligibility in one snapshot.
    const staged = this.db.query<{ held: number }, [string, string]>(`SELECT EXISTS (
        SELECT 1 FROM original_submission_holds WHERE objectId=staged.id
      ) AS held FROM originals AS staged WHERE id=? AND scope=? AND state='staged-unprepared'`)
      .get(objectId, scopeKey(scope));
    if (!staged) fail("object_unavailable");
    if (staged.held) fail("original_protected");
    return { ...this.metadata(row), bytes };
  }

  private requireStagingView(row: Row): void {
    if (this.protection ? this.unreferencedRevision(row) === undefined : this.associationHeld(row.id)) {
      fail("original_protected");
    }
  }

  private stagedObject(objectId: string, scope: OriginalBinding): Row {
    return this.scopedObject(objectId, scope, "staged-unprepared");
  }

  private scopedObject(objectId: string, scope: OriginalBinding, state: "staged-unprepared" | "native-associated"): Row {
    if (!idPattern.test(objectId)) fail("object_unavailable");
    const row = this.db.query<Row, [string, string, string]>(
      "SELECT * FROM originals WHERE id=? AND scope=? AND state=?").get(objectId, scopeKey(scope), state);
    if (!row) fail("object_unavailable");
    return row;
  }

  /** Before dispatch, keep exact Originals from an authenticated, correlated preparation for this trusted attempt. */
  reserveForSubmission(access: OriginalAccess, attempt: OriginalSubmissionAttempt, objectIds: readonly string[],
    receipt: unknown): void {
    const scope = this.current(access), key = scopeKey(scope), target = submissionTargetKey(scope);
    const { clientSubmissionId, preparationId } = attempt;
    const prepared = originalPreparation(receipt, attempt, submissionTarget(scope), scope.draftId, objectIds);
    if (!prepared) fail("association_evidence_invalid");
    const saved = JSON.stringify(prepared.evidence);
    this.db.transaction(() => {
      this.current(access, scope);
      if (prepared.expiresAt <= this.now()) fail("association_evidence_invalid");
      const previous = this.submission(scope, clientSubmissionId);
      if (previous) {
        if (previous.scope !== key || previous.preparationId !== preparationId || previous.preparation !== saved
          || previous.associations !== null) {
          fail("association_conflict");
        }
        return;
      }
      const insert = this.db.query("INSERT INTO original_submission_holds VALUES (?, ?, ?)");
      this.db.query("INSERT INTO original_submissions VALUES (?, ?, ?, ?, ?, NULL)")
        .run(target, clientSubmissionId, key, preparationId, saved);
      for (const item of prepared.evidence.attachments) {
        const row = this.stagedObject(item.originalId, scope);
        if (this.associationHeld(row.id)) fail("association_conflict");
        const kind = row.mediaType.startsWith("image/") ? "image" : "text";
        if (row.sha256 !== item.originalSha256 || kind !== item.representationKind) fail("association_evidence_invalid");
        insert.run(row.id, target, clientSubmissionId);
      }
    }).immediate();
  }

  /** Trusted gate notice after an accepted reservation; originals stay private but leave the draft budget. */
  associateReserved(access: OriginalAccess, clientSubmissionId: string, objectIds: readonly string[]): void {
    const scope = this.current(access);
    this.db.transaction(() => {
      this.current(access, scope);
      const mark = this.db.query("UPDATE originals SET state='native-associated' WHERE id=? AND scope=? AND state IN ('staged-unprepared','native-associated')");
      for (const objectId of objectIds) mark.run(objectId, scopeKey(scope));
    }).immediate();
  }

  /** Record a complete query from the matching Native worker for an already held submission. */
  recordSubmission(access: OriginalAccess, clientSubmissionId: string, query: unknown): void {
    const scope = this.current(access);
    this.db.transaction(() => {
      this.current(access, scope);
      const record = this.submission(scope, clientSubmissionId);
      const association = this.verifyAssociation(scope, clientSubmissionId, record, query);
      if (!record || record.associations !== null) return;
      const mark = this.db.query("UPDATE originals SET state='native-associated' WHERE id=? AND scope=? AND state IN ('staged-unprepared','native-associated')");
      for (const { objectId } of association.links) if (mark.run(objectId, scopeKey(scope)).changes !== 1) fail("association_conflict");
      this.db.query("UPDATE original_submissions SET associations=? WHERE target=? AND submissionId=?")
        .run(JSON.stringify(association), submissionTargetKey(scope), clientSubmissionId);
      this.recordLinks(scope, clientSubmissionId, association);
    }).immediate();
  }

  /** The caller supplies current Native query evidence and current rights to this exact staged binding. */
  async readAssociated(access: OriginalAccess, entryId: string, objectId: string, query: unknown,
    signal?: AbortSignal): Promise<AssociatedOriginal & { bytes: Uint8Array }> {
    const scope = this.current(access, undefined, signal);
    const { association, clientSubmissionId, row, bytes } = this.db.transaction(() => {
      const row = this.scopedObject(objectId, scope, "native-associated");
      const hold = this.db.query<{ submissionId: string }, [string, string]>(
        "SELECT submissionId FROM original_submission_holds WHERE objectId=? AND target=?")
        .get(objectId, submissionTargetKey(scope));
      if (!hold) fail("object_unavailable");
      const { submissionId: clientSubmissionId } = hold;
      const record = this.submission(scope, clientSubmissionId);
      if (!record?.associations) fail("object_unavailable");
      const { links } = this.verifyAssociation(scope, clientSubmissionId, record, query);
      const association = links.find(link => link.objectId === objectId && link.entryId === entryId);
      if (!association) fail("object_unavailable");
      return { association, clientSubmissionId, row, bytes: this.payload(row) };
    }).deferred();
    this.current(access, scope, signal);
    this.checkBytes(row, bytes);
    if (!row.sha256) fail("original_corrupt");
    return { objectId, sha256: row.sha256, mediaType: row.mediaType, displayName: row.displayName, byteLength: row.size,
      state: "native-associated", nativeAssociation: { clientSubmissionId, entryId, entryPart: association.entryPart }, bytes };
  }

  /**
   * Copies exact per-entry Original links into a Host-verified native branch. The new native session
   * forwards those entry ids unchanged; stored browser/page/source scope still gates every read.
   */
  inheritBranchLinks(previousSessionId: string, nativeSessionId: string, entryIds: readonly string[]): number {
    if (this.closed) fail("store_closed");
    if (!entryPattern.test(previousSessionId) || !entryPattern.test(nativeSessionId) || previousSessionId === nativeSessionId) return 0;
    const entries = [...new Set(entryIds)].filter(entryId => entryPattern.test(entryId));
    if (!entries.length) return 0;
    const marks = entries.map(() => "?").join(",");
    const rows = this.db.query<{ instanceId: string; entryId: string; objectId: string; target: string;
      submissionId: string }, string[]>(`SELECT instanceId, entryId, objectId, target, submissionId
        FROM original_entry_links WHERE sessionId=? AND entryId IN (${marks})`)
      .all(previousSessionId, ...entries);
    const insert = this.db.query(`INSERT OR IGNORE INTO original_entry_links
      (sessionId, instanceId, entryId, objectId, target, submissionId) VALUES (?, ?, ?, ?, ?, ?)`);
    let copied = 0;
    this.db.transaction(() => {
      for (const row of rows) {
        insert.run(nativeSessionId, row.instanceId, row.entryId, row.objectId, row.target, row.submissionId);
        copied++;
      }
    })();
    return copied;
  }

  private recordLinks(scope: OriginalBinding, clientSubmissionId: string, association: OriginalSubmissionAssociation): void {
    const insert = this.db.query(`INSERT OR IGNORE INTO original_entry_links
      (sessionId, instanceId, entryId, objectId, target, submissionId) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const link of association.links) {
      insert.run(scope.sessionId, scope.instanceId, link.entryId, link.objectId,
        submissionTargetKey(scope), clientSubmissionId);
    }
  }

  private currentHistory(access: OriginalHistoryAccess, expected?: OriginalHistoryScope, signal?: AbortSignal): OriginalHistoryScope {
    this.assertRoot();
    if (signal?.aborted) fail("canceled");
    let scope: OriginalHistoryScope;
    try { scope = { ...access() }; } catch { return fail("authority_unavailable"); }
    const fields = ["hostId", "browserId", "pageId", "profileId", "sourceId", "instanceId", "sessionId",
      "canonicalCwd", "authorityEpoch"] as const;
    if (fields.some(field => !validIdentity(scope[field]))) fail("authority_unavailable");
    if (expected && fields.some(field => scope[field] !== expected[field])) fail("binding_changed");
    return scope;
  }

  /** True only for the exact browser/page and source/instance that created the submission. The
   * Native session is bound by the link row, which a verified branch copy forwards to its own id. */
  private sameRequester(stored: Readonly<OriginalBinding>, current: OriginalHistoryScope): boolean {
    return stored.hostId === current.hostId && stored.browserId === current.browserId
      && stored.pageId === current.pageId && stored.profileId === current.profileId
      && stored.instanceId === current.instanceId;
  }

  /** Entry ids are supplied by the Host only after the current Native history retained them. */
  history(access: OriginalHistoryAccess, entryIds: readonly string[], signal?: AbortSignal): OriginalHistoryItem[] {
    const scope = this.currentHistory(access, undefined, signal);
    if (!Array.isArray(entryIds) || entryIds.length < 1 || entryIds.length > 128
      || !entryIds.every(entryId => entryPattern.test(entryId))) fail("invalid_target");
    const unique = [...new Set(entryIds)];
    const marks = unique.map(() => "?").join(",");
    const rows = this.db.query<{ entryId: string; objectId: string; target: string; submissionId: string;
      displayName: string; mediaType: OriginalMediaType; size: number; sha256: string | null; associations: string | null;
      scope: string }, string[]>(`SELECT l.entryId, l.objectId, l.target, l.submissionId, o.displayName, o.mediaType,
        o.size, o.sha256, s.associations, s.scope FROM original_entry_links l
        JOIN originals o ON o.id=l.objectId
        JOIN original_submissions s ON s.target=l.target AND s.submissionId=l.submissionId
        WHERE l.sessionId=? AND l.instanceId=? AND l.entryId IN (${marks}) AND o.state='native-associated'`)
      .all(scope.sessionId, scope.instanceId, ...unique);
    const order = new Map(unique.map((entryId, index) => [entryId, index]));
    const items = rows.flatMap(row => {
      const stored = storedBinding(row.scope);
      if (!stored || !this.sameRequester(stored, scope) || !row.sha256) return [];
      return [{ entryId: row.entryId, objectId: row.objectId, displayName: row.displayName, mediaType: row.mediaType,
        byteLength: row.size, sha256: row.sha256, availability: this.available(row.objectId, row.size, row.mediaType) }];
    });
    items.sort((first, second) => (order.get(first.entryId) ?? 0) - (order.get(second.entryId) ?? 0)
      || first.objectId.localeCompare(second.objectId));
    this.currentHistory(access, scope, signal);
    return items;
  }

  private available(objectId: string, size: number, mediaType: OriginalMediaType): "available" | "missing" {
    try {
      const file = lstatSync(this.path(objectId, "original"));
      return file.isFile() && !file.isSymbolicLink() && file.nlink === 1 && file.size === size
        && file.size <= this.objectCeiling(mediaType) ? "available" : "missing";
    } catch { return "missing"; }
  }

  /**
   * Read one retained entry's original. `entries` is the Host's current Native retention scan, so
   * an old page, guessed entry id or unrelated object cannot widen access.
   */
  async readHistorical(access: OriginalHistoryAccess, entryId: string, objectId: string,
    entries: readonly string[], signal?: AbortSignal): Promise<OriginalHistoryItem & { bytes: Uint8Array }> {
    const scope = this.currentHistory(access, undefined, signal);
    if (!entryPattern.test(entryId) || !idPattern.test(objectId) || !entries.includes(entryId)) fail("object_unavailable");
    const { item, bytes } = this.db.transaction(() => {
      const row = this.db.query<{ entryId: string; objectId: string; displayName: string; mediaType: OriginalMediaType;
        size: number; sha256: string | null; scope: string; state: string }, [string, string, string, string]>(`SELECT
        l.entryId, l.objectId, o.displayName, o.mediaType, o.size, o.sha256, s.scope, o.state
        FROM original_entry_links l JOIN originals o ON o.id=l.objectId
        JOIN original_submissions s ON s.target=l.target AND s.submissionId=l.submissionId
        WHERE l.sessionId=? AND l.instanceId=? AND l.entryId=? AND l.objectId=?`)
        .get(scope.sessionId, scope.instanceId, entryId, objectId);
      if (!row || row.state !== "native-associated" || !row.sha256) fail("object_unavailable");
      const stored = storedBinding(row.scope);
      if (!stored || !this.sameRequester(stored, scope)) fail("object_unavailable");
      const bytes = this.payload({ id: row.objectId, scope: row.scope, size: row.size, displayName: row.displayName,
        mediaType: row.mediaType, state: "native-associated", sha256: row.sha256, stagedAt: 0, activityAt: 0 });
      return { item: { entryId, objectId, displayName: row.displayName, mediaType: row.mediaType,
        byteLength: row.size, sha256: row.sha256, availability: "available" as const }, bytes };
    }).deferred();
    this.currentHistory(access, scope, signal);
    if (bytes.length !== item.byteLength || createHash("sha256").update(bytes).digest("hex") !== item.sha256) {
      fail("original_corrupt");
    }
    return { ...item, bytes };
  }

  private submission(scope: OriginalBinding, clientSubmissionId: string): SubmissionRow | null {
    return this.db.query<SubmissionRow, [string, string]>(
      "SELECT scope, preparationId, preparation, associations FROM original_submissions WHERE target=? AND submissionId=?")
      .get(submissionTargetKey(scope), clientSubmissionId);
  }

  private verifyAssociation(scope: OriginalBinding, clientSubmissionId: string, record: SubmissionRow | null,
    query: unknown): OriginalSubmissionAssociation {
    if (!record || record.scope !== scopeKey(scope)) fail("object_unavailable");
    const association = originalSubmissionAssociation(query, submissionTarget(scope), clientSubmissionId, record.preparation);
    if (!association) fail("association_evidence_invalid");
    if (record.associations !== null && record.associations !== JSON.stringify(association)) fail("association_conflict");
    return association;
  }

  private associationHeld(objectId: string): boolean {
    return this.db.query("SELECT 1 FROM original_submission_holds WHERE objectId=?").get(objectId) !== null;
  }

  private checkBytes(row: Row, bytes: Uint8Array): void {
    if (bytes.length !== row.size || createHash("sha256").update(bytes).digest("hex") !== row.sha256) fail("original_corrupt");
  }

  /** The trusted draft coordinator calls this only after accepting a deliberate action for the current draft. */
  touchDraft(access: OriginalAccess, activity: DraftOriginalActivity, objectIds: readonly string[]): {
    renewed: string[]; unavailable: string[];
  } {
    const scope = this.current(access);
    if ((activity !== "explicit-edit" && activity !== "active-recovery") || !Array.isArray(objectIds)
      || objectIds.length > this.limits.draftObjects || !objectIds.every(id => typeof id === "string")) {
      fail("invalid_target");
    }
    const ids = [...new Set(objectIds)];
    return this.db.transaction(() => {
      this.current(access, scope);
      const at = this.now(), key = scopeKey(scope), renewed: string[] = [], unavailable: string[] = [];
      const touch = this.db.query(`UPDATE originals SET activityAt=max(activityAt, ?) WHERE id=? AND scope=?
        AND state='staged-unprepared' AND activityAt>? AND id NOT IN (SELECT objectId FROM original_submission_holds)`);
      for (const id of ids) {
        const accepted = idPattern.test(id) && touch.run(at, id, key, at - unsentLifetimeMs).changes === 1;
        (accepted ? renewed : unavailable).push(id);
      }
      return { renewed, unavailable };
    }).immediate();
  }

  /** Explicit Chat draft removal releases this page's own reserved bytes before Native association. */
  release(scope: OriginalScope, objectId: string): { reclaimed: boolean } {
    if (!idPattern.test(objectId)) fail("object_unavailable");
    const key = scopeKey(scope);
    this.db.transaction(() => {
      this.assertRoot();
      const row = this.db.query<Row, [string, string]>(`SELECT * FROM originals
        WHERE id=? AND scope=? AND state='staged-unprepared'`).get(objectId, key);
      if (!row) fail("object_unavailable");
      this.assertRoot();
      this.markForCleanup(objectId);
    }).immediate();
    return { reclaimed: this.cleanup(objectId, "deleting") };
  }

  /** Presents the known staged-draft impact and issues a short-lived confirmation for the current authority. */
  previewDeletion(access: OriginalAccess, objectId: string): OriginalDeletionPreview {
    const scope = this.current(access);
    const row = this.stagedObject(objectId, scope);
    const revision = this.unreferencedRevision(row);
    if (revision === undefined) fail("original_protected");
    this.current(access, scope);
    const reviewedAt = this.now(), expiresAt = reviewedAt + deletionConfirmationMs;
    const confirmationId = this.rememberConfirmation({ objectId, scope, revision, reviewedAt, expiresAt });
    return { original: this.metadata(row), confirmationId, expiresAt,
      impact: { draftId: scope.draftId, losesOriginalAccess: true, laterToolReadsMayFail: true } };
  }

  /** A confirmation is single-use, including refusals. The tombstone commits before physical cleanup. */
  confirmDeletion(access: OriginalAccess, objectId: string, confirmationId: string): { reclaimed: boolean } {
    const pending = this.confirmations.get(confirmationId);
    this.confirmations.delete(confirmationId);
    const scope = this.current(access, pending?.scope);
    if (!pending || pending.objectId !== objectId) fail("deletion_confirmation_required");
    this.db.transaction(() => {
      const row = this.stagedObject(objectId, scope);
      const revision = this.unreferencedRevision(row);
      if (revision === undefined) fail("original_protected");
      this.current(access, scope);
      const at = this.now();
      if (revision !== pending.revision || at < pending.reviewedAt || at >= pending.expiresAt) {
        fail("deletion_confirmation_required");
      }
      this.markForCleanup(objectId);
    }).immediate();
    return { reclaimed: this.cleanup(objectId, "deleting") };
  }

  private rememberConfirmation(pending: PendingDeletion): string {
    for (const [id, item] of this.confirmations) {
      if (item.objectId === pending.objectId || item.expiresAt <= pending.reviewedAt) this.confirmations.delete(id);
    }
    if (this.confirmations.size >= deletionConfirmationLimit) {
      this.confirmations.delete(this.confirmations.keys().next().value!);
    }
    const id = randomUUID();
    this.confirmations.set(id, pending);
    return id;
  }

  /** One bounded Host-owned pass. A continuation advances even when a candidate is protected. */
  collectExpired(after?: string): { expired: number; reclaimed: number; next: string | null } {
    this.assertRoot();
    if (after !== undefined && !idPattern.test(after)) fail("invalid_target");
    if (!this.protection) return { expired: 0, reclaimed: 0, next: null };
    const cutoff = this.now() - unsentLifetimeMs;
    const candidates = this.db.query<Pick<Row, "id" | "state" | "activityAt">, [string, number]>(
      "SELECT id, state, activityAt FROM originals WHERE id>? ORDER BY id LIMIT ?")
      .all(after ?? "", expiryBatchSize + 1);
    let expired = 0, reclaimed = 0;
    for (const { id, state, activityAt } of candidates.slice(0, expiryBatchSize)) {
      if (state !== "staged-unprepared" || activityAt > cutoff) continue;
      const removed = this.db.transaction(() => {
        this.assertRoot();
        const row = this.db.query<Row, [string, number]>(`SELECT * FROM originals
          WHERE id=? AND state='staged-unprepared' AND activityAt<=?`).get(id, cutoff);
        if (!row || this.unreferencedRevision(row) === undefined) return false;
        this.assertRoot();
        this.markForCleanup(row.id);
        return true;
      }).immediate();
      if (!removed) continue;
      expired++;
      if (this.cleanup(id, "deleting")) reclaimed++;
    }
    return { expired, reclaimed, next: candidates.length > expiryBatchSize ? candidates[expiryBatchSize - 1]!.id : null };
  }

  private unreferencedRevision(row: Row): string | undefined {
    if (this.associationHeld(row.id)) return;
    try {
      const binding = storedBinding(row.scope);
      if (!binding) return;
      const proof = this.protection?.(Object.freeze({ objectId: row.id, binding }));
      if (proof?.status === "unreferenced" && validIdentity(proof.revision)) return proof.revision;
    } catch { /* An unavailable protection service cannot clear an Original for deletion. */ }
  }

  private markForCleanup(id: string): void {
    this.db.query("UPDATE originals SET state='deleting' WHERE id=? AND state='staged-unprepared'").run(id);
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

  private cleanup(id: string, state: "receiving" | "deleting"): boolean {
    // Failed physical cleanup retains the full reservation; never promise quota before reclaiming bytes.
    try {
      return this.db.transaction(() => {
        this.assertRoot();
        const row = this.db.query<Row, [string, string]>("SELECT * FROM originals WHERE id=? AND state=?").get(id, state);
        if (!row) return true;
        const partial = this.checkedPayload(row, "partial"), original = this.checkedPayload(row, "original");
        if (partial && original) fail("unaccounted_data");
        const payload = partial ?? original;
        if (payload) unlinkSync(payload);
        this.syncDirectory();
        this.db.query("DELETE FROM originals WHERE id=? AND state=?").run(id, state);
        return true;
      }).immediate();
    } catch { return false; /* Startup retries cleanup; bytes remain charged. */ }
  }

  private checkedPayload(row: Row, suffix: PayloadSuffix): string | undefined {
    const path = this.path(row.id, suffix);
    let file;
    try {
      file = lstatSync(path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    if (!file.isFile() || file.nlink !== 1 || file.size > row.size) fail("unaccounted_data");
    if (suffix === "partial" && row.state !== "receiving") fail("unaccounted_data");
    if (suffix === "original" && row.state === "receiving" && file.size !== row.size) fail("unaccounted_data");
    return path;
  }

  private recover(): void {
    this.assertRoot();
    const rows = this.db.query<Row, []>("SELECT * FROM originals").all();
    this.validateInventory(rows);
    for (const row of rows) {
      if (row.state === "receiving" || row.state === "deleting") this.cleanup(row.id, row.state);
    }
  }

  private validateInventory(rows: readonly Row[]): void {
    // Startup validates the entire inventory before unlinking any interrupted payload.
    const known = new Map(rows.map(row => [row.id, row]));
    const present = new Set<string>();
    for (const name of readdirSync(this.root)) {
      if (["originals.sqlite", "originals.sqlite-journal"].includes(name)) continue;
      const match = /^([^.]+)\.(partial|original)$/.exec(name), id = match?.[1], suffix = match?.[2];
      const row = id ? known.get(id) : undefined;
      if (!id || !idPattern.test(id) || !row || present.has(id) || (suffix !== "partial" && suffix !== "original")) {
        fail("unaccounted_data");
      }
      if (!this.checkedPayload(row, suffix)) fail("unaccounted_data");
      present.add(id);
    }
  }

  close(): void {
    if (this.closed) return;
    if (this.pending.size) fail("intake_active");
    this.confirmations.clear();
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
