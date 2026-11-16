/** Public actual rpc-ui worker contract; synthetic home, guarded external provider boundary. */
import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { nativeFixture } from "../catalog/fixture.ts";
import { isolatedRuntimeArgs, negotiateStrict, selectedDescriptor, strictWorker } from "../continuation/worker.ts";

test("reserved empty input survives lost acknowledgement and restart without replay; changed input conflicts", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "submission-reservation-"));
  try {
    await nativeFixture(home);
    const selected = await selectedDescriptor(home), cwd = path.join(home, "project");
    const target = { sourceId: selected.sourceId, instanceId: selected.instanceId, nativeSessionId: selected.nativeSessionId };
    const command = { type: "submission_submit", clientSubmissionId: "synthetic-empty-1", ...target,
      preparationId: "literal-preparation-1", inputType: "prompt", message: "" };
    let worker = strictWorker(home, cwd, isolatedRuntimeArgs);
    try {
      await negotiateStrict(worker);
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd }))
        .toMatchObject({ success: true });
      // Ignore the submit reply; recover only by explicit read-only query.
      worker.send({ ...command, id: "intentionally-lost-ack" });
      const terminal = await worker.wait(frame => frame.type === "response" && frame.id === "intentionally-lost-ack");
      expect(terminal).toMatchObject({ success: true });
      expect(await worker.request({ type: "submission_query", clientSubmissionId: command.clientSubmissionId }))
        .toMatchObject({ success: true, data: { found: true, inputOutcome: "no_input", persistence: "committed", admission: "local" } });
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
    worker = strictWorker(home, cwd, isolatedRuntimeArgs);
    try {
      await negotiateStrict(worker);
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd }))
        .toMatchObject({ success: true });
      expect(await worker.request(command)).toMatchObject({ success: true, data: { duplicate: true, inputOutcome: "no_input", persistence: "committed" } });
      expect(await worker.request({ ...command, message: "different" })).toMatchObject({ success: false, code: "SUBMISSION_CONFLICT" });
      expect(await worker.request({ type: "submission_query", clientSubmissionId: command.clientSubmissionId }))
        .toMatchObject({ success: true, data: { found: true, inputOutcome: "no_input", persistence: "committed", relations: [] } });
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
  } finally { await fs.rm(home, { recursive: true, force: true }); }
}, 30000);
