import { expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InspectedSelection } from "../../packages/delivery/coordinator.ts";
import { createHostMonotonicObserver, createHostMonotonicSources } from "../../packages/supervision/host-monotonic.ts";

const linuxTest = test.skipIf(process.platform !== "linux");
const procFdTest = test.skipIf(process.platform !== "linux" || !existsSync("/proc/self/fd"));
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

function controlledObserver(system: Omit<Parameters<typeof createHostMonotonicObserver>[0], "isSupportedRuntime">) {
  return createHostMonotonicObserver({ isSupportedRuntime: () => true, ...system });
}

async function fixture<T>(run: (selection: InspectedSelection) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(await fs.realpath(tmpdir()), "host-monotonic-"));
  try {
    await mkdir(join(root, "lib")); await mkdir(join(root, "provenance"));
    await writeFile(join(root, "lib/libomp-shutdown-clock.so"), "clock bytes");
    await writeFile(join(root, "provenance/shutdown-clock.c"), "clock source");
    const verify = (): Promise<void> => Promise.resolve();
    const release = {
      root, identity: digest("independent manifest"), runtime: join(root, "runtime/bun"),
      target: join(root, "worker/cli.js"), launcher: join(root, "bin/omp"), verify,
      manifest: {
        format: "omp-webui-release-inventory-v1" as const, stage: "unaccepted-artifact" as const,
        platform: process.platform, arch: process.arch,
        assets: [
          { path: "lib/libomp-shutdown-clock.so", kind: "file" as const, identity: digest("clock bytes"), mode: 0o644 },
          { path: "provenance/shutdown-clock.c", kind: "file" as const, identity: digest("clock source"), mode: 0o644 },
        ],
        platformDependencies: [{ path: "/lib/libc.so.6", kind: "file" as const, identity: digest("libc"), mode: 0o755 }],
      },
    };
    return await run({ selected: { entry: release.launcher, release, sessionAdmission: "blocked", verify },
      sessionAdmission: "blocked", verify, release: () => { throw new Error("borrower released selection"); } });
  } finally { await rm(root, { recursive: true, force: true }); }
}

const approval = { abi: 1 as const, binaryDigest: digest("clock bytes"), sourceDigest: digest("clock source") };

