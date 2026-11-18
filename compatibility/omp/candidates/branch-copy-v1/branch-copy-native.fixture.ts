import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync,
  writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BranchCopyIntent } from "./branch-copy";

const donor = process.argv[2];
assert.ok(donor, "pass the read-only Source38 Native checkout");
const native = realpathSync(donor);
const temp = realpathSync(mkdtempSync(join(tmpdir(), "omp-branch-copy-fixture-")));
const workspace = join(temp, "session-source");
const overlay = join(temp, "overlay");
const testAgentDir = join(temp, "agent");
const priorAgentDir = process.env.PI_CODING_AGENT_DIR;
const priorOwnersDir = process.env.PI_TEST_SESSION_OWNERS_DIR;
process.env.PI_CODING_AGENT_DIR = testAgentDir;
process.env.PI_TEST_SESSION_OWNERS_DIR = join(temp, "owners");

try {
  mkdirSync(workspace);
  mkdirSync(overlay);
  mkdirSync(testAgentDir);
  symlinkSync(join(native, "node_modules"), join(overlay, "node_modules"), "dir");
  for (const name of ["branch-copy.ts", "rpc-branch-copy.ts"]) {
    copyFileSync(join(import.meta.dir, name), join(overlay, name));
  }
  for (const name of ["branch-inspect-wire.ts", "rpc-branch-inspect.ts"]) {
    copyFileSync(join(import.meta.dir, "../branch-inspect-v1", name), join(overlay, name));
  }
  const { inspectBranch } = await import(join(overlay, "rpc-branch-inspect.ts"));
  const { prepareBranchCopy } = await import(join(overlay, "rpc-branch-copy.ts"));
  const src = join(native, "packages/coding-agent/src");
  const { SessionManager, SessionEntryIndex } = await import(join(src, "session/session-manager.ts"));
  const { buildSessionContext } = await import(join(src, "session/session-context.ts"));
  const { StrictSessionStorage } = await import(join(src, "session/strict-session-storage.ts"));
  const { submissionRecord } = await import(join(src, "session/submission-records.ts"));
  const { StrictReservation } = await import(join(src, "modes/rpc/strict-reservation.ts"));
  const { hash, physicalId, readDescriptor } = await import(join(src, "modes/rpc/catalog-metadata.ts"));

  const timestamp = "2026-11-18T00:00:00.000Z";
  const sourcePath = join(workspace, "source.jsonl");
  const nativeSessionId = randomUUID();
  const header = { type: "ompsub1", version: 3, id: nativeSessionId, cwd: workspace, timestamp,
    requiredFeatures: ["durable-submission-v1"] };
  writeFileSync(sourcePath, `${JSON.stringify(header)}\n`);
  const source = { root: workspace, rootIdentity: await physicalId(workspace), sourceId: hash("branch-copy-test") };
  const selectedSource = await readDescriptor(source, sourcePath);
  const target = { sourceId: selectedSource.sourceId, instanceId: selectedSource.instanceId, nativeSessionId };
  const origin = { ...target, clientSubmissionId: "same-source-input" };
  const causalInput = { origin, role: "input" };
  const user = (id: string, parentId: string | null) => ({ id, type: "message", parentId, timestamp,
    message: { role: "user", content: [{ type: "text", text: "same text" }], timestamp: Date.parse(timestamp) } });
  const root = { ...user("root", null), submission: causalInput };
  const label = { id: "checkpoint", type: "label", parentId: "root", targetId: "root", label: "old", timestamp };
  const kept = { id: "kept", type: "custom_message", parentId: label.id, activeLeafId: "other", timestamp,
    customType: "extension", content: "native context survives", display: true };
  const selected = user("selected", kept.id);
  const other = user("other", root.id);
  const rename = { ...label, id: "later-label", parentId: other.id, activeLeafId: other.id, label: "current" };
  const control = { ...submissionRecord({ origin, fingerprint: "0".repeat(64), preparationId: "text-input",
    terminal: true, inputOutcome: "generated", noEntries: [], entryFacts: [{ entryId: root.id, role: "input" }] }),
    parentId: other.id, activeLeafId: other.id };
  const sourceText = `${[header, root, label, kept, selected, other, rename, control].map(row => JSON.stringify(row)).join("\n")}\n`;
  writeFileSync(sourcePath, sourceText);

  const reservation = await StrictReservation.acquire(source, sourcePath, selectedSource, workspace, new AbortController().signal);
  try {
    const manager = await SessionManager.open(sourcePath, workspace, new StrictSessionStorage(reservation), {
      suppressBreadcrumb: true, throwIfMissing: true,
    });
    assert.equal(manager.getLeafId(), "other");
    assert.deepEqual(manager.getBranch("kept").map(({ id }: { id: string }) => id), ["root", "checkpoint", "kept"]);
    assert.equal(manager.getEntry(control.id), undefined);
    assert.equal(manager.readSubmissionState().submissions.length, 1);
    const preview = (entryId: string) => inspectBranch({ type: "branch_inspect", source: target, entryId }, manager, () => false, 0);
    const confirmed = (entryId: string) => {
      const { parentId, targetRevision, contextRevision } = preview(entryId);
      return { source: target, entryId, expected: { parentId, targetRevision, contextRevision } };
    };
    const request = confirmed("selected");
    const intent: BranchCopyIntent = prepareBranchCopy(request, manager, () => false, 0);
    assert.deepEqual(intent.source, target);
    assert.equal(intent.userEntryId, "selected");
    assert.equal(intent.parentId, "kept");
    assert.equal(intent.sourceLeafId, "other");
    assert.equal(intent.retainedLeafId, "kept");
    assert.deepEqual(intent.omittedLabelEntryIds, ["checkpoint"]);
    assert.deepEqual(intent.labels, [{ targetId: "root", label: "current" }]);
    const { activeLeafId: _removed, ...keptBody } = kept;
    const plannedEntries = intent.entries.map(row => JSON.parse(row.destinationJson));
    assert.deepEqual(plannedEntries, [
      root, { ...keptBody, parentId: "root" },
    ]);
    const [rootCopy, keptCopy] = intent.entries;
    assert.ok(rootCopy && keptCopy);
    assert.equal(rootCopy.relation, "copied");
    assert.equal(rootCopy.sourceEntryRevision, manager.navigationTarget(root.id).targetRevision);
    assert.equal(keptCopy.relation, "native_transformed");
    assert.equal(keptCopy.removedActiveLeafId, "other");
    assert.equal(keptCopy.destinationEntryRevision, createHash("sha256").update(keptCopy.destinationJson).digest("hex"));
    const plannedIndex = new SessionEntryIndex();
    plannedIndex.rebuild(plannedEntries);
    assert.equal(plannedIndex.leafId(), "kept");
    assert.deepEqual(buildSessionContext(plannedEntries, plannedIndex.leafId(), plannedIndex.entriesById(),
      { transcript: true }).messages, buildSessionContext(manager.getEntries(), "kept", undefined,
      { transcript: true }).messages);
    assert.equal(prepareBranchCopy(request, manager, () => false, 0).copyRevision, intent.copyRevision);
    const empty = prepareBranchCopy(confirmed("root"), manager, () => false, 0);
    assert.equal(empty.parentId, null);
    assert.equal(empty.retainedLeafId, null);
    assert.deepEqual(empty.entries, []);
    assert.deepEqual(empty.labels, []);

    assert.throws(() => prepareBranchCopy({ source: target, entryId: "selected" }, manager, () => false, 0), {
      code: "BRANCH_COPY_CUT_REQUIRED",
    });
    assert.throws(() => prepareBranchCopy(request, manager, () => true, 0), { code: "session_busy" });
    assert.throws(() => prepareBranchCopy(request, manager, () => false, 1), { code: "session_busy" });
    let idleChecks = 0;
    assert.throws(() => prepareBranchCopy(request, manager, () => ++idleChecks === 2, 0), { code: "session_busy" });
    assert.throws(() => prepareBranchCopy({ ...request, expected: { ...request.expected, parentId: "other" } },
      manager, () => false, 0), { code: "BRANCH_STALE_TARGET" });
    assert.throws(() => prepareBranchCopy({ ...request, expected: { ...request.expected, contextRevision: "0".repeat(64) } },
      manager, () => false, 0), { code: "BRANCH_STALE_CONTEXT" });
    assert.throws(() => prepareBranchCopy({ ...request, source: { ...target, instanceId: "0".repeat(64) } },
      manager, () => false, 0), { code: "BRANCH_SOURCE_CHANGED" });
    assert.throws(() => prepareBranchCopy({ ...request, entryId: "kept" }, manager, () => false, 0), {
      code: "BRANCH_TARGET_NOT_USER",
    });
    assert.equal(manager.getSessionFile(), sourcePath);
    assert.equal(manager.getLeafId(), "other");
    assert.equal(readFileSync(sourcePath, "utf8"), sourceText);
    assert.deepEqual(readdirSync(workspace), ["source.jsonl"]);
  } finally {
    await reservation.release();
  }
} finally {
  if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
  if (priorOwnersDir === undefined) delete process.env.PI_TEST_SESSION_OWNERS_DIR;
  else process.env.PI_TEST_SESSION_OWNERS_DIR = priorOwnersDir;
  rmSync(temp, { recursive: true, force: true });
}
