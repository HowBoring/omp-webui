/** Actual public native results distinguish operation outcome from committed input and effects. */
import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { nativeFixture } from "../catalog/fixture.ts";
import { controlledRuntime, decodeSubmission, terminalSubmission } from "./fixture.ts";
import { negotiateStrict, selectedDescriptor, strictWorker } from "../continuation/worker.ts";

test("native operation results persist independently of primary input creation and never replay after restart", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "submission-outcomes-"));
  try {
    await nativeFixture(home);
    const selected = await selectedDescriptor(home), cwd = path.join(home, "project");
    const target = { sourceId: selected.sourceId, instanceId: selected.instanceId, nativeSessionId: selected.nativeSessionId };
    const cases = [
      { key: "handled-with-effect", message: "handled", inputOutcome: "no_input", operationOutcome: "succeeded" },
      { key: "ordinary-success", message: "literal", inputOutcome: "generated", operationOutcome: "succeeded" },
      { key: "builtin-usage-failure", message: "/force", inputOutcome: "no_input", operationOutcome: "failed" },
      { key: "provider-refusal", message: "refusal", inputOutcome: "generated", operationOutcome: "failed" },
    ];
    let worker = strictWorker(home, cwd, controlledRuntime);
    try {
      await negotiateStrict(worker);
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd }))
        .toMatchObject({ success: true });
      for (const fixture of cases) {
        expect(await worker.request({ type: "submission_submit", ...target, inputType: "prompt", idleOnly: true,
          preparationId: "literal", clientSubmissionId: fixture.key, message: fixture.message })).toMatchObject({ success: true });
        const result = await terminalSubmission(worker, fixture.key);
        expect(result).toMatchObject({ inputOutcome: fixture.inputOutcome, operationOutcome: fixture.operationOutcome,
          terminal: true, persistence: "committed" });
        if (fixture.key === "handled-with-effect") expect(result.relations).toEqual(expect.arrayContaining([
          expect.objectContaining({ role: "additional", persistence: "committed", entryId: expect.any(String) }),
        ]));
      }
      expect(await worker.request({ type: "submission_submit", ...target, inputType: "steer", idleOnly: true,
        preparationId: "literal", clientSubmissionId: "invalid-idle-mode", message: "must-not-execute" }))
        .toMatchObject({ success: false, code: "SUBMISSION_IDLE_PROMPT_REQUIRED" });
      expect(decodeSubmission(await worker.request({ type: "submission_query", clientSubmissionId: "invalid-idle-mode" })))
        .toMatchObject({ terminal: true, inputOutcome: "no_input", operationOutcome: "failed", persistence: "committed" });
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
    const before = await Bun.file(path.join(home, "submission-provider-effects.json")).json();
    worker = strictWorker(home, cwd, controlledRuntime);
    try {
      await negotiateStrict(worker);
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd }))
        .toMatchObject({ success: true });
      for (const fixture of cases) expect(decodeSubmission(await worker.request({ type: "submission_submit", ...target,
        inputType: "prompt", idleOnly: true, preparationId: "literal", clientSubmissionId: fixture.key, message: fixture.message })))
        .toMatchObject({ duplicate: true, inputOutcome: fixture.inputOutcome, operationOutcome: fixture.operationOutcome,
          terminal: true, persistence: "committed" });
      expect(await Bun.file(path.join(home, "submission-provider-effects.json")).json()).toEqual(before);
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
  } finally { await fs.rm(home, { recursive: true, force: true }); }
}, 45000);