procFdTest("observes one full-width Host monotonic value through the independently approved descriptor", async () => {
  await fixture(async selection => {
    const calls: string[] = [];
    let libraryPath = "";
    const observe = controlledObserver({
      namespace: () => "12:34",
      async openNative(path: string) {
        libraryPath = path;
        expect(path).toMatch(/^\/proc\/self\/fd\/\d+$/);
        expect(await readFile(path, "utf8")).toBe("clock bytes");
        return {
          abi: () => 1,
          milliseconds: () => { calls.push("sample"); return 9_007_199_254_740_993n; },
          close: () => { calls.push("unload"); },
        };
      },
    });
    expect(await observe({ selection, approval })).toBe(9_007_199_254_740_993n);
    expect(calls).toEqual(["sample", "unload"]);
    await expect(readFile(libraryPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

procFdTest("the retained source reserves the approved clock across synchronous reads until disposal", async () => {
  await fixture(async selection => {
    let namespace = "12:34";
    let libraryPath = "";
    const calls: string[] = [];
    const sources = createHostMonotonicSources({
      isSupportedRuntime: () => true,
      namespace: () => namespace,
      async openNative(path) {
        libraryPath = path;
        return { abi: () => 1,
          milliseconds: () => { calls.push("sample"); return 9_007_199_254_740_993n; },
          close: () => { calls.push("unload"); },
        };
      },
    });
    const input = { selection, approval };
    const clock = await sources.retain(input);
    try {
      expect(calls).toEqual([]);
      expect(await readFile(libraryPath, "utf8")).toBe("clock bytes");
      await expect(sources.observe(input)).rejects.toMatchObject({ code: "HOST_MONOTONIC_BUSY" });
      expect(clock.read()).toBe(9_007_199_254_740_993n);
      namespace = "12:35";
      expect(() => clock.read()).toThrow("HOST_MONOTONIC_UNAVAILABLE");
      expect(calls).toEqual(["sample"]);
    } finally { await clock.close(); }
    expect(() => clock.read()).toThrow("HOST_MONOTONIC_CLOSED");
    expect(calls).toEqual(["sample", "unload"]);
    await expect(readFile(libraryPath)).rejects.toMatchObject({ code: "ENOENT" });
    namespace = "12:34";
    expect(await sources.observe(input)).toBe(9_007_199_254_740_993n);
  });
});

linuxTest("does not call a mapped clock after the borrowed selection is invalidated", async () => {
  await fixture(async selection => {
    let active = true;
    selection.verify = async () => { if (!active) throw new Error("released"); };
    const calls: string[] = [];
    const observe = controlledObserver({
      namespace: () => "12:34",
      async openNative() {
        active = false;
        return {
          abi: () => { calls.push("abi"); return 1; },
          milliseconds: () => { calls.push("sample"); return 0n; },
          close: () => { calls.push("unload"); },
        };
      },
    });
    await expect(observe({ selection, approval })).rejects.toMatchObject({ code: "HOST_MONOTONIC_SELECTION_CHANGED" });
    expect(calls).toEqual(["unload"]);
  });
});

const library = { abi: () => 1, milliseconds: () => 0n, close: () => {} };

linuxTest("requires independent approval and matching regular-file provenance before opening the binary", async () => {
  await fixture(async selection => {
    let loads = 0;
    const observe = controlledObserver({
      namespace: () => "12:34", async openNative() { loads++; return library; },
    });
    const badApproval = { ...approval, binaryDigest: digest("an unapproved binary") };
    await expect(observe({ selection, approval: badApproval })).rejects
      .toMatchObject({ code: "HOST_MONOTONIC_UNAPPROVED" });

    const source = join(selection.selected.release.root, "provenance/shutdown-clock.c");
    await writeFile(source, "unapproved source");
    await expect(observe({ selection, approval })).rejects.toMatchObject({ code: "HOST_MONOTONIC_UNAPPROVED" });
    const alias = `${source}.original`;
    await rename(source, alias); await writeFile(alias, "clock source"); await symlink(alias, source);
    await expect(observe({ selection, approval })).rejects.toMatchObject({ code: "HOST_MONOTONIC_UNAPPROVED" });
    expect(loads).toBe(0);
  });
});

procFdTest("refuses pathname replacement after mapping even while the original approved descriptor is open", async () => {
  await fixture(async selection => {
    const binary = join(selection.selected.release.root, "lib/libomp-shutdown-clock.so");
    const calls: string[] = [];
    const observe = controlledObserver({
      namespace: () => "12:34",
      async openNative(path) {
        await rename(binary, `${binary}.original`);
        await writeFile(binary, "clock bytes");
        expect(await readFile(path, "utf8")).toBe("clock bytes");
        return { ...library, milliseconds: () => { calls.push("sample"); return 0n; },
          close: () => { calls.push("unload"); } };
      },
    });
    await expect(observe({ selection, approval })).rejects.toMatchObject({ code: "HOST_MONOTONIC_UNAPPROVED" });
    expect(calls).toEqual(["unload"]);
  });
});

linuxTest("refuses missing, different and changed Host time namespace proof", async () => {
  await fixture(async selection => {
    const calls: string[] = [];
    let own: string | undefined;
    let children = "12:35";
    const observe = controlledObserver({
      namespace(name) {
        if (name === "time_for_children") return children;
        if (!own) throw new Error("namespace path unavailable");
        return own;
      },
      async openNative() {
        calls.push("open");
        return { ...library, milliseconds() { own = children = "12:36"; return 1n; },
          close: () => { calls.push("unload"); } };
      },
    });
    await expect(observe({ selection, approval })).rejects.toMatchObject({ code: "HOST_MONOTONIC_UNAVAILABLE" });
    own = "12:34";
    await expect(observe({ selection, approval })).rejects.toMatchObject({ code: "HOST_MONOTONIC_UNAVAILABLE" });
    expect(calls).toEqual([]);
    children = own;
    await expect(observe({ selection, approval })).rejects.toMatchObject({ code: "HOST_MONOTONIC_UNAVAILABLE" });
    expect(calls).toEqual(["open", "unload"]);
  });
});

linuxTest("refuses a mismatched ABI, the reserved failure value, and out-of-width samples", async () => {
  await fixture(async selection => {
    let abi = 2;
    let samples = 0;
    let value = 0n;
    const observe = controlledObserver({
      namespace: () => "12:34",
      async openNative() {
        return { ...library, abi: () => abi, milliseconds: () => { samples++; return value; } };
      },
    });
    await expect(observe({ selection, approval })).rejects.toMatchObject({ code: "HOST_MONOTONIC_ABI" });
    expect(samples).toBe(0);
    abi = 1;
    for (const invalid of [-1n, 18_446_744_073_709_551_615n, 18_446_744_073_709_551_616n]) {
      value = invalid;
      await expect(observe({ selection, approval })).rejects.toMatchObject({ code: "HOST_MONOTONIC_UNAVAILABLE" });
    }
    value = 0n;
    expect(await observe({ selection, approval })).toBe(0n);
    value = 18_446_744_073_709_551_614n;
    expect(await observe({ selection, approval })).toBe(value);
  });
});

procFdTest("reserves loading and keeps the original descriptor through uncertain native unload", async () => {
  await fixture(async selection => {
    const entered = Promise.withResolvers<string>();
    const finish = Promise.withResolvers<void>();
    let unloads = 0;
    const observe = controlledObserver({
      namespace: () => "12:34",
      async openNative(path) {
        entered.resolve(path);
        await finish.promise;
        return { ...library, close() { unloads++; throw new Error("no unload receipt"); } };
      },
    });
    const files: fs.FileHandle[] = [];
    const originalOpen = fs.open;
    const root = selection.selected.release.root;
    const mock = spyOn(fs, "open").mockImplementation(async (path, flags, mode) => {
      const file = await originalOpen(path, flags, mode);
      if (typeof path === "string" && path.startsWith(`${root}/`)) files.push(file);
      return file;
    });
    const pending = observe({ selection, approval });
    try {
      const path = await Promise.race([entered.promise, pending]);
      await expect(observe({ selection, approval })).rejects.toMatchObject({ code: "HOST_MONOTONIC_BUSY" });
      finish.resolve();
      await expect(pending).rejects.toMatchObject({ code: "HOST_MONOTONIC_DISPOSAL_UNCERTAIN" });
      if (typeof path !== "string") throw new Error("observer returned without opening the controlled library");
      expect(await readFile(path, "utf8")).toBe("clock bytes");
      await expect(observe({ selection, approval })).rejects.toMatchObject({ code: "HOST_MONOTONIC_BUSY" });
      expect(unloads).toBe(1);
    } finally {
      finish.resolve();
      await pending.catch(() => undefined);
      mock.mockRestore();
      // Controlled unload never mapped code, so the fixture can drain its parked descriptors.
      await Promise.all(files.map(file => file.close()));
    }
  });
});

test("rejects an unsupported runtime before verifying selection, pinning or loading", async () => {
  await fixture(async selection => {
    const calls: string[] = [];
    selection.verify = async () => { calls.push("selection"); };
    const observe = createHostMonotonicObserver({
      isSupportedRuntime() { calls.push("runtime"); return false; },
      namespace() { calls.push("namespace"); return "12:34"; },
      async openNative() { calls.push("native"); return library; },
    });
    const open = spyOn(fs, "open");
    try {
      await expect(observe({ selection, approval })).rejects.toMatchObject({ code: "HOST_MONOTONIC_UNSUPPORTED" });
      expect(calls).toEqual(["runtime"]);
      expect(open).not.toHaveBeenCalled();
    } finally { open.mockRestore(); }
  });
});

linuxTest("parks an unverified newly opened pin when its first close is uncertain", async () => {
  await fixture(async selection => {
    const binary = join(selection.selected.release.root, "lib/libomp-shutdown-clock.so");
    let closes = 0;
    let loads = 0;
    const cleanup: Array<() => Promise<void>> = [];
    const originalOpen = fs.open;
    const mock = spyOn(fs, "open").mockImplementation(async (path, flags, mode) => {
      const file = await originalOpen(path, flags, mode);
      if (path === binary) {
        const close = spyOn(file, "close").mockImplementation(async () => {
          closes++;
          throw new Error("controlled descriptor close uncertainty");
        });
        cleanup.push(() => { close.mockRestore(); return file.close(); });
        await rename(binary, `${binary}.original`);
        await writeFile(binary, "clock bytes");
      }
      return file;
    });
    const observe = controlledObserver({
      namespace: () => "12:34", async openNative() { loads++; return library; },
    });
    try {
      await expect(observe({ selection, approval })).rejects
        .toMatchObject({ code: "HOST_MONOTONIC_DISPOSAL_UNCERTAIN" });
      await expect(observe({ selection, approval })).rejects.toMatchObject({ code: "HOST_MONOTONIC_BUSY" });
      expect(closes).toBe(1);
      expect(loads).toBe(0);
    } finally {
      mock.mockRestore();
      await Promise.all(cleanup.map(close => close()));
    }
  });
});
