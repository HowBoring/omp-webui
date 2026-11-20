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
  const otherAuthority = new AbortController();
  const view: RetryView = { clientId: "view-a", credentialId: "browser" };
  const otherView: RetryView = { clientId: "view-b", credentialId: "another-browser" };
  const viewKey = (selected: RetryView) => `${selected.clientId}\u0000${selected.credentialId}`;
  const viewAuthorities = new Map([[viewKey(view), authority], [viewKey(otherView), otherAuthority]]);
  const stop: StopSnapshot = { generation: "stop-1", workerGeneration: binding.workerGeneration,
    scope: { kind: "session", sessionId: binding.sessionId }, status: "idle", nativeSettled: true,
    acceptingWork: true, pending: { ...pending }, failures: [], forceAvailable: false, restored: null,
    draftConflict: false };
  let contextRevision = "revision-1";
  let now = 0;
  let reply = async (command: SubmissionClientCommand): Promise<unknown> => receipt(command.clientSubmissionId);
  let rawReply: ((command: SubmissionClientCommand) => Promise<unknown>) | undefined;
  const host: ManualRetryHost = {
    authorize: selected => {
      const signal = viewAuthorities.get(viewKey(selected))?.signal;
      if (signal) return { authority: signal, contextRevision };
    },
    stop: () => stop,
    async request(command) {
      if (!validateCommand(command)) throw Error("INVALID_CANDIDATE_COMMAND");
      commands.push(structuredClone(command));
      if (rawReply) return rawReply(command);
      return { type: "response", id: command.id, command: command.type, success: true, data: await reply(command) };
    },
    now: () => now,
  };
  return { identity: view, otherView, service: new ManualRetry(binding, host), commands, stop,
    revoke: () => authority.abort(), changeContext: () => { contextRevision = "revision-2"; },
    reconnect() {
      const reconnected = { ...view };
      viewAuthorities.set(viewKey(reconnected), new AbortController());
      return reconnected;
    },
    advance: (ms: number) => { now += ms; },
    reply: (handler: (command: SubmissionClientCommand) => Promise<unknown>) => { reply = handler; },
    rawReply: (handler: (command: SubmissionClientCommand) => Promise<unknown>) => { rawReply = handler; } };
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
    status: "unknown", requestId: offer.requestId, evidence: "no_response", settled: false,
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

