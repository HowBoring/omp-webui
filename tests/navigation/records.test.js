/** Pure native serialized-data seam; no worker, provider, disk or collaborator mocks. */
import { expect, test } from "bun:test";
import { navigationRecord, readNavigationRecords } from "../../vendor/omp/packages/coding-agent/src/session/navigation-records.ts";
const origin = { sourceId: "1".repeat(64), instanceId: "2".repeat(64),
  nativeSessionId: "native-fixture", navigationId: "permanent-navigation" };
const completed = { origin, fingerprint: "3".repeat(64), result: {
  version: "durable-navigation-v1", navigationId: origin.navigationId,
  target: { sourceId: origin.sourceId, instanceId: origin.instanceId, nativeSessionId: origin.nativeSessionId },
  found: true, duplicate: false, admission: "local", origin, outcome: "committed",
  reservation: "committed", persistence: "committed", terminal: true,
  requestedTargetId: "original-target", targetParentId: null, actualLeafId: "saved-leaf", commitId: "saved-commit",
} };

test("a later validly checksummed terminal navigation record cannot replace the committed native position", () => {
  const changed = { ...completed, result: { ...completed.result, actualLeafId: "different-leaf" } };
  expect(() => readNavigationRecords([navigationRecord(completed, true), navigationRecord(changed, true)]))
    .toThrow("NAVIGATION_METADATA_CONFLICT");
});

test("an identical terminal receipt remains readable when a native rewrite relocates it without applying position", () => {
  const { actualLeafId, ...remaining } = completed.result;
  const reordered = { ...completed, result: { actualLeafId, ...remaining } };
  expect(readNavigationRecords([navigationRecord(completed, true), navigationRecord(reordered, false)]))
    .toMatchObject([{ origin: { navigationId: "permanent-navigation" },
      result: { outcome: "committed", actualLeafId: "saved-leaf", commitId: "saved-commit" } }]);
});

test("completion cannot replace the permanently reserved native target", () => {
  const { actualLeafId, commitId, ...facts } = completed.result;
  const reserved = { ...completed, result: { ...facts, outcome: "reserved", persistence: "unresolved", terminal: false } };
  const redirected = { ...completed, result: { ...completed.result, requestedTargetId: "different-target" } };
  expect(() => readNavigationRecords([navigationRecord(reserved), navigationRecord(redirected, true)]))
    .toThrow("NAVIGATION_METADATA_CONFLICT");
});
