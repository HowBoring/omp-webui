import assert from "node:assert/strict";
import { buildBranchCopyIntent, type BranchCopyEntry } from "./branch-copy";

const source = { sourceId: "a".repeat(64), instanceId: "b".repeat(64), nativeSessionId: "source-session" };
const cut = { source, entryId: "selected", parentId: "prior", targetRevision: "c".repeat(64), contextRevision: "d".repeat(64) };
const root = { id: "root", type: "message", parentId: null, message: { role: "user", content: "same text" } };
const prior = { id: "prior", type: "custom_message", parentId: "root", customType: "extension", content: "kept" };
const excluded = { id: "unrelated-active", type: "message", parentId: "root", message: { role: "user", content: "same text" } };
const entries = new Map<string, BranchCopyEntry>([[root.id, root], [prior.id, prior], [excluded.id, excluded]]);
const index = {
  getLeafId: () => excluded.id,
  getEntry: (id: string) => entries.get(id),
  getLabel: (_id: string) => undefined,
};

const intent = buildBranchCopyIntent(cut, index, JSON.stringify);
assert.equal(intent.sourceLeafId, "unrelated-active");
assert.equal(intent.retainedLeafId, "prior");
assert.deepEqual(intent.entries.map(row => [row.sourceEntryId, row.destinationEntryId, row.relation]), [
  ["root", "root", "copied"], ["prior", "prior", "copied"],
]);
assert.deepEqual(intent.entries.map(row => JSON.parse(row.destinationJson)), [root, prior]);

const priorLabel = { id: "prior-label", type: "label", parentId: "root", targetId: "root", label: "old" };
const transformed = { ...prior, parentId: "prior-label", activeLeafId: null };
entries.set(priorLabel.id, priorLabel);
entries.set(transformed.id, transformed);
const transformedIntent = buildBranchCopyIntent(cut, { ...index, getLabel: id => id === "root" ? "current" : undefined },
  JSON.stringify);
assert.deepEqual(transformedIntent.entries.map(row => [row.sourceEntryId, row.destinationEntryId, row.relation]), [
  ["root", "root", "copied"], ["prior", "prior", "native_transformed"],
]);
assert.deepEqual(transformedIntent.entries.map(row => JSON.parse(row.destinationJson)), [root, prior]);
assert.deepEqual(transformedIntent.omittedLabelEntryIds, ["prior-label"]);
assert.deepEqual(transformedIntent.labels, [{ targetId: "root", label: "current" }]);
assert.deepEqual(entries.get("prior"), transformed);
assert.equal(transformedIntent.entries[1]?.sourceParentId, "prior-label");
assert.equal(transformedIntent.entries[1]?.destinationParentId, "root");
assert.equal(transformedIntent.entries[1]?.removedActiveLeafId, null);
assert.notEqual(transformedIntent.entries[1]?.sourceEntryRevision, transformedIntent.entries[1]?.destinationEntryRevision);
assert.notEqual(transformedIntent.copyRevision, intent.copyRevision);

const empty = buildBranchCopyIntent({ ...cut, parentId: null }, {
  getLeafId: () => excluded.id,
  getEntry: () => assert.fail("a root user message has no ancestor to copy"),
  getLabel: () => assert.fail("a root user message has no carried labels"),
}, JSON.stringify);
assert.equal(empty.retainedLeafId, null);
assert.deepEqual(empty.entries, []);
assert.deepEqual(empty.labels, []);
assert.deepEqual(empty.omittedLabelEntryIds, []);

entries.set(prior.id, { ...prior, parentId: "absent" });
assert.throws(() => buildBranchCopyIntent(cut, index, JSON.stringify), { code: "BRANCH_COPY_INVALID_PATH" });
entries.set(prior.id, { ...prior, parentId: "selected" });
assert.throws(() => buildBranchCopyIntent(cut, index, JSON.stringify), { code: "BRANCH_COPY_INVALID_PATH" });
entries.set(root.id, { ...root, parentId: prior.id });
entries.set(prior.id, prior);
assert.throws(() => buildBranchCopyIntent(cut, index, JSON.stringify), { code: "BRANCH_COPY_INVALID_PATH" });
entries.set(root.id, root);

const nativeControl = { ...prior, type: "custom", customType: "omp.native-control/submission-v1" };
entries.set(prior.id, nativeControl);
assert.throws(() => buildBranchCopyIntent(cut, index, JSON.stringify), { code: "BRANCH_COPY_INVALID_ENTRY" });
entries.set(prior.id, prior);
assert.throws(() => buildBranchCopyIntent(cut, index, () => '{"id":"substituted"}'), { code: "BRANCH_COPY_INVALID_ENTRY" });
assert.throws(() => buildBranchCopyIntent(cut, { ...index, getLabel: () => "中".repeat(6_000) }, JSON.stringify), {
  code: "BRANCH_COPY_LIMIT",
});

const oversized = (id: string): BranchCopyEntry => {
  const number = Number(id);
  return { id, type: "message", parentId: number > 0 ? String(number - 1) : null };
};
assert.throws(() => buildBranchCopyIntent({ ...cut, parentId: "10000" }, { ...index, getEntry: oversized }, JSON.stringify), {
  code: "BRANCH_COPY_LIMIT",
});

const compaction = { ...prior, type: "compaction", parentId: priorLabel.id, firstKeptEntryId: priorLabel.id };
entries.set(prior.id, compaction);
assert.throws(() => buildBranchCopyIntent(cut, index, JSON.stringify), { code: "BRANCH_COPY_INVALID_ENTRY" });
