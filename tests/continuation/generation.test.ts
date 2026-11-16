import { z } from "zod";
import { expect, test } from "bun:test";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeFixture } from "../catalog/fixture.ts";
import { strictWorker, selectedDescriptor, isolatedRuntimeArgs, negotiateStrict } from "./worker.ts";

test("native title publication keeps the selected inode and resolves its complete committed generation", async () => {
  const home = await mkdtemp(join(tmpdir(), "strict-generation-"));
  try {
    const root = await nativeFixture(home), file = join(root, "bucket/native-0000.jsonl");
    const selected = await selectedDescriptor(home), cwd = join(home, "project"), before = await stat(file, { bigint: true });
    const worker = strictWorker(home, cwd, isolatedRuntimeArgs);
    try {
      await negotiateStrict(worker);
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd }))
        .toMatchObject({ success: true });
      expect(await worker.request({ type: "set_session_name", name: "Committed native title" })).toMatchObject({ success: true });
      const after = await stat(file, { bigint: true });
      expect([after.dev, after.ino, after.birthtimeNs]).toEqual([before.dev, before.ino, before.birthtimeNs]);
      expect(await readFile(file, "utf8")).toContain('"type":"ompgen1"');
      expect(await worker.request({ type: "get_state" })).toMatchObject({ success: true,
        data: { sessionId: "native-0000", sessionName: "Committed native title" } });
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
    const refreshed = await selectedDescriptor(home);
    expect(refreshed).toMatchObject({ instanceId: selected.instanceId, nativeSessionId: "native-0000", title: "Committed native title" });
    const reopened = strictWorker(home, cwd, isolatedRuntimeArgs);
    try {
      await negotiateStrict(reopened);
      expect(await reopened.request({ type: "strict_start", intent: "continue", reference: refreshed.reference, expectedCwd: cwd }))
        .toMatchObject({ success: true });
      expect(await reopened.request({ type: "get_state" })).toMatchObject({ data: { sessionName: "Committed native title" } });
      expect((await reopened.close()).code).toBe(0);
    } finally { reopened.child.kill(); await reopened.child.exited; }
  } finally { await rm(home, { recursive: true, force: true }); }
}, 20000);

for (const operation of ["fork", "branch", "new_session"] as const) test(`native explicit ${operation} remains distinct from strict continuation`, async () => {
  const home = await mkdtemp(join(tmpdir(), "strict-native-transition-"));
  try {
    const root = await nativeFixture(home), file = join(root, "bucket/native-0000.jsonl"), cwd = join(home, "project");
    const selected = await selectedDescriptor(home), setup = strictWorker(home, cwd, isolatedRuntimeArgs);
    try {
      await negotiateStrict(setup);
      expect(await setup.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd }))
        .toMatchObject({ success: true });
      expect(await setup.request({ type: "set_session_name", name: "Generation transition origin" })).toMatchObject({ success: true });
      expect((await setup.close()).code).toBe(0);
    } finally { setup.child.kill(); await setup.child.exited; }
    const native = strictWorker(home, cwd, isolatedRuntimeArgs, file);
    try {
      await negotiateStrict(native);
      expect(await native.request({ type: "get_state" })).toMatchObject({ data: { sessionId: "native-0000" } });
      const command = operation === "branch" ? { type: operation, entryId: "entry-0" } : { type: operation };
      expect(await native.request(command)).toMatchObject({ success: true, data: { cancelled: false } });
      const state = await native.request({ type: "get_state" });
      const value = z.object({ sessionId: z.string().uuid(), sessionFile: z.string() }).parse(state.data);
      expect(value.sessionId).not.toBe("native-0000");
      expect(value.sessionFile).not.toBe(file);
      if (operation === "fork") expect(await native.request({ type: "get_entries" })).toMatchObject({ data: {
        entries: expect.arrayContaining([expect.objectContaining({ id: "entry-0" })]),
      } });
      expect((await native.close()).code).toBe(0);
    } finally { native.child.kill(); await native.child.exited; }
  } finally { await rm(home, { recursive: true, force: true }); }
}, 20000);
