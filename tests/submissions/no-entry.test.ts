import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { nativeFixture } from "../catalog/fixture.ts";
import { controlledRuntime, terminalSubmission } from "./fixture.ts";
import { negotiateStrict, selectedDescriptor, strictWorker } from "../continuation/worker.ts";
for (const scenario of ["empty-error", "refusal"] as const) test(`actual ${scenario} distinguishes committed user input from native model no-entry/recovery`, async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "submission-no-entry-"));
  try {
    await nativeFixture(home);
    const target = await selectedDescriptor(home), cwd = path.join(home, "project"), worker = strictWorker(home, cwd, controlledRuntime);
    try {
      await negotiateStrict(worker);
      await worker.request({ type: "strict_start", intent: "continue", reference: target.reference, expectedCwd: cwd });
      expect(await worker.request({ type: "submission_submit", inputType: "prompt", message: scenario, preparationId: "literal-prepared", clientSubmissionId: scenario,
        sourceId: target.sourceId, instanceId: target.instanceId, nativeSessionId: target.nativeSessionId })).toMatchObject({ success: true });
      const result = await terminalSubmission(worker, scenario);
      const decisions = result.relations.filter(relation => relation.role === "execution");
      expect(result.inputOutcome).toBe("generated"); expect(result.persistence).toBe("committed");
      expect(result.relations).toContainEqual(expect.objectContaining({ role: "input", persistence: "committed", status: "observed" }));
      if (scenario === "refusal") expect(decisions).toContainEqual(expect.objectContaining({ status: "no_entry", reason: "classifier_refusal", persistence: "committed" }));
      else expect(decisions).toContainEqual(expect.objectContaining({ status: "observed", persistence: "committed" }));
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
  } finally { await fs.rm(home, { recursive: true, force: true }); }
}, 30000);
