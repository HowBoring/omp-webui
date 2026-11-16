/** Public RPC plus an awaited extension hook and an owned synthetic namespace replacement. */
import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { nativeFixture, filesystemManifest } from "../catalog/fixture.ts";
import { negotiateStrict, selectedDescriptor, strictWorker, type StrictFrame } from "../continuation/worker.ts";
import { controlledRuntime, decodeSubmission } from "./fixture.ts";

for (const boundary of ["before-first-hook", "after-awaited-hook"] as const) {
  test(`protected submission revalidates its source ${boundary} and leaves unpublishable completion unknown`, async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "submission-queued-source-"));
    try {
      const root = await nativeFixture(home), cwd = path.join(home, "project");
      const target = await selectedDescriptor(home), file = path.join(root, "bucket/native-0000.jsonl");
      const worker = strictWorker(home, cwd, controlledRuntime, undefined, undefined, undefined, undefined, 30000);
      try {
        await negotiateStrict(worker);
        expect(await worker.request({ type: "strict_start", intent: "continue", reference: target.reference, expectedCwd: cwd }))
          .toMatchObject({ success: true });
        const command = { type: "submission_submit", clientSubmissionId: "queued-source-id", preparationId: "literal",
          inputType: "prompt", message: boundary === "before-first-hook" ? "queued-after-reservation" : "hold-submission-ingress",
          sourceId: target.sourceId, instanceId: target.instanceId, nativeSessionId: target.nativeSessionId };
        // The first ordinary prompt holds the real native inputGate; the second
        // input must already be durably reserved before we change its source.
        const blocker = boundary === "before-first-hook"
          ? worker.request({ type: "prompt", message: "hold-queued-ingress" }) : undefined;
        if (blocker) void blocker.catch(() => {});
        let admission: Promise<StrictFrame> | undefined;
        if (boundary === "after-awaited-hook") { admission = worker.request(command); void admission.catch(() => {}); }
        for (let attempt = 0; !await Bun.file(path.join(home, "submission-ingress-held.json")).exists(); attempt++) {
          if (attempt >= 300) throw Error("SUBMISSION_INPUT_HOOK_NOT_REACHED");
          await Bun.sleep(10);
        }
        if (!admission) { admission = worker.request(command); void admission.catch(() => {}); }
        let reservationObserved = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const result = decodeSubmission(await worker.request({ type: "submission_query", clientSubmissionId: command.clientSubmissionId }));
          if (result.reservation === "committed") {
            expect(result).toMatchObject({ found: true, terminal: false, inputOutcome: "unresolved", relations: [] });
            reservationObserved = true; break;
          }
          await Bun.sleep(10);
        }
        expect(reservationObserved).toBe(true);
        expect(await Bun.file(path.join(home, "submission-forbidden-ingress.json")).exists()).toBe(false);
        // Actual namespace/inode change, without parsing or rewriting native history.
        await fs.rename(file, `${file}.held`);
        await fs.copyFile(`${file}.held`, file, fs.constants.COPYFILE_EXCL);
        await Bun.write(path.join(home, "submission-ingress-release"), "release");
        const response = await admission;
        expect(response).toMatchObject({ success: false });
        expect(String(response.code)).toMatch(/^STRICT_|^SUBMISSION_TARGET_CHANGED$/);
        if (blocker) expect(await blocker).toMatchObject({ success: true });
        const beforeQueries = await filesystemManifest(root);
        for (let attempt = 0; attempt < 2; attempt++) {
          expect(decodeSubmission(await worker.request({ type: "submission_query", clientSubmissionId: command.clientSubmissionId })))
            .toMatchObject({ reservation: "unknown", persistence: "unknown", terminal: false, inputOutcome: "unresolved", relations: [] });
        }
        expect(await worker.request(command)).toMatchObject({ success: false });
        expect(await filesystemManifest(root)).toEqual(beforeQueries);
        expect(await Bun.file(path.join(home, "submission-forbidden-ingress.json")).exists()).toBe(false);
        expect(await Bun.file(path.join(home, "submission-provider-effects.json")).exists()).toBe(false);
        expect(await Bun.file(path.join(home, "submission-tool-effects.json")).exists()).toBe(false);
      } finally {
        await Bun.write(path.join(home, "submission-ingress-release"), "cleanup");
        await worker.close().catch(() => {}); worker.child.kill(); await worker.child.exited;
      }
    } finally { await fs.rm(home, { recursive: true, force: true }); }
  }, 45000);
}
