/** Pure public Native causal-carrier contract. Actual SDK/helper RED is recorded separately. */
import { expect, test } from "bun:test";
import {
  assertSubmissionCurrent, causalSubmission, captureSubmission, capturedSubmissionScope, copySubmission,
  runSubmission, runSubmissionForOwner, sdkMessageSubmission, submissionScope,
} from "../../vendor/omp/packages/coding-agent/src/session/submission-provenance.ts";

const origin = { sourceId: "1".repeat(64), instanceId: "2".repeat(64),
  nativeSessionId: "parent-native", clientSubmissionId: "parent-submission" };

test("a distinct Native owner and a default-created owner clear scope for their full async call and restore the parent", async () => {
  const parent = {}, child = {}, scope = { origin, owner: parent, phase: "input" };
  await runSubmission(scope, async () => {
    for (const owner of [child, undefined]) await runSubmissionForOwner(owner, async () => {
      expect(submissionScope()).toBeUndefined();
      await Promise.resolve();
      expect(submissionScope()).toBeUndefined();
    });
    expect(submissionScope()).toBe(scope);
  });
  expect(submissionScope()).toBeUndefined();
});

test("same-owner stale source checks still run even when a different owner presents identical target strings", () => {
  const parent = {}, child = {}, scope = { origin, owner: parent, phase: "input" };
  runSubmission(scope, () => {
    expect(() => runSubmissionForOwner(parent, () => assertSubmissionCurrent(() => ({ ...origin,
      sourceId: "3".repeat(64) })))).toThrow("SUBMISSION_TARGET_CHANGED");
    runSubmissionForOwner(child, () => {
      expect(submissionScope()).toBeUndefined();
      // A child owning identical target strings is still a distinct owner. No target reader selects the scope.
      assertSubmissionCurrent(() => { throw Error("foreign-owner-target-read"); });
    });
    expect(submissionScope()).toBe(scope);
  });
});

test("detached raw SDK objects and normalized copies retain their exact owner without restoring it in another owner", async () => {
  const parent = {}, child = {}, raw = {}, normalized = {}, copy = {};
  const scope = { origin, owner: parent, phase: "input" };
  runSubmission(scope, () => {
    sdkMessageSubmission(raw);
    captureSubmission(normalized, "user");
    copySubmission(normalized, copy);
  });
  for (const message of [raw, normalized, copy]) {
    const captured = sdkMessageSubmission(message);
    expect(captured?.owner).toBe(parent);
    expect(captured?.origin.clientSubmissionId).toBe("parent-submission");
    await runSubmissionForOwner(child, async () => {
      expect(submissionScope()).toBeUndefined();
      await Promise.resolve();
      expect(submissionScope()).toBeUndefined();
    }, captured);
    runSubmissionForOwner(parent, () => expect(submissionScope()?.owner).toBe(parent), captured);
  }
  expect(capturedSubmissionScope(copy)?.owner).toBe(parent);
});

test("raw SDK reuse under distinct owners is detached-ambiguous even when their serialized origins match", () => {
  const raw = {}, first = { origin, owner: {}, phase: "input" }, second = { origin, owner: {}, phase: "input" };
  runSubmission(first, () => expect(sdkMessageSubmission(raw)?.owner).toBe(first.owner));
  runSubmission(second, () => expect(sdkMessageSubmission(raw)?.owner).toBe(second.owner));
  expect(() => sdkMessageSubmission(raw)).toThrow("SUBMISSION_CAUSALITY_AMBIGUOUS");
});

test("owner entry admission clears implicit async work while retaining earned original and copied causes", async () => {
  const parent = {}, child = {}, original = {}, copied = {}, unbound = {};
  const scope = { origin, owner: parent, phase: "input" };
  await runSubmission(scope, async () => {
    captureSubmission(original, "user");
    copySubmission(original, copied);
    await runSubmissionForOwner(child, async () => {
      expect(causalSubmission()).toBeUndefined();
      expect(causalSubmission(unbound)).toBeUndefined();
      for (const message of [original, copied]) {
        expect(causalSubmission(message)).toEqual({ origin, role: "input" });
        expect(capturedSubmissionScope(message)?.owner).toBe(parent);
      }
      await Promise.resolve().then(() => expect(causalSubmission()).toBeUndefined());
    });
    expect(submissionScope()).toBe(scope);
    expect(causalSubmission()).toEqual({ origin, role: "additional" });
    expect(() => runSubmissionForOwner(parent, () => assertSubmissionCurrent(() => ({ ...origin,
      instanceId: "4".repeat(64) })))).toThrow("SUBMISSION_TARGET_CHANGED");
  });
});
