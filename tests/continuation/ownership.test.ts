import { expect, test } from "bun:test";
import { mkdtemp, rm, copyFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeFixture, filesystemManifest } from "../catalog/fixture.ts";
import { strictWorker, selectedDescriptor, isolatedRuntimeArgs, negotiateStrict } from "./worker.ts";

for (const change of ["missing", "replaced"] as const) test(`${change} native instance cannot become empty or a sibling`, async () => {
  const home = await mkdtemp(join(tmpdir(), "strict-target-"));
  try {
    const root = await nativeFixture(home), selected = await selectedDescriptor(home), cwd = join(home, "project");
    const file = join(root, "bucket/native-0000.jsonl");
    if (change === "missing") await rm(file);
    else { await copyFile(file, join(home, "copy.jsonl")); await rename(join(home, "copy.jsonl"), file); }
    const before = await filesystemManifest(root), worker = strictWorker(home, cwd);
    try {
      await negotiateStrict(worker);
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd }))
        .toMatchObject({ success: false, code: change === "missing" ? "STRICT_MISSING" : "STRICT_REPLACED" });
      expect(await filesystemManifest(root)).toEqual(before);
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("two genuine rpc-ui processes race for one native lease and only its owner continues", async () => {
  const home = await mkdtemp(join(tmpdir(), "strict-contention-"));
  try {
    const root = await nativeFixture(home), selected = await selectedDescriptor(home), cwd = join(home, "project");
    const first = strictWorker(home, cwd, isolatedRuntimeArgs), second = strictWorker(home, cwd, isolatedRuntimeArgs);
    try {
      await Promise.all([negotiateStrict(first), negotiateStrict(second)]);
      const command = { type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd };
      const outcomes = await Promise.all([first.request(command), second.request(command)]);
      expect(outcomes.map(frame => frame.success).sort()).toEqual([false, true]);
      expect(outcomes.find(frame => frame.success === false)).toMatchObject({ code: "STRICT_OCCUPIED" });
      const winner = outcomes[0]!.success ? first : second, loser = winner === first ? second : first;
      expect(await winner.request({ type: "get_strict_state" })).toMatchObject({ success: true,
        data: { phase: "open", nativeSessionId: "native-0000", binding: { instanceId: selected.instanceId } } });
      expect(await loser.request({ type: "get_strict_state" })).toMatchObject({ success: true,
        data: { phase: "failed", code: "STRICT_OCCUPIED" } });
      const files = Object.keys(await filesystemManifest(root)).filter(name => name.endsWith(".jsonl"));
      expect(files).toEqual(["bucket/native-0000.jsonl"]);
      expect((await winner.close()).code).toBe(0); expect((await loser.close()).code).toBe(0);
      const reopened = strictWorker(home, cwd, isolatedRuntimeArgs);
      try {
        await negotiateStrict(reopened);
        expect(await reopened.request(command)).toMatchObject({ success: true, data: { nativeSessionId: "native-0000" } });
        expect((await reopened.close()).code).toBe(0);
      } finally { reopened.child.kill(); await reopened.child.exited; }
    } finally { first.child.kill(); second.child.kill(); await Promise.all([first.child.exited, second.child.exited]); }
  } finally { await rm(home, { recursive: true, force: true }); }
}, 20000);

test("cancellation before ownership cannot create native effects or replay the open", async () => {
  const home = await mkdtemp(join(tmpdir(), "strict-cancel-"));
  try {
    const root = await nativeFixture(home), selected = await selectedDescriptor(home), cwd = join(home, "project");
    const before = await filesystemManifest(root), worker = strictWorker(home, cwd, isolatedRuntimeArgs);
    try {
      await negotiateStrict(worker);
      worker.send({ id: "pending", type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd });
      expect(await worker.request({ type: "cancel_strict_start" })).toMatchObject({ success: true, data: { phase: "cancelled" } });
      expect(await worker.wait(frame => frame.id === "pending")).toMatchObject({ success: false, code: "STRICT_CANCELLED" });
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd }))
        .toMatchObject({ success: false, code: "STRICT_START_ALREADY_ATTEMPTED" });
      expect(await worker.request({ type: "get_strict_state" })).toMatchObject({ data: { phase: "cancelled" } });
      expect(await filesystemManifest(root)).toEqual(before);
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
  } finally { await rm(home, { recursive: true, force: true }); }
});
