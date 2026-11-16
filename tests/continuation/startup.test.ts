import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strictWorker } from "./worker.ts";

test("strict rpc-ui waits without creating a Session and rejects an invalid native reference", async () => {
  const home = await mkdtemp(join(tmpdir(), "strict-start-")), cwd = join(home, "project");
  await mkdir(cwd);
  const worker = strictWorker(home, cwd);
  try {
    expect(await worker.wait(frame => frame.type === "ready")).toMatchObject({ strictStartup: "strict-start-v1" });
    expect(await readdir(home)).toEqual(["project"]);
    await worker.request({ type: "negotiate_protocol", protocolVersion: 2 });
    expect(await worker.request({ type: "strict_start", intent: "continue", reference: "missing", expectedCwd: cwd }))
      .toMatchObject({ command: "strict_start", success: false, code: "STRICT_INVALID_REFERENCE" });
    expect(await worker.request({ type: "get_strict_state" })).toMatchObject({ success: true,
      data: { phase: "failed", intent: "continue", code: "STRICT_INVALID_REFERENCE" } });
    expect(await readdir(home)).toEqual(["project"]);
    expect(await worker.close()).toEqual({ code: 0, stderr: "" });
  } finally { worker.child.kill(); await worker.child.exited; await rm(home, { recursive: true, force: true }); }
});
