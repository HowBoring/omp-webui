/** Pure public generated wire seam: no native worker or provider imports. */
import { expect, test } from "bun:test";
import validResult from "../../packages/contracts/generated/submission-result.js";
import validCommand from "../../packages/contracts/generated/submission-command.js";
const result = {
  version: "durable-submission-v1", clientSubmissionId: "key", target: { sourceId: "1".repeat(64),
    instanceId: "2".repeat(64), nativeSessionId: "synthetic" }, found: true, duplicate: false, admission: "local",
  reservation: "committed", inputOutcome: "no_input", operationOutcome: "succeeded", persistence: "committed",
  terminal: true, relations: [], nextOffset: null,
};
test("public submission results require an explicit operation disposition independent of input and persistence", () => {
  const { operationOutcome: _outcome, ...missing } = result;
  expect(validResult(missing)).toBe(false);
  expect(validResult({ ...result, operationOutcome: "acknowledged" })).toBe(false);
  expect(validResult({ ...result, operationOutcome: "unknown", inputOutcome: "generated", terminal: false })).toBe(true);
  expect(validResult({ ...result, operationOutcome: "failed" })).toBe(true);
});
test("public submission admission validates the optional native idle policy without widening the command tunnel", () => {
  const command = { type: "submission_submit", clientSubmissionId: "key", ...result.target, preparationId: "literal",
    inputType: "prompt", message: "literal", idleOnly: true };
  expect(validCommand(command)).toBe(true);
  expect(validCommand({ ...command, idleOnly: "yes" })).toBe(false);
  expect(validCommand({ ...command, type: "arbitrary_native_command" })).toBe(false);
});
