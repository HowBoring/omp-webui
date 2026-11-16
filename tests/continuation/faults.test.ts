import { expect, test } from "bun:test";
import { mkdtemp, rm, copyFile, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeFixture, filesystemManifest } from "../catalog/fixture.ts";
import { strictWorker, selectedDescriptor, isolatedRuntimeArgs, negotiateStrict } from "./worker.ts";

test("real native EMFILE during lease acquisition is unknown and creates no Session or sibling", async () => {
  const home = await mkdtemp(join(tmpdir(), "strict-emfile-"));
  try {
    const root = await nativeFixture(home), file = join(root, "bucket/native-0000.jsonl"), cwd = join(home, "project");
    const selected = await selectedDescriptor(home), before = await filesystemManifest(root);
    const worker = strictWorker(home, cwd, isolatedRuntimeArgs, undefined, { name: "unknown-lease", target: file });
    try {
      await negotiateStrict(worker);
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd }))
        .toMatchObject({ success: false, code: "STRICT_OWNERSHIP_UNKNOWN" });
      expect(await filesystemManifest(root)).toEqual(before);
      expect(await readFile(join(home, "strict-syscalls.log"), "utf8")).toContain("socket-real-emfile");
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
  } finally { await rm(home, { recursive: true, force: true }); }
});

for (const fault of ["swap-first-write", "swap-commit"] as const) test(`${fault} never redirects a native write into its replacement`, async () => {
  const home = await mkdtemp(join(tmpdir(), "strict-swap-"));
  try {
    const root = await nativeFixture(home), file = join(root, "bucket/native-0000.jsonl"), cwd = join(home, "project");
    const selected = await selectedDescriptor(home);
    await copyFile(file, file + ".replacement");
    const replacement = (await readFile(file + ".replacement", "utf8")).replaceAll("native-0000", "replacement-b");
    await Bun.write(file + ".replacement", replacement);
    const worker = strictWorker(home, cwd, isolatedRuntimeArgs, undefined, { name: fault, target: file });
    try {
      await negotiateStrict(worker);
      const opened = await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd });
      if (fault === "swap-first-write") {
        if (opened.success === true) await worker.request({ type: "set_model", provider: "openai", modelId: "gpt-4o-mini" });
        expect(await worker.request({ type: "get_strict_state" })).toMatchObject({ data: { phase: "outcome_unknown" } });
      } else {
        expect(opened).toMatchObject({ success: true });
        expect(await worker.request({ type: "set_session_name", name: "Must not modify replacement" })).toMatchObject({ success: false });
        expect(await worker.request({ type: "get_strict_state" })).toMatchObject({ data: { phase: "outcome_unknown" } });
      }
      expect(await readFile(join(home, "strict-syscalls.log"), "utf8")).toContain(fault);
      expect(await readFile(file, "utf8")).toBe(replacement);
      expect((await readdir(join(root, "bucket"))).filter(name => name.endsWith(".jsonl"))).toEqual(["native-0000.jsonl"]);
    } finally { await worker.close(); worker.child.kill(); await worker.child.exited; }
  } finally { await rm(home, { recursive: true, force: true }); }
}, 20000);

for (const stage of ["crash-prepared-body", "crash-prepared-metadata", "crash-after-conversion", "crash-after-commit"] as const)
  test(`${stage} has an authoritative native result after process loss without replay`, async () => {
    const home = await mkdtemp(join(tmpdir(), "strict-crash-"));
    try {
      const root = await nativeFixture(home), file = join(root, "bucket/native-0000.jsonl"), cwd = join(home, "project");
      const selected = await selectedDescriptor(home), identity = await stat(file, { bigint: true });
      const worker = strictWorker(home, cwd, isolatedRuntimeArgs, undefined, { name: stage, target: file });
      try {
        await negotiateStrict(worker);
        expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd }))
          .toMatchObject({ success: true });
        await expect(worker.request({ type: "set_session_name", name: "Committed after native crash" })).rejects.toThrow("STRICT_FIXTURE_EXIT_91");
        expect(await worker.child.exited).toBe(91);
        expect(await readFile(join(home, "strict-syscalls.log"), "utf8")).toContain(stage);
      } finally { worker.child.kill(); await worker.child.exited; }
      const after = await selectedDescriptor(home), physical = await stat(file, { bigint: true });
      expect([physical.ino, physical.dev, physical.birthtimeNs]).toEqual([identity.ino, identity.dev, identity.birthtimeNs]);
      expect(after.title).toBe(stage === "crash-after-commit" ? "Committed after native crash" : "Native Session 0");
      const reopened = strictWorker(home, cwd, isolatedRuntimeArgs);
      try {
        await negotiateStrict(reopened);
        expect(await reopened.request({ type: "strict_start", intent: "continue", reference: after.reference, expectedCwd: cwd }))
          .toMatchObject({ success: true });
        expect((await reopened.close()).code).toBe(0);
      } finally { reopened.child.kill(); await reopened.child.exited; }
    } finally { await rm(home, { recursive: true, force: true }); }
  }, 20000);

for (const stage of ["short-marker", "short-conversion", "passthrough"] as const)
  test(`${stage} verifies the actual kernel write boundary and retains truthful native outcome`, async () => {
    const home = await mkdtemp(join(tmpdir(), "strict-short-"));
    try {
      const root = await nativeFixture(home), file = join(root, "bucket/native-0000.jsonl"), cwd = join(home, "project");
      const selected = await selectedDescriptor(home), worker = strictWorker(home, cwd, isolatedRuntimeArgs, undefined, { name: stage, target: file });
      try {
        await negotiateStrict(worker);
        expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd })).toMatchObject({ success: true });
        const result = await worker.request({ type: "set_session_name", name: "Kernel boundary title" });
        expect(result.success).toBe(stage === "passthrough");
        const audit = await readFile(join(home, "strict-syscalls.log"), "utf8");
        expect(audit).toContain('"event":"pwrite-target"');
        if (stage !== "passthrough") {
          expect(audit).toContain(`"event":"${stage}"`);
          expect(audit).toContain(`"actual_written":${stage === "short-marker" ? 20 : 3}`);
          expect(await worker.request({ type: "get_strict_state" })).toMatchObject({ data: { phase: "outcome_unknown" } });
        } else expect(await worker.request({ type: "get_state" })).toMatchObject({ data: { sessionName: "Kernel boundary title" } });
      } finally { await worker.close(); worker.child.kill(); await worker.child.exited; }
      if (stage !== "passthrough") {
        const retry = strictWorker(home, cwd, isolatedRuntimeArgs);
        try { await negotiateStrict(retry);
          expect(await retry.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd })).toMatchObject({ success: false });
        } finally { await retry.close(); retry.child.kill(); await retry.child.exited; }
      }
      expect((await readdir(join(root, "bucket"))).filter(name => name.endsWith(".jsonl"))).toEqual(["native-0000.jsonl"]);
    } finally { await rm(home, { recursive: true, force: true }); }
  }, 20_000);
