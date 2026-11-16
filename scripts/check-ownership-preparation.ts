import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** Source-only checks. Kernel fixture input is deliberately absent; ordinary CLI/Agent is never the test target. */
const argument = process.argv[2];
if (!argument || process.argv.length !== 3) throw new Error("USAGE: check-ownership-preparation.ts <owned-native-source>");
const source = await realpath(resolve(argument)), repository = resolve(import.meta.dir, "..");
const files = ["execution-ownership-cli.test.ts", "execution-ownership-client.test.ts", "execution-ownership-contract.test.ts",
  "execution-ownership-dispatcher.test.ts", "execution-ownership-helper-wire.test.ts", "execution-ownership-linux.test.ts"];
const temporary = await mkdtemp("/tmp/ownership-source-check-");
try {
  for (const name of ["home", "cwd", "profile", "config", "data", "state", "cache"]) {
    await mkdir(join(temporary, name), { mode: 0o700 });
  }
  const tests = files.map(file => join(source, "packages/coding-agent/test", file));
  await writeFile(join(temporary, "cwd/suite.test.ts"), tests.map(file => `import ${JSON.stringify(file)};\n`).join(""));
  const directory = join(source, "packages/coding-agent/src/launch/ownership");
  const modules = (await readdir(directory)).filter(file => file.endsWith(".ts")).map(file => join(directory, file));
  const config = join(temporary, "tsconfig.json");
  await writeFile(config, JSON.stringify({ compilerOptions: { target: "ESNext", module: "Preserve", moduleResolution: "Bundler",
    strict: true, noEmit: true, types: ["bun"], skipLibCheck: true, noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true, allowImportingTsExtensions: true,
    typeRoots: [join(repository, "node_modules/@types"), join(repository, "node_modules")] }, files: [...modules, ...tests] }));
  const env = { HOME: join(temporary, "home"), PI_CODING_AGENT_DIR: join(temporary, "profile"),
    XDG_CONFIG_HOME: join(temporary, "config"), XDG_DATA_HOME: join(temporary, "data"),
    XDG_STATE_HOME: join(temporary, "state"), XDG_CACHE_HOME: join(temporary, "cache"), TMPDIR: "/tmp",
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin` };
  const commands = [
    [process.execPath, "test", "--no-env-file", `--config=${join(repository, "bunfig.toml")}`,
      `--preload=${join(repository, "compatibility/omp/fixtures/no-provider.ts")}`, "./suite.test.ts"],
    [process.execPath, "check", "--no-script", "-p", config],
  ];
  for (const argv of commands) {
    const result = Bun.spawnSync(argv, { cwd: join(temporary, "cwd"), env, stdout: "pipe", stderr: "pipe", timeout: 30_000 });
    process.stdout.write(result.stdout); process.stderr.write(result.stderr);
    if (result.exitCode !== 0) throw new Error("OWNERSHIP_SOURCE_CHECK_FAILED");
  }
  process.stdout.write(JSON.stringify({ scope: "owned-source-only", sourceFiles: files.length, runnerFiles: 1,
    typeCheckedFiles: modules.length + tests.length, guardBeforeImports: true,
    kernelFixtureEnabled: false, actualGlobal: "BLOCKED", capabilityGranted: false }) + "\n");
} finally { await rm(temporary, { recursive: true, force: true }); }
