import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { nativeFixture } from "../catalog/fixture.ts";
import { negotiateStrict, selectedDescriptor, strictWorker } from "../continuation/worker.ts";
const runtime = ["--offline", "--model", "submission-controlled/literal", "--no-lsp", "--no-skills", "--no-rules",
  "--no-spotlight", "--no-judge", "--no-context-files", "--trusted-extension", path.resolve("compatibility/omp/fixtures/submission-provider.ts")];
for (const scenario of ["transform", "handled", "tool"] as const) test(`actual ${scenario} input preserves explicit native origins across restart and duplicate`, async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "submission-causality-"));
  try {
    await nativeFixture(home);
    const descriptor = await selectedDescriptor(home), cwd = path.join(home, "project");
    const command = { type: "submission_submit", inputType: "prompt", clientSubmissionId: `literal-${scenario}`, preparationId: "literal-prepared",
      sourceId: descriptor.sourceId, instanceId: descriptor.instanceId, nativeSessionId: descriptor.nativeSessionId, message: scenario };
    let worker = strictWorker(home, cwd, runtime);
    try {
      await negotiateStrict(worker);
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: descriptor.reference, expectedCwd: cwd })).toMatchObject({ success: true });
      expect(await worker.request({ type: "get_state" })).toMatchObject({ data: { model: { provider: "submission-controlled", id: "literal" } } });
      expect(await worker.request(command)).toMatchObject({ success: true });
      let result;
      for (let attempt = 0; attempt < 200; attempt++) {
        result = await worker.request({ type: "submission_query", clientSubmissionId: command.clientSubmissionId });
        if ((result.data as { terminal?: boolean })?.terminal) break;
        if (attempt === 199) throw Error("submission_completion_timeout");
        await Bun.sleep(25);
      }
      const roles = (result?.data as { relations: { role: string; status: string; persistence: string }[] }).relations
        .filter(relation => relation.status === "observed" && relation.persistence === "committed").map(relation => relation.role);
      expect(roles).toContain("additional");
      if (scenario !== "handled") { expect(roles).toContain("input"); expect(roles).toContain("execution"); }
      expect(result).toMatchObject({ success: true, data: { persistence: "committed", inputOutcome: scenario === "handled" ? "no_input" : "generated" } });
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
    const before = await fs.readFile(path.join(home, "submission-provider-effects.json"), "utf8").catch(() => "absent");
    const toolBefore = await fs.readFile(path.join(home, "submission-tool-effects.json"), "utf8").catch(() => "absent");
    if (scenario === "tool") expect(JSON.parse(toolBefore)).toEqual({executions:1});
    worker = strictWorker(home, cwd, runtime);
    try {
      await negotiateStrict(worker);
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: descriptor.reference, expectedCwd: cwd })).toMatchObject({ success: true });
      expect(await worker.request(command)).toMatchObject({ success: true, data: { duplicate: true, terminal: true, persistence: "committed" } });
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
    expect(await fs.readFile(path.join(home, "submission-provider-effects.json"), "utf8").catch(() => "absent")).toBe(before);
    expect(await fs.readFile(path.join(home, "submission-tool-effects.json"), "utf8").catch(() => "absent")).toBe(toolBefore);
  } finally { await fs.rm(home, { recursive: true, force: true }); }
}, 30000);
