import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import validateControl from "../../packages/contracts/generated/session-controls.js";
import { join } from "node:path";
import { parseSessionStatus } from "../../packages/compatibility/session-worker.ts";
import { statusSettled } from "../../packages/sessions/supervisor.ts";

interface Schema {
  "x-rpc": { commands: { name: string; params: string | null; result: string }[] };
  $defs: Record<string, { properties?: Record<string, unknown> }>;
}

const schema = JSON.parse(readFileSync(join(import.meta.dir, "../../packages/contracts/generated/omp.schema.json"), "utf8")) as Schema;
const command = (name: string) => schema["x-rpc"].commands.find(entry => entry.name === name);

test("get_status is an additive, settlement-only projection", () => {
  expect(command("get_status")).toMatchObject({ name: "get_status", result: "SessionStatus" });
  expect(Object.keys(schema.$defs.SessionStatus!.properties ?? {}).sort()).toEqual(
    ["followUpCount", "hasPendingAsyncWork", "isCompacting", "isSettled", "isStreaming", "queuedMessageCount", "sessionId", "steeringCount"]);
});

test("the supervisor command gate admits get_status", () => {
  expect(validateControl({ type: "get_status", id: "status-1" })).toBe(true);
  expect(validateControl({ type: "get_status", id: "status-1", extra: 1 })).toBe(false);
});

test("get_state keeps the full state it always returned", () => {
  expect(command("get_state")).toMatchObject({ name: "get_state", result: "SessionState" });
  expect(Object.keys(schema.$defs.SessionState!.properties ?? {})).toEqual(
    expect.arrayContaining(["systemPrompt", "contextUsage", "tokensPerSecond", "todoPhases"]));
});

const quiescent = { isSettled: true, isStreaming: false, isCompacting: false, hasPendingAsyncWork: false,
  queuedMessageCount: 0, steeringCount: 0, followUpCount: 0 };

test("statusSettled trusts only authoritative settlement inputs", () => {
  expect(statusSettled(quiescent)).toBe(true);
  const unsettled = [
    { isSettled: false }, { isStreaming: true }, { isCompacting: true }, { hasPendingAsyncWork: true },
    { queuedMessageCount: 1 }, { steeringCount: 1 }, { followUpCount: 1 }];
  for (const change of unsettled) expect(statusSettled({ ...quiescent, ...change })).toBe(false);
});

test("a malformed Native status fails the read instead of reporting idle", () => {
  expect(() => parseSessionStatus({ sessionId: "s", isStreaming: false })).toThrow("SESSION_STATUS_SCHEMA");
  expect(parseSessionStatus({ ...quiescent, sessionId: "s" })).toEqual({ ...quiescent, sessionId: "s" });
});
