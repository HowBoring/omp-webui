import { expect, test } from "bun:test";
import {
  SubmissionClient, type SubmissionClientCommand,
} from "../../packages/contracts/candidates/durable-submission-v1/submission-client.ts";
import validateResult from "../../packages/contracts/candidates/durable-submission-v1/submission-result.js";
import type { SubmissionResult } from "../../packages/contracts/candidates/durable-submission-v1/omp-wire.ts";
import { requestLocalSubmission } from "../../packages/contracts/submission-reply.ts";
import recorded from "./fixtures/submission-query-reopen.json";

// From 36b8c7fdb5b955ae673bdccc401b4f7a3a07d1bb in
// compatibility/evidence/submission-checkpoints/queued-consumption-green.json.
// Reply bodies are .actual.consumption.{admitted,result} and .actual.restartedWithoutReplay.reopened.
// The independent input identity is from .actual.consumption.inputHistory[0].
test("a fresh submission client recovers the same committed Native input using only public queries", async () => {
  const { clientSubmissionId, target } = recorded.admitted;
  const commands: SubmissionClientCommand[] = [];
  const client = (phase: "original" | "reopened") => new SubmissionClient(
    command => requestLocalSubmission(target, command, async outgoing => {
      commands.push(outgoing);
      const data = phase === "reopened" ? recorded.reopened
        : outgoing.type === "submission_submit" ? recorded.admitted : recorded.committed;
      return { type: "response", id: outgoing.id, command: outgoing.type, success: true, data: structuredClone(data) };
    }),
    (value): value is SubmissionResult => validateResult(value),
  );

  const original = client("original");
  const ack = await original.submit({ ...target, clientSubmissionId, preparationId: "literal",
    inputType: "follow_up", message: "literal retained original input" });
  expect(ack).toMatchObject({ clientSubmissionId, reservation: "committed", inputOutcome: "unresolved",
    persistence: "unresolved", terminal: false, relations: [] });
  const committed = await original.query(clientSubmissionId);
  const recovered = await client("reopened").query(clientSubmissionId);

  expect(recovered).toEqual(committed);
  expect(recovered).toMatchObject({ origin: recorded.history.submission.origin, target, clientSubmissionId,
    reservation: "committed", inputOutcome: "generated", persistence: "committed", terminal: true });
  expect(recovered.relations.filter(relation => relation.role === "input")).toEqual([expect.objectContaining({
    role: recorded.history.submission.role, entryId: recorded.history.entryId, availability: "retained",
    status: "observed", persistence: "committed",
  })]);
  expect(commands.map(command => [command.type, command.clientSubmissionId])).toEqual([
    ["submission_submit", clientSubmissionId], ["submission_query", clientSubmissionId],
    ["submission_query", clientSubmissionId],
  ]);
  expect(new Set(commands.map(command => command.id)).size).toBe(3);
});
