import { expect, test } from "bun:test";
import { validNavigationCommand, validNavigationPreview, validNavigationResult } from "../../packages/contracts/candidates/durable-navigation-v1/validators";
import { NavigationClient } from "../../packages/contracts/candidates/durable-navigation-v1/navigation-client";
import type { NavigationClientCommand } from "../../packages/contracts/candidates/durable-navigation-v1/navigation-client";
import type { NavigationPreview, NavigationResult } from "../../packages/contracts/candidates/durable-navigation-v1/omp-wire";

test("public committed navigation command accepts exact scope and refuses legacy or unrecognized fields", () => {
  const command = { id: "transport-1", type: "navigate_tree_committed", navigationId: "operation-1",
    sourceId: "source-1", instanceId: "instance-1", nativeSessionId: "native-1", entryId: "entry-1",
    expectedContextRevision: "context-1", expectedTargetRevision: "target-1" };
  expect(validNavigationCommand(command)).toBe(true);
  expect(validNavigationCommand({ ...command, type: "navigate_tree" })).toBe(false);
  expect(validNavigationCommand({ ...command, arbitraryRpc: true })).toBe(false);
  expect(validNavigationCommand({ ...command, sourceId: undefined })).toBe(false);
});

const target = { sourceId: "source-1", instanceId: "instance-1", nativeSessionId: "native-1" };
const preview: NavigationPreview = { version: "durable-navigation-v1", target, entryId: "entry-1",
  targetParentId: "parent-1", targetRevision: "target-1", contextRevision: "context-1" };
const unknown: NavigationResult = { version: "durable-navigation-v1", navigationId: "operation-1", target,
  found: false, duplicate: false, admission: "absent", outcome: "unknown", reservation: "unknown",
  persistence: "unknown", terminal: false };

test("public preview and result schemas refuse malformed target, revision, and outcome facts", () => {
  expect(validNavigationPreview(preview)).toBe(true);
  expect(validNavigationPreview({ ...preview, target: { sourceId: "source-1" } })).toBe(false);
  expect(validNavigationPreview({ ...preview, contextRevision: null })).toBe(false);
  expect(validNavigationResult(unknown)).toBe(true);
  expect(validNavigationResult({ ...unknown, outcome: "succeeded" })).toBe(false);
  expect(validNavigationResult({ ...unknown, persistence: undefined })).toBe(false);
});

test("public client inspects, commits once, and queries the stable operation key with distinct transport ids", async () => {
  const commands: NavigationClientCommand[] = [];
  const client = new NavigationClient(async command => {
    commands.push(command);
    expect(validNavigationCommand(command)).toBe(true);
    return command.type === "navigation_inspect" ? preview : unknown;
  }, validNavigationResult, validNavigationPreview);
  expect(await client.inspect("entry-1")).toEqual(preview);
  expect(await client.navigate({ ...target, navigationId: "operation-1", entryId: "entry-1",
    expectedContextRevision: "context-1", expectedTargetRevision: "target-1" })).toEqual(unknown);
  expect(await client.query("operation-1")).toEqual(unknown);
  expect(commands.map(command => command.type)).toEqual(["navigation_inspect", "navigate_tree_committed", "navigation_query"]);
  expect(new Set(commands.map(command => command.id)).size).toBe(3);
});

test("public client refuses wrong echoed entry and operation keys or malformed replies", async () => {
  const wrongPreview = new NavigationClient(async () => ({ ...preview, entryId: "other" }), validNavigationResult, validNavigationPreview);
  await expect(wrongPreview.inspect("entry-1")).rejects.toThrow("NAVIGATION_PREVIEW_SCHEMA");
  const wrongResult = new NavigationClient(async () => ({ ...unknown, navigationId: "other" }), validNavigationResult, validNavigationPreview);
  await expect(wrongResult.query("operation-1")).rejects.toThrow("NAVIGATION_RESULT_SCHEMA");
  await expect(wrongResult.navigate({ ...target, navigationId: "operation-1", entryId: "entry-1" })).rejects.toThrow("NAVIGATION_RESULT_SCHEMA");
  const malformed = new NavigationClient(async () => ({ found: true }), validNavigationResult, validNavigationPreview);
  await expect(malformed.query("operation-1")).rejects.toThrow("NAVIGATION_RESULT_SCHEMA");
});

test("failed outcome with committed effects and reference-only draft remains an explicit native fact", async () => {
  const failed: NavigationResult = { ...unknown, found: true, admission: "local", outcome: "failed", terminal: true,
    reservation: "committed", persistence: "committed", commitId: "commit-1", actualLeafId: "post-hook-leaf",
    draftStatus: "reference_only", draftUnavailableReason: "inline-limit" };
  const client = new NavigationClient(async () => failed, validNavigationResult, validNavigationPreview);
  expect(await client.query("operation-1")).toEqual(failed);
  expect(failed.editorText).toBeUndefined();
});
