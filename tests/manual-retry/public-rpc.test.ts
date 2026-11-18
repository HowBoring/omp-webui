import { expect, test } from "bun:test";
import validateCommand from "../../packages/contracts/candidates/durable-submission-v1/submission-command.js";
import type { SubmissionClientCommand } from
  "../../packages/contracts/candidates/durable-submission-v1/submission-client.ts";
import type { SubmissionResult } from "../../packages/contracts/candidates/durable-submission-v1/omp-wire.ts";
import type { StopSnapshot } from "../../packages/contracts/stop.ts";
import { ManualRetry, type ManualRetryHost, type RetryView } from "../../packages/manual-retry/service.ts";

const target = { sourceId: "a".repeat(64), instanceId: "b".repeat(64), nativeSessionId: "native" };
const binding = { sessionId: "registered", workerGeneration: "worker-1", target };
const pending = { interactions: 0, history: 0, queued: 0, other: 0 };

function receipt(clientSubmissionId: string, overrides: Partial<SubmissionResult> = {}): SubmissionResult {
  return { version: "durable-submission-v1", clientSubmissionId, target, found: true, duplicate: false,
    admission: "local", origin: { ...target, clientSubmissionId }, reservation: "committed",
    operationOutcome: "unknown", inputOutcome: "unresolved", terminal: false, persistence: "unresolved",
    relations: [], nextOffset: null, ...overrides };
}

function fixture() {
  const commands: SubmissionClientCommand[] = [];
  const authority = new AbortController();
  const view: RetryView = { clientId: "view-a", credentialId: "browser" };
  const stop: StopSnapshot = { generation: "stop-1", workerGeneration: binding.workerGeneration,
    scope: { kind: "session", sessionId: binding.sessionId }, status: "idle", nativeSettled: true,
    acceptingWork: true, pending: { ...pending }, failures: [], forceAvailable: false, restored: null,
    draftConflict: false };
  let contextRevision = "revision-1";
  let now = 0;
  let reply = async (command: SubmissionClientCommand): Promise<unknown> => receipt(command.clientSubmissionId);
  const host: ManualRetryHost = {
    authorize: () => ({ authority: authority.signal, contextRevision, stop }),
    async request(command) {
      if (!validateCommand(command)) throw Error("INVALID_CANDIDATE_COMMAND");
      commands.push(structuredClone(command));
      return reply(command);
    },
    now: () => now,
  };
  return { identity: view, service: new ManualRetry(binding, host), commands, stop,
    revoke: () => authority.abort(), changeContext: () => { contextRevision = "revision-2"; },
    advance: (ms: number) => { now += ms; },
    reply: (handler: (command: SubmissionClientCommand) => Promise<unknown>) => { reply = handler; } };
}

test("only a confirmed manual action sends a fresh idle-only /retry prompt", async () => {
  const f = fixture();
  const offer = f.service.offer(f.identity);
  expect(offer.status).toBe("confirmation");
  if (offer.status !== "confirmation") throw Error("expected confirmation");
  expect(offer.notice).toContain("run tools again");
  expect(offer.notice).toContain("side effects");
  expect(f.commands).toEqual([]);

  expect(await f.service.confirm(f.identity, offer.requestId)).toEqual({
    status: "admitted", requestId: offer.requestId, settled: false,
  });
  expect(f.commands).toEqual([{ type: "submission_submit", id: offer.requestId, clientSubmissionId: offer.requestId,
    ...target, preparationId: `manual-retry-v1:${offer.requestId}`,
    inputType: "prompt", idleOnly: true, message: "/retry" }]);
});

