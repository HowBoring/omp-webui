import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { nativeFixture } from "../catalog/fixture.ts";
import { controlledRuntime, decodeSubmission } from "./fixture.ts";
import { negotiateStrict, selectedDescriptor, strictWorker } from "../continuation/worker.ts";
test("real partial native entry write yields an explicit unknown result; queries never repair or replay", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "submission-failure-"));
  try {
    const root = await nativeFixture(home), target = path.join(root, "bucket/native-0000.jsonl"), cwd = path.join(home, "project");
    const selected = await selectedDescriptor(home), worker = strictWorker(home, cwd, controlledRuntime, undefined, { name: "submission-short-entry", target }, undefined, undefined, 30_000);
    try {
      await negotiateStrict(worker);
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd })).toMatchObject({ success: true });
      await Bun.write(path.join(home, "submission-fault-armed"), "synthetic fault armed");
      await worker.request({ type: "submission_submit", inputType: "prompt", message: "literal", preparationId: "literal-prepared", clientSubmissionId: "failed-write",
        sourceId: selected.sourceId, instanceId: selected.instanceId, nativeSessionId: selected.nativeSessionId });
      let result;
      for (let attempt = 0; attempt < 200; attempt++) {
        result = decodeSubmission(await worker.request({ type: "submission_query", clientSubmissionId: "failed-write" }));
        if (result.persistence === "unknown") break;
        if (attempt === 199) throw Error("UNKNOWN_WRITE_NOT_EXPOSED");
        await Bun.sleep(25);
      }
      expect(result).toMatchObject({ persistence: "unknown", reservation: "unknown", inputOutcome: "unresolved", terminal: false });
      expect(await worker.request({ type: "get_entries" })).toMatchObject({ success: true, data: { entries: expect.arrayContaining([
        expect.objectContaining({ type: "message", message: expect.objectContaining({ role: "user" }) })]) } });

      const evidence = await fs.readFile(path.join(home, "strict-syscalls.log"), "utf8");
      expect(evidence).toContain('"event":"submission-short-entry","actual_written":20');
      const before = await fs.readFile(target);
      expect(decodeSubmission(await worker.request({ type: "submission_query", clientSubmissionId: "failed-write" })).persistence).toBe("unknown");
      expect(await fs.readFile(target)).toEqual(before);
    } finally { await worker.close().catch(() => {}); worker.child.kill(); await worker.child.exited; }
  } finally { await fs.rm(home, { recursive: true, force: true }); }
}, 45000);
