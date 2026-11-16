/** Exact public provenance across native transforms, running state and worker recovery. */
import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { nativeFixture } from "../catalog/fixture.ts";
import { controlledRuntime, terminalSubmission, submissionHistory } from "./fixture.ts";
import { negotiateStrict, selectedDescriptor, strictWorker } from "../continuation/worker.ts";

test("public history exposes original native submission identity by exact entry ID after transforms and restart", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "submission-history-"));
  try {
    await nativeFixture(home);
    const target = await selectedDescriptor(home), cwd = path.join(home, "project");
    let worker = strictWorker(home, cwd, controlledRuntime);
    const command = { type: "submission_submit", clientSubmissionId: "history-origin", preparationId: "literal",
      inputType: "prompt", message: "transform", sourceId: target.sourceId, instanceId: target.instanceId,
      nativeSessionId: target.nativeSessionId };
    const origin = { sourceId: target.sourceId, instanceId: target.instanceId,
      nativeSessionId: target.nativeSessionId, clientSubmissionId: command.clientSubmissionId };
    let committed: { entryId: string; role: string }[] = [];
    try {
      await negotiateStrict(worker);
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: target.reference, expectedCwd: cwd }))
        .toMatchObject({ success: true });
      expect(await worker.request(command)).toMatchObject({ success: true });
      const result = await terminalSubmission(worker, command.clientSubmissionId);
      committed = result.relations.flatMap(relation => relation.entryId && relation.persistence === "committed"
        ? [{ entryId: relation.entryId, role: relation.role }] : []);
      expect(committed.map(relation => relation.role)).toEqual(expect.arrayContaining(["input", "additional", "execution"]));
      const rows = await submissionHistory(worker);
      for (const relation of committed) expect(rows.find(item => item.id === relation.entryId)?.submission)
        .toMatchObject({ origin, role: relation.role });
      expect(rows.find(item => item.id === "entry-0")?.submission).toBeUndefined();
      const running = await submissionHistory(worker, "running");
      expect(running.some(item => item.submission?.origin.clientSubmissionId === command.clientSubmissionId
        && item.submission.role === "input")).toBe(true);
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
    worker = strictWorker(home, cwd, controlledRuntime);
    try {
      await negotiateStrict(worker);
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: target.reference, expectedCwd: cwd }))
        .toMatchObject({ success: true });
      const rows = await submissionHistory(worker);
      for (const relation of committed) expect(rows.find(item => item.id === relation.entryId)?.submission)
        .toMatchObject({ origin, role: relation.role });
      expect(await worker.request(command)).toMatchObject({ success: true, data: { duplicate: true } });
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
  } finally { await fs.rm(home, { recursive: true, force: true }); }
}, 45000);