test("a lost submit reply stays unknown and explicit recovery only queries the original request", async () => {
  const f = fixture();
  const offer = f.service.offer(f.identity);
  if (offer.status !== "confirmation") throw Error("expected confirmation");
  f.reply(async command => {
    if (command.type === "submission_submit") throw Error("RPC_RESPONSE_TIMEOUT");
    return receipt(command.clientSubmissionId);
  });

  expect(await f.service.confirm(f.identity, offer.requestId)).toEqual({
    status: "unknown", requestId: offer.requestId, settled: false,
  });
  expect(await f.service.confirm(f.identity, offer.requestId)).toMatchObject({ status: "refused" });
  expect(f.service.offer(f.identity)).toEqual({ status: "refused", reason: "busy" });
  expect(f.commands.map(command => command.type)).toEqual(["submission_submit"]);

  expect(await f.service.lookup(f.identity, offer.requestId)).toEqual({
    status: "admitted", requestId: offer.requestId, settled: false,
  });
  expect(f.commands.slice(1)).toEqual([{ type: "submission_query", id: expect.any(String),
    clientSubmissionId: offer.requestId, limit: 128 }]);
  expect(f.commands[1]?.id).not.toBe(offer.requestId);
});

test("retry result and joint Stop settlement belong to the same worker and attempt", async () => {
  const f = fixture();
  const offer = f.service.offer(f.identity);
  if (offer.status !== "confirmation") throw Error("expected confirmation");
  const { requestId } = offer;
  expect(await f.service.confirm(f.identity, requestId)).toMatchObject({ status: "admitted", settled: false });
  f.reply(async command => receipt(command.clientSubmissionId, { inputOutcome: "no_input", operationOutcome: "succeeded",
    persistence: "committed", terminal: true, relations: [{ relationId: `request-input:${requestId}`, role: "input",
      status: "no_entry", persistence: "committed", reason: "native_builtin_consumed" }] }));
  const outcome = { type: "prompt_result", id: requestId, status: "completed", agentInvoked: true, sessionSettled: false };
  f.service.observe("retired-worker", { ...outcome, sessionSettled: true });
  f.service.observe(binding.workerGeneration, { ...outcome, id: "previous-input", sessionSettled: true });
  expect(await f.service.lookup(f.identity, requestId)).toEqual({ status: "succeeded", requestId, settled: false });

  f.service.observe(binding.workerGeneration, outcome);
  f.stop.pending.interactions = 1;
  f.service.observe(binding.workerGeneration, { type: "session_settled" });
  expect(await f.service.lookup(f.identity, requestId)).toEqual({ status: "succeeded", requestId, settled: false });
  f.stop.pending.interactions = 0;
  expect(await f.service.lookup(f.identity, requestId)).toEqual({ status: "succeeded", requestId, settled: true });
  expect(f.service.offer(f.identity)).toMatchObject({ status: "confirmation" });
});

test("busy, expired, changed context, replaced worker and revoked confirmations send nothing", async () => {
  const f = fixture();
  const offer = () => {
    const result = f.service.offer(f.identity);
    if (result.status !== "confirmation") throw Error("expected confirmation");
    return result.requestId;
  };

  const becameBusy = offer();
  f.stop.pending.queued = 1;
  expect(await f.service.confirm(f.identity, becameBusy)).toEqual({ status: "refused", reason: "busy" });
  expect(f.service.offer(f.identity)).toEqual({ status: "refused", reason: "busy" });
  f.stop.pending.queued = 0;
  expect(await f.service.confirm(f.identity, becameBusy)).toEqual({ status: "refused", reason: "stale_confirmation" });

  const expired = offer();
  f.advance(30_000);
  expect(await f.service.confirm(f.identity, expired)).toEqual({ status: "refused", reason: "stale_confirmation" });
  const changedContext = offer();
  f.changeContext();
  expect(await f.service.confirm(f.identity, changedContext)).toEqual({ status: "refused", reason: "stale_confirmation" });
  const replacedWorker = offer();
  f.stop.workerGeneration = "worker-2";
  expect(await f.service.confirm(f.identity, replacedWorker)).toEqual({ status: "refused", reason: "forbidden" });
  f.stop.workerGeneration = binding.workerGeneration;
  const revoked = offer();
  f.revoke();
  expect(await f.service.confirm(f.identity, revoked)).toEqual({ status: "refused", reason: "forbidden" });
  expect(f.commands).toEqual([]);
});

test("a different View cannot use a confirmation, and dismissing it sends nothing", async () => {
  const f = fixture();
  const offer = f.service.offer(f.identity);
  if (offer.status !== "confirmation") throw Error("expected confirmation");
  expect(await f.service.confirm({ ...f.identity }, offer.requestId))
    .toEqual({ status: "refused", reason: "stale_confirmation" });
  expect(f.service.cancel(f.identity, offer.requestId)).toBe(true);
  expect(await f.service.confirm(f.identity, offer.requestId)).toMatchObject({ status: "refused" });
  expect(f.commands).toEqual([]);
});

