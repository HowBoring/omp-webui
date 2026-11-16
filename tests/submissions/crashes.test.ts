import { controlledRuntime, decodeSubmission } from "./fixture.ts";
import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { nativeFixture } from "../catalog/fixture.ts";
import { negotiateStrict, selectedDescriptor, strictWorker } from "../continuation/worker.ts";
const runtime = controlledRuntime;
for (const stage of ["submission-reservation-crash", "submission-before-entry-crash", "submission-entry-crash", "submission-completion-crash"] as const)
  test(`${stage}: recovery queries facts without dispatching a reserved input again`, async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "submission-crash-"));
    try {
      const root = await nativeFixture(home), target = path.join(root, "bucket/native-0000.jsonl"), cwd = path.join(home, "project");
      const selected = await selectedDescriptor(home);
      const command = { type: "submission_submit", clientSubmissionId: "crash-input", preparationId: "literal-prepared", inputType: "prompt",
        sourceId: selected.sourceId, instanceId: selected.instanceId, nativeSessionId: selected.nativeSessionId, message: "literal" };
      let worker = strictWorker(home, cwd, runtime, undefined, { name: stage, target });
      try {
        await negotiateStrict(worker);
        expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd })).toMatchObject({ success: true });
        await Bun.write(path.join(home, "submission-fault-armed"), "synthetic fault armed");
        worker.send({ ...command, id: "crash-request" });
        expect(await worker.child.exited).toBe(91);
        expect(await fs.readFile(path.join(home, "strict-syscalls.log"), "utf8")).toContain(`"event":"${stage}"`);
      } finally { worker.child.kill(); await worker.child.exited; }
      const before = await fs.readFile(path.join(home, "submission-provider-effects.json"), "utf8").catch(() => "absent");
      worker = strictWorker(home, cwd, runtime);
      try {
        await negotiateStrict(worker);
        expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd })).toMatchObject({ success: true });
        const query = await worker.request({ type: "submission_query", clientSubmissionId: command.clientSubmissionId });
        const facts = decodeSubmission(query);
        const hasInput = facts.relations.some(relation => relation.role === "input" && relation.persistence === "committed");
        expect(hasInput).toBe(stage === "submission-entry-crash" || stage === "submission-completion-crash");
        expect(query).toMatchObject({ success: true, data: { found: true, reservation: "committed",
          terminal: stage === "submission-completion-crash", persistence: stage === "submission-completion-crash" ? "committed" : "unresolved" } });
        expect(await worker.request(command)).toMatchObject({ success: true, data: { duplicate: true } });
        expect((await worker.close()).code).toBe(0);
      } finally { worker.child.kill(); await worker.child.exited; }
      expect(await fs.readFile(path.join(home, "submission-provider-effects.json"), "utf8").catch(() => "absent")).toBe(before);
    } finally { await fs.rm(home, { recursive: true, force: true }); }
  }, 30000);
