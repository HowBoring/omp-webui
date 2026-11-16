/** Actual public workers must reject invalid native causal data without repairing it. */
import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { nativeFixture, filesystemManifest } from "../catalog/fixture.ts";
import { controlledRuntime, decodeSubmission } from "./fixture.ts";
import { negotiateStrict, selectedDescriptor, strictWorker } from "../continuation/worker.ts";

for (const damage of ["null-origin", "unknown-role", "orphan"] as const) {
  test(`public strict admission refuses persisted ${damage} causal metadata without changing source`, async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "submission-malformed-"));
    try {
      const root = await nativeFixture(home), cwd = path.join(home, "project"), file = path.join(root, "bucket/native-0000.jsonl");
      const origin = { sourceId: "1".repeat(64), instanceId: "2".repeat(64), nativeSessionId: "native-0000", clientSubmissionId: "orphan" };
      await fs.appendFile(file, JSON.stringify({ type: "custom", customType: "extension.note", id: "invalid-cause",
        parentId: "entry-0", timestamp: "2026-01-01T00:00:00.000Z",
        submission: { origin: damage === "null-origin" ? null : origin, role: damage === "unknown-role" ? "guessed" : "additional" } }) + "\n");
      const selected = await selectedDescriptor(home), before = await filesystemManifest(root);
      const worker = strictWorker(home, cwd, controlledRuntime);
      try {
        await negotiateStrict(worker);
        expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd }))
          .toMatchObject({ success: false });
        expect(await worker.request({ type: "submission_submit", inputType: "prompt", message: "literal", preparationId: "fixed",
          clientSubmissionId: "must-not-run", sourceId: selected.sourceId, instanceId: selected.instanceId, nativeSessionId: selected.nativeSessionId }))
          .toMatchObject({ success: false });
        expect(await filesystemManifest(root)).toEqual(before);
        expect(await Bun.file(path.join(home, "submission-provider-effects.json")).exists()).toBe(false);
      } finally { await worker.close().catch(() => {}); worker.child.kill(); await worker.child.exited; }
    } finally { await fs.rm(home, { recursive: true, force: true }); }
  }, 30000);
}

test("extension state cannot forge reserved native control records or destroy permanent dedup", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "submission-control-namespace-"));
  try {
    await nativeFixture(home);
    const selected = await selectedDescriptor(home), cwd = path.join(home, "project");
    let worker = strictWorker(home, cwd, controlledRuntime);
    const command = { type: "submission_submit", inputType: "prompt", message: "reserved-control", preparationId: "fixed",
      clientSubmissionId: "control-key", sourceId: selected.sourceId, instanceId: selected.instanceId, nativeSessionId: selected.nativeSessionId };
    try {
      await negotiateStrict(worker);
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd }))
        .toMatchObject({ success: true });
      expect(decodeSubmission(await worker.request(command))).toMatchObject({ terminal: true, inputOutcome: "no_input", persistence: "committed" });
      expect(await Bun.file(path.join(home, "submission-control-attempt.json")).json())
        .toEqual({ decision: "NATIVE_CONTROL_NAMESPACE_RESERVED" });
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
    worker = strictWorker(home, cwd, controlledRuntime);
    try {
      await negotiateStrict(worker);
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd }))
        .toMatchObject({ success: true });
      expect(await worker.request(command)).toMatchObject({ success: true, data: { duplicate: true, terminal: true, persistence: "committed" } });
      expect(await Bun.file(path.join(home, "submission-provider-effects.json")).exists()).toBe(false);
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
  } finally { await fs.rm(home, { recursive: true, force: true }); }
}, 45000);