test("an admitted retry takes its outcome from the exact live result", async () => {
  const f = fixture();
  const offer = f.service.offer(f.identity);
  if (offer.status !== "confirmation") throw Error("expected confirmation");
  const { requestId } = offer;
  expect(await f.service.confirm(f.identity, requestId)).toMatchObject({ status: "admitted", settled: false });
  f.service.observe(binding.workerGeneration, { type: "prompt_result", id: requestId, status: "completed",
    agentInvoked: true, sessionSettled: true });
  expect(f.service.state(f.identity)).toMatchObject({ status: "state",
    attempt: { status: "succeeded", settled: true } });

  const next = f.service.offer(f.identity);
  if (next.status !== "confirmation") throw Error("expected a second confirmation");
  expect(await f.service.confirm(f.identity, next.requestId)).toMatchObject({ status: "admitted" });
  f.service.observe(binding.workerGeneration, { type: "prompt_result", id: next.requestId, status: "aborted",
    agentInvoked: true, sessionSettled: true });
  expect(f.service.state(f.identity)).toMatchObject({ status: "state",
    attempt: { status: "cancelled", settled: true } });
  expect(f.commands.map(command => command.type)).toEqual(["submission_submit", "submission_submit"]);
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

test("another View cannot use a confirmation, an equal one from the wire can dismiss it", async () => {
  const f = fixture();
  const offer = f.service.offer(f.identity);
  if (offer.status !== "confirmation") throw Error("expected confirmation");
  expect(await f.service.confirm(f.otherView, offer.requestId))
    .toEqual({ status: "refused", reason: "stale_confirmation" });
  expect(f.service.cancel({ ...f.identity }, offer.requestId)).toBe(true);
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
  f.rawReply(async command => ({ type: "response", id: command.id, command: command.type, success: false,
    error: "Native submission was busy", code: "SUBMISSION_BUSY" }));

  expect(await f.service.confirm(f.identity, offer.requestId)).toEqual({
    status: "unknown", requestId: offer.requestId, reason: "native_busy", settled: false,
  });
  expect(f.service.blocksAdmission()).toBe(true);
  expect(f.commands).toHaveLength(1);
});

test("transport error text cannot establish a Native busy refusal code", async () => {
  const f = fixture();
  const offer = f.service.offer(f.identity);
  if (offer.status !== "confirmation") throw Error("expected confirmation");
  f.reply(async () => { throw Error("SUBMISSION_BUSY"); });
  expect(await f.service.confirm(f.identity, offer.requestId)).toEqual({
    status: "unknown", requestId: offer.requestId, evidence: "no_response", settled: false,
  });
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
  expect(await f.service.confirm(f.identity, requestId)).toEqual({ status: "unknown", requestId,
    evidence: "receipt_unknown", settled: false });
  f.reply(async command => receipt(command.clientSubmissionId, {
    terminal: true, persistence: "committed", operationOutcome: "succeeded", inputOutcome: "generated",
  }));
  expect(await f.service.lookup(f.identity, requestId)).toEqual({ status: "unknown", requestId,
    evidence: "receipt_unknown", settled: false });
});

test("the source module without a trusted Host binding offers no capability", () => {
  const retry = new ManualRetry(binding);
  expect(retry.offer({ clientId: "view", credentialId: "credential" }))
    .toEqual({ status: "refused", reason: "unavailable" });
});

test("the worker releases a settled retry after the confirming View disconnects", async () => {
  const f = fixture();
  const offer = f.service.offer(f.identity);
  if (offer.status !== "confirmation") throw Error("expected confirmation");
  const { requestId } = offer;
  expect(await f.service.confirm(f.identity, requestId)).toMatchObject({ status: "admitted", settled: false });
  f.revoke();
  const result = { type: "prompt_result", id: requestId, status: "completed", agentInvoked: true, sessionSettled: true };
  f.service.observe("retired-worker", result);
  f.service.observe(binding.workerGeneration, { ...result, id: "earlier-request" });
  expect(f.service.blocksAdmission()).toBe(true);
  f.stop.pending.interactions = 1;
  f.service.observe(binding.workerGeneration, result);
  expect(f.service.blocksAdmission()).toBe(true);
  f.stop.pending.interactions = 0;
  expect(f.service.blocksAdmission()).toBe(false);
  expect(await f.service.lookup(f.identity, requestId)).toEqual({ status: "refused", reason: "forbidden" });
  expect(f.service.offer(f.otherView)).toMatchObject({ status: "confirmation" });
  expect(f.commands.map(command => command.type)).toEqual(["submission_submit"]);
  f.reply(async command => receipt(command.clientSubmissionId, { terminal: true, persistence: "committed",
    inputOutcome: "no_input", operationOutcome: "succeeded" }));
  expect(await f.service.lookup(f.reconnect(), requestId)).toEqual({ status: "succeeded", requestId, settled: true });
});

test("a lost live result can recover committed builtin evidence from a later receipt page", async () => {
  const f = fixture();
  const offer = f.service.offer(f.identity);
  if (offer.status !== "confirmation") throw Error("expected confirmation");
  const { requestId } = offer;
  await f.service.confirm(f.identity, requestId);
  f.reply(async command => {
    if (command.type !== "submission_query") throw Error("UNEXPECTED_DISPATCH");
    const invoked = { relationId: `request-input:${requestId}`, role: "input",
      status: "no_entry", persistence: "committed", reason: "native_builtin_consumed" } as const;
    const entries = Array.from({ length: 128 }, (_, index) => ({
      relationId: `entry:${index}`, entryId: String(index), role: "execution", status: "observed",
      persistence: "committed",
    }) as const);
    return receipt(command.clientSubmissionId, { terminal: true, persistence: "committed",
      inputOutcome: "no_input", operationOutcome: "succeeded",
      ...(command.offset === 128 ? { relations: [invoked] } : { relations: entries, nextOffset: 128 }) });
  });

  expect(await f.service.lookup(f.otherView, requestId)).toEqual({ status: "succeeded", requestId, settled: false });
  expect(f.commands.slice(1)).toEqual([
    { type: "submission_query", id: expect.any(String), clientSubmissionId: requestId, limit: 128 },
    { type: "submission_query", id: expect.any(String), clientSubmissionId: requestId, offset: 128, limit: 128 },
  ]);
});

test.each([true, false])("committed builtin evidence contradicts a completed local frame (frame first: %s)",
  async frameFirst => {
    const f = fixture();
    const offer = f.service.offer(f.identity);
    if (offer.status !== "confirmation") throw Error("expected confirmation");
    const { requestId } = offer;
    await f.service.confirm(f.identity, requestId);
    f.reply(async command => receipt(command.clientSubmissionId, { terminal: true, persistence: "committed",
      inputOutcome: "no_input", operationOutcome: "succeeded", relations: [{ relationId: "native-slot", role: "input",
        status: "no_entry", persistence: "committed", reason: "native_builtin_consumed" }] }));
    const local = { type: "prompt_result", id: requestId, status: "completed", agentInvoked: false, sessionSettled: true };
    if (!frameFirst) {
      expect(await f.service.lookup(f.identity, requestId)).toEqual({ status: "succeeded", requestId, settled: false });
    }
    f.service.observe(binding.workerGeneration, local);
    expect(await f.service.lookup(f.identity, requestId)).toEqual({ status: "unknown", requestId,
      evidence: "conflict", settled: false });
    expect(f.service.blocksAdmission()).toBe(true);
  });

function toolReceiptPage(requestId: string, offset: number, nextOffset: number | null = offset + 128): SubmissionResult {
  const relations = Array.from({ length: 128 }, (_, index) => {
    const entryId = String(offset + index);
    return { relationId: `entry:${entryId}`, entryId, role: "execution", status: "observed",
      persistence: "committed" } as const;
  });
  return receipt(requestId, { terminal: true, persistence: "committed", inputOutcome: "no_input",
    operationOutcome: "succeeded", relations, nextOffset });
}

test.each(["backward cursor", "mismatched origin", "changed outcome"] as const)(
  "a recovery page with %s leaves the operation unknown", async variation => {
    const f = fixture();
    const offer = f.service.offer(f.identity);
    if (offer.status !== "confirmation") throw Error("expected confirmation");
    const { requestId } = offer;
    await f.service.confirm(f.identity, requestId);
    f.reply(async command => {
      if (command.type !== "submission_query") throw Error("UNEXPECTED_DISPATCH");
      if (!command.offset) return toolReceiptPage(requestId, 0);
      const page = toolReceiptPage(requestId, command.offset);
      if (variation === "backward cursor") return { ...page, nextOffset: 128 };
      if (variation === "mismatched origin") return { ...page,
        origin: { ...target, clientSubmissionId: "other-submission" } };
      return { ...page, operationOutcome: "failed" };
    });
    expect(await f.service.lookup(f.identity, requestId)).toEqual({ status: "unknown", requestId,
      evidence: "receipt_unknown", settled: false });
    expect(f.commands.map(command => command.type)).toEqual(["submission_submit", "submission_query", "submission_query"]);
    expect(f.service.blocksAdmission()).toBe(true);
  },
);

test.each([true, false])("recovery resumes beyond the per-call page budget (early marker: %s)", async earlyMarker => {
  const f = fixture();
  const offer = f.service.offer(f.identity);
  if (offer.status !== "confirmation") throw Error("expected confirmation");
  const { requestId } = offer;
  await f.service.confirm(f.identity, requestId);
  const invoked = { relationId: "builtin-slot", role: "input", status: "no_entry",
    persistence: "committed", reason: "native_builtin_consumed" } as const;
  f.reply(async command => {
    if (command.type !== "submission_query") throw Error("UNEXPECTED_DISPATCH");
    const offset = command.offset ?? 0;
    const page = toolReceiptPage(requestId, offset, offset === 4096 ? null : offset + 128);
    if (earlyMarker && offset === 0) page.relations[127] = invoked;
    if (earlyMarker && offset > 0) {
      page.relations = page.relations.map((_, index) => ({
        relationId: `no-entry:${offset + index}`, role: "execution", status: "no_entry", persistence: "committed",
      }));
    }
    if (offset === 4096) page.relations = earlyMarker ? page.relations.slice(0, 1) : [invoked];
    return page;
  });
  expect(await f.service.lookup(f.identity, requestId)).toEqual({ status: "unknown", requestId,
    evidence: "receipt_unknown", settled: false });
  expect(f.commands.filter(command => command.type === "submission_query")).toHaveLength(32);
  expect(f.commands.filter(command => command.type === "submission_submit")).toHaveLength(1);
  expect(f.service.offer(f.otherView)).toEqual({ status: "refused", reason: "busy" });
  expect(await f.service.lookup(f.otherView, requestId)).toEqual({ status: "succeeded", requestId, settled: false });
  expect(f.commands.slice(33)).toEqual([{ type: "submission_query", id: expect.any(String),
    clientSubmissionId: requestId, offset: 4096, limit: 128 }]);
});

test("a resumed page cannot reuse a relation from a previous lookup", async () => {
  const f = fixture();
  const offer = f.service.offer(f.identity);
  if (offer.status !== "confirmation") throw Error("expected confirmation");
  const { requestId } = offer;
  const invoked = { relationId: "builtin-slot", role: "input", status: "no_entry",
    persistence: "committed", reason: "native_builtin_consumed" } as const;
  await f.service.confirm(f.identity, requestId);
  f.reply(async command => {
    if (command.type !== "submission_query") throw Error("UNEXPECTED_DISPATCH");
    const page = toolReceiptPage(requestId, command.offset ?? 0);
    if (command.offset === 4096) return { ...page, relations: [invoked], nextOffset: null };
    if (command.offset === undefined) page.relations[127] = invoked;
    return page;
  });
  expect(await f.service.lookup(f.identity, requestId)).toEqual({ status: "unknown", requestId,
    evidence: "receipt_unknown", settled: false });
  expect(await f.service.lookup(f.otherView, requestId)).toEqual({ status: "unknown", requestId,
    evidence: "receipt_unknown", settled: false });
  expect(f.commands.filter(command => command.type === "submission_query")).toHaveLength(33);
  expect(f.service.blocksAdmission()).toBe(true);
});

test("contradictory committed input evidence fails through submit and query alike", async () => {
  const f = fixture();
  const offer = f.service.offer(f.identity);
  if (offer.status !== "confirmation") throw Error("expected confirmation");
  const { requestId } = offer;
  f.reply(async command => receipt(command.clientSubmissionId, { terminal: true, persistence: "committed",
    inputOutcome: "no_input", operationOutcome: "succeeded", relations: [
      { relationId: "builtin-slot", role: "input", status: "no_entry", persistence: "committed",
        reason: "native_builtin_consumed" },
      { relationId: "entry:user", role: "input", status: "observed", persistence: "committed", entryId: "user" },
    ] }));
  expect(await f.service.confirm(f.identity, requestId)).toEqual({ status: "unknown", requestId,
    evidence: "receipt_unknown", settled: false });
  expect(await f.service.lookup(f.identity, requestId)).toEqual({ status: "unknown", requestId,
    evidence: "receipt_unknown", settled: false });
  expect(f.commands.map(command => command.type)).toEqual(["submission_submit", "submission_query"]);
});

test("a revoked View cannot finish paged recovery", async () => {
  const f = fixture();
  const offer = f.service.offer(f.identity);
  if (offer.status !== "confirmation") throw Error("expected confirmation");
  const { requestId } = offer;
  await f.service.confirm(f.identity, requestId);
  const firstPage = Promise.withResolvers<SubmissionResult>();
  f.reply(async () => firstPage.promise);
  const lookup = f.service.lookup(f.identity, requestId);
  f.revoke();
  firstPage.resolve(toolReceiptPage(requestId, 0));
  expect(await lookup).toEqual({ status: "refused", reason: "forbidden" });
  expect(f.commands.map(command => command.type)).toEqual(["submission_submit", "submission_query"]);
});

test.each(["missing code", "wrong id"] as const)("Native busy requires a correlated machine code (%s)", async defect => {
  const f = fixture();
  const offer = f.service.offer(f.identity);
  if (offer.status !== "confirmation") throw Error("expected confirmation");
  f.rawReply(async command => ({ type: "response", command: command.type, success: false, error: "SUBMISSION_BUSY",
    ...(defect === "missing code" ? { id: command.id } : { id: "earlier-request", code: "SUBMISSION_BUSY" }) }));
  expect(await f.service.confirm(f.identity, offer.requestId)).toEqual({
    status: "unknown", requestId: offer.requestId, evidence: "receipt_unknown", settled: false,
  });
});

test("a duplicate submission reply cannot lend admission to a same-ID live frame", async () => {
  const f = fixture();
  const offer = f.service.offer(f.identity);
  if (offer.status !== "confirmation") throw Error("expected confirmation");
  const { requestId } = offer;
  f.reply(async command => receipt(command.clientSubmissionId, { duplicate: true }));
  expect(await f.service.confirm(f.identity, requestId)).toEqual({ status: "unknown", requestId,
    evidence: "conflict", settled: false });

  f.service.observe(binding.workerGeneration, {
    type: "prompt_result", id: requestId, status: "completed", agentInvoked: true, sessionSettled: true,
  });
  expect(f.service.blocksAdmission()).toBe(true);
  expect(await f.service.lookup(f.identity, "earlier-request")).toEqual({ status: "refused", reason: "unavailable" });
  expect(f.commands.map(command => command.type)).toEqual(["submission_submit"]);
});
