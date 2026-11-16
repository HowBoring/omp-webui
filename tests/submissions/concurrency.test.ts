import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { nativeFixture } from "../catalog/fixture.ts";
import { controlledRuntime, terminalSubmission, decodeSubmission } from "./fixture.ts";
import { negotiateStrict, selectedDescriptor, strictWorker, isolatedRuntimeArgs } from "../continuation/worker.ts";
test("concurrent duplicate/conflicting submissions dispatch once and a queued steer retains its explicit ingress origin", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "submission-concurrent-"));
  try {
    await nativeFixture(home);
    const target = await selectedDescriptor(home), cwd = path.join(home, "project"), worker = strictWorker(home, cwd, controlledRuntime);
    try {
      await negotiateStrict(worker);
      await worker.request({ type: "strict_start", intent: "continue", reference: target.reference, expectedCwd: cwd });
      const command = { type: "submission_submit", inputType: "prompt", message: "first", preparationId: "fixed-preparation", clientSubmissionId: "concurrent-id",
        sourceId: target.sourceId, instanceId: target.instanceId, nativeSessionId: target.nativeSessionId };
      const [first, duplicate, conflict] = await Promise.all([worker.request(command), worker.request(command), worker.request({ ...command, preparationId: "changed-preparation" })]);
      expect(first).toMatchObject({ success: true });
      expect(decodeSubmission(duplicate).duplicate).toBe(true);
      expect(conflict).toMatchObject({ success: false, code: "SUBMISSION_CONFLICT" });
      const queued = { ...command, clientSubmissionId: "queued-steer", inputType: "steer", message: "independent queued steer" };
      expect(await worker.request(queued)).toMatchObject({ success: true });
      const [a, b] = await Promise.all([terminalSubmission(worker, command.clientSubmissionId), terminalSubmission(worker, queued.clientSubmissionId)]);
      const left = a.relations.filter(relation => relation.role === "input").map(relation => relation.entryId);
      const right = b.relations.filter(relation => relation.role === "input").map(relation => relation.entryId);
      expect(a.inputOutcome).toBe("generated"); expect(b.inputOutcome).toBe("generated");
      expect(left).toHaveLength(1); expect(right).toHaveLength(1); expect(left[0]).not.toBe(right[0]);
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
  } finally { await fs.rm(home, { recursive: true, force: true }); }
}, 30000);

test("admission beyond the former header cap retains its earliest permanent tombstone", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "submission-capacity-"));
  try {
    await nativeFixture(home);
    const target = await selectedDescriptor(home), cwd = path.join(home, "project"), worker = strictWorker(home, cwd, isolatedRuntimeArgs);
    try {
      await negotiateStrict(worker);
      await worker.request({ type: "strict_start", intent: "continue", reference: target.reference, expectedCwd: cwd });
      const command = { type: "submission_submit", inputType: "prompt", message: "", preparationId: "fixed-preparation", clientSubmissionId: "permanent-0",
        sourceId: target.sourceId, instanceId: target.instanceId, nativeSessionId: target.nativeSessionId };
      for (let index = 0; index < 32; index++) expect(await worker.request({ ...command, clientSubmissionId: `permanent-${index}` })).toMatchObject({ success: true });
      expect(await worker.request({ ...command, clientSubmissionId: "permanent-overflow" })).toMatchObject({ success: true });
      expect(await worker.request(command)).toMatchObject({ success: true, data: { duplicate: true, terminal: true } });
      expect(await worker.request({ type: "submission_query", clientSubmissionId: command.clientSubmissionId, limit: 129 }))
        .toMatchObject({ success: false, code: "SUBMISSION_QUERY_BOUNDS" });
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
  } finally { await fs.rm(home, { recursive: true, force: true }); }
}, 30000);