test("a durable local refusal is reported without waiting for a prompt result", async () => {
  const f = fixture();
  const offer = f.service.offer(f.identity);
  if (offer.status !== "confirmation") throw Error("expected confirmation");
  f.reply(async command => receipt(command.clientSubmissionId, { terminal: true, persistence: "committed",
    operationOutcome: "failed", inputOutcome: "no_input" }));

  expect(await f.service.confirm(f.identity, offer.requestId)).toEqual({
    status: "failed", reason: "native_refused", settled: true, requestId: offer.requestId,
  });
  expect(f.commands).toHaveLength(1);
});

test("a native busy error preserves its reason and does not turn into a second submission", async () => {
  const f = fixture();
  const offer = f.service.offer(f.identity);
  if (offer.status !== "confirmation") throw Error("expected confirmation");
  f.reply(async () => { throw Error("SUBMISSION_BUSY"); });

  expect(await f.service.confirm(f.identity, offer.requestId)).toEqual({
    status: "unknown", requestId: offer.requestId, reason: "native_busy", settled: false,
  });
  expect(f.service.blocksAdmission()).toBe(true);
  expect(f.commands).toHaveLength(1);
});

test("a native cancelled retry remains cancelled after the session settles", async () => {
  const f = fixture();
  const offer = f.service.offer(f.identity);
  if (offer.status !== "confirmation") throw Error("expected confirmation");
  const { requestId } = offer;
  await f.service.confirm(f.identity, requestId);
  f.service.observe(binding.workerGeneration, {
    type: "prompt_result", id: requestId, status: "aborted", agentInvoked: true, sessionSettled: true,
  });
  f.reply(async command => receipt(command.clientSubmissionId, { inputOutcome: "no_input",
    operationOutcome: "cancelled", terminal: true, persistence: "committed" }));
  expect(await f.service.lookup(f.identity, requestId)).toEqual({ status: "cancelled", requestId, settled: true });
  expect(f.commands.filter(command => command.type === "submission_submit")).toHaveLength(1);
});

test("a delayed reply loses presentation authority without replaying work", async () => {
  const f = fixture();
  const offer = f.service.offer(f.identity);
  if (offer.status !== "confirmation") throw Error("expected confirmation");
  const result = Promise.withResolvers<SubmissionResult>();
  f.reply(async () => result.promise);
  const confirmed = f.service.confirm(f.identity, offer.requestId);
  f.revoke();
  result.resolve(receipt(offer.requestId));

  expect(await confirmed).toEqual({ status: "refused", reason: "forbidden" });
  expect(await f.service.lookup(f.identity, offer.requestId)).toEqual({ status: "refused", reason: "forbidden" });
  expect(f.commands.map(command => command.type)).toEqual(["submission_submit"]);
});

test("native receipts for another Session or a generated prompt cannot establish retry outcome", async () => {
  const f = fixture();
  const offer = f.service.offer(f.identity);
  if (offer.status !== "confirmation") throw Error("expected confirmation");
  const { requestId } = offer;
  f.reply(async command => receipt(command.clientSubmissionId, {
    target: { ...target, nativeSessionId: "unrelated" }, terminal: true, persistence: "committed",
    operationOutcome: "succeeded", inputOutcome: "no_input",
  }));
  expect(await f.service.confirm(f.identity, requestId)).toEqual({ status: "unknown", requestId, settled: false });
  f.reply(async command => receipt(command.clientSubmissionId, {
    terminal: true, persistence: "committed", operationOutcome: "succeeded", inputOutcome: "generated",
  }));
  expect(await f.service.lookup(f.identity, requestId)).toEqual({ status: "unknown", requestId, settled: false });
});

test("the source module without a trusted Host binding offers no capability", () => {
  const retry = new ManualRetry(binding);
  expect(retry.offer({ clientId: "view", credentialId: "credential" }))
    .toEqual({ status: "refused", reason: "unavailable" });
});
