import { expect, test } from "bun:test";
import { assertHelperDrainExecution, assertHelperDrainRuntimeIdentity,
  helperDrainRuntime } from "../../compatibility/omp/fixtures/native-helper-drain-runtime";

export const runtime = { kind: "root-platform-runtime/1" as const, path:
  "/workspace/work/rpc-public-module-probe/tooling/bun/package/bin/bun",
  device: "1", inode: "2", sha256: "10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235",
  size: 107308936, uid: 1000, mode: 0o755 } as const;
const stat = { device: "1", inode: "2", size: 107308936, uid: 1000, mode: 0o755,
  nlink: 1, regular: true, mtime: "5", ctime: "6" };
const observed = { path: runtime.path, realpath: runtime.path, before: stat,
  after: { ...stat }, sha256: runtime.sha256 };
const stage = "/tmp/native-helper-drain-source-test";
const execution = { execPath: runtime.path, executable: { path: runtime.path, device: "1", inode: "2" },
  uid: 1000, version: "1.4.4", execArgv: ["--no-env-file", `--config=${stage}/launch/runtime/bunfig.toml`],
  argv: [runtime.path, `${stage}/launch/worker/cli.js`, "--omp-maintenance-handoff=1:3", "--fixture-native"] };

test("only the exact pinned Root platform runtime variant can authenticate", () => {
  expect(helperDrainRuntime.parse(runtime)).toEqual(runtime);
  expect(() => assertHelperDrainRuntimeIdentity(runtime, observed)).not.toThrow();
  expect(() => assertHelperDrainExecution(stage, runtime, execution)).not.toThrow();
  for (const invalid of [{ ...runtime, path: "/other/bun" }, { ...runtime, sha256: "a".repeat(64) },
    { ...runtime, kind: "automatic" }, { ...runtime, inode: "18446744073709551616" },
    { ...runtime, mode: 0o777 }, { ...runtime, size: 107308937 },
    { kind: "root-platform-runtime/1" }, undefined]) {
    expect(helperDrainRuntime.safeParse(invalid).success).toBe(false);
  }
});

test("aliases, mutable files, replacement and incomplete runtime observations fail closed", () => {
  for (const change of [{ realpath: "/other/bun" }, { path: "/other/bun" }, { sha256: "b".repeat(64) },
    ...[{ regular: false }, { nlink: 2 }, { mode: 0o777 }, { uid: 0 }, { inode: "9" },
      { size: 107308937 }].map(value => ({ before: { ...stat, ...value } })),
    { after: { ...stat, ctime: "7" } }, { after: { ...stat, device: "9" } }]) {
    expect(() => assertHelperDrainRuntimeIdentity(runtime, { ...observed, ...change }))
      .toThrow("DRAIN_RUNTIME_CHANGED");
  }
  expect(() => assertHelperDrainRuntimeIdentity(runtime, undefined as never)).toThrow();
});

test("other executable, argv, config root, missing guard arguments and handoff injections are rejected", () => {
  for (const change of [{ execPath: "/other/bun" }, { executable: { ...execution.executable, inode: "9" } },
    { executable: { ...execution.executable, path: "/other/bun" } }, { uid: 0 }, { version: "1.4.3" },
    { execArgv: [] }, { execArgv: ["--no-env-file", "--config=/tmp/other/bunfig.toml"] },
    { argv: [runtime.path, "/tmp/other/cli.js", execution.argv[2]!, "--fixture-native"] },
    { argv: [...execution.argv, "--fixture-host"] },
    { argv: [runtime.path, execution.argv[1]!, "--omp-maintenance-handoff=1:9999999999999999", "--fixture-native"] },
    { argv: [runtime.path, execution.argv[1]!, "--omp-maintenance-handoff=1:2", "--fixture-native"] }]) {
    expect(() => assertHelperDrainExecution(stage, runtime, { ...execution, ...change }))
      .toThrow("DRAIN_EXECUTION_CHANGED");
  }
  expect(() => assertHelperDrainExecution("/tmp/other", runtime, execution)).toThrow("DRAIN_EXECUTION_CHANGED");
});


test("the external runtime is independently pinned in the exhaustive signed platform roster", async () => {
  const { assertHelperDrainLaunchRoster } = await import("../../compatibility/omp/fixtures/native-helper-drain-launch");
  const files = [{ path: ".", kind: "directory", identity: "a".repeat(64), mode: 0o700 }];
  const platform = Array.from({ length: 7 }, (_, index) => ({ path: `/platform/${index}`, kind: "file",
    identity: "a".repeat(64), mode: 0o755 }));
  const all = [...platform, { path: runtime.path, kind: "file", identity: runtime.sha256, mode: runtime.mode }];
  const signed = { format: "omp-native-helper-drain-launch/2", runtime, members: files, platformDependencies: all };
  expect(() => assertHelperDrainLaunchRoster(signed, files, all, runtime)).not.toThrow();
  for (const changed of [{ ...signed, platformDependencies: platform },
    { ...signed, runtime: { ...runtime, inode: "9" } },
    { ...signed, platformDependencies: [...all, all[0]] },
    { ...signed, platformDependencies: [...platform, { ...all[7], path: "/other/bun" }] }]) {
    expect(() => assertHelperDrainLaunchRoster(changed, files, all, runtime)).toThrow();
  }
  expect(() => assertHelperDrainLaunchRoster(signed, files, all, { kind: "staged-runtime/1" })).toThrow();
  expect(() => assertHelperDrainLaunchRoster({ format: "omp-native-helper-drain-launch/1",
    members: files, platformDependencies: platform }, files, platform, runtime)).toThrow();
});

test("launch configuration requires an explicit runtime variant and canonical new stage scope", async () => {
  const { helperDrainConfiguration } = await import("../../compatibility/omp/fixtures/native-helper-drain-launch");
  const pin = { path: `${stage}/operator/anchor.json`, device: "1", inode: "3", sha256: "a".repeat(64) };
  const config = { stage, runtime, installation: "a".repeat(64), generation: "b".repeat(64), anchor: pin,
    replyKey: { ...pin, path: `${stage}/operator/reply-key.json` }, dispatcherReplyPublicKey: "A".repeat(43) };
  expect(helperDrainConfiguration.safeParse(config).success).toBe(true);
  expect(helperDrainConfiguration.safeParse({ ...config, runtime: { kind: "staged-runtime/1" } }).success).toBe(true);
  for (const changed of [{ ...config, runtime: undefined }, { ...config, runtime: { ...runtime, path: "/other/bun" } },
    { ...config, stage: "/tmp/other-root" }, { ...config, stage: `${stage}/../native-helper-drain-other` },
    { ...config, runtime: { ...runtime, fallback: true } }]) {
    expect(helperDrainConfiguration.safeParse(changed).success).toBe(false);
  }
});
