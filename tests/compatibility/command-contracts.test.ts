import { expect, test } from "bun:test";
import preflight from "../../packages/contracts/generated/command.js";
import catalog from "../../packages/contracts/generated/catalog-command.js";
import history from "../../packages/contracts/generated/history-command.js";
import interaction from "../../packages/contracts/generated/interaction-command.js";
import branch from "../../packages/contracts/generated/branch-controls.js";

test("same-source command validators preserve explicit whitelists, parameterless calls and ID policies", () => {
  expect(preflight({ id: "request", type: "get_compatibility" })).toBe(true);
  expect(preflight({ type: "get_compatibility" })).toBe(false);
  expect(preflight({ id: "request", type: "get_compatibility", extra: true })).toBe(false);
  expect(catalog({ id: "request", type: "get_compatibility" })).toBe(false);
  expect(interaction({ type: "get_interaction_policy" })).toBe(true);
  expect(interaction({ type: "get_interaction_policy", extra: true })).toBe(false);
  expect(interaction({ type: "history_snapshot_open", scope: "tree" })).toBe(false);
  expect(history({ id: "x".repeat(96), type: "history_snapshot_open", scope: "tree" })).toBe(true);
  expect(history({ id: "x".repeat(97), type: "history_snapshot_open", scope: "tree" })).toBe(false);
  expect(history({ id: "request", type: "history_snapshot_open" })).toBe(false);
  expect(history({ id: "request", type: "history_snapshot_open", scope: "unknown" })).toBe(false);
  expect(history({ id: "request", type: "get_compatibility" })).toBe(false);
  expect(history({ id: "request", type: "history_snapshot_open", scope: "tree", extra: true })).toBe(false);
  // The strict branch relaxation admits the native cut and its allow-list read, nothing else.
  expect(branch({ id: "request", type: "branch", entryId: "entry-1" })).toBe(true);
  expect(branch({ id: "request", type: "get_branch_messages" })).toBe(true);
  expect(branch({ id: "request", type: "branch", entryId: "e", extra: true })).toBe(false);
  expect(branch({ id: "request", type: "branch" })).toBe(false);
  expect(branch({ id: "x".repeat(97), type: "branch", entryId: "e" })).toBe(false);
  for (const type of ["fork", "new_session", "switch_session", "prompt", "session_cancel"])
    expect(branch({ id: "request", type })).toBe(false);
});
