/** Actual baseline/matched TUI is a required native-data complement to RPC. */
import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { nativeFixture, filesystemManifest } from "../catalog/fixture.ts";
import { isolatedRuntimeArgs, negotiateStrict, selectedDescriptor, strictWorker } from "../continuation/worker.ts";
test("submission metadata preserves native leaf/tree/TUI, and unsupported rollback refuses carrier and logical copies", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "submission-tui-"));
  try {
    const root = await nativeFixture(home), file = path.join(root, "bucket/native-0000.jsonl"), cwd = path.join(home, "project");
    const selected = await selectedDescriptor(home), worker = strictWorker(home, cwd, isolatedRuntimeArgs);
    try {
      await negotiateStrict(worker);
      await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd });
      const before = await worker.request({ type: "get_entries" });
      expect(await worker.request({ type: "submission_submit", inputType: "prompt", message: "", preparationId: "literal-prepared",
        clientSubmissionId: "tui-key", sourceId: selected.sourceId, instanceId: selected.instanceId, nativeSessionId: selected.nativeSessionId }))
        .toMatchObject({ success: true, data: { inputOutcome: "no_input", terminal: true } });
      expect((await worker.request({ type: "get_entries" })).data).toEqual(before.data);
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
    for (const mode of ["baseline", "matched"]) {
      const before = await filesystemManifest(root);
      const child = Bun.spawn([Bun.which("python3") ?? "/usr/bin/python3", path.resolve("tests/continuation/tui-probe.py"), home, file, mode, process.execPath],
        { cwd: path.resolve("."), env: { PATH: "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe" });
      const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (code) throw Error(error);
      expect(JSON.parse(output)).toMatchObject(mode === "baseline" ? { invalidHeader: true } : { historyRendered: true, explicitRename: true });
      if (mode === "baseline") expect(await filesystemManifest(root)).toEqual(before);
    }
    const reopened = strictWorker(home, cwd, isolatedRuntimeArgs);
    try {
      await negotiateStrict(reopened);
      expect(await reopened.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd })).toMatchObject({ success: true });
      expect(await reopened.request({ type: "submission_query", clientSubmissionId: "tui-key" }))
        .toMatchObject({ success: true, data: { terminal: true, inputOutcome: "no_input", persistence: "committed" } });
      expect((await reopened.close()).code).toBe(0);
    } finally { reopened.child.kill(); await reopened.child.exited; }
  } finally { await fs.rm(home, { recursive: true, force: true }); }
}, 60000);
