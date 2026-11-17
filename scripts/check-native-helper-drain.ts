import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { assertOwnershipFfiDeferred, ownershipClientImports } from "./ownership-import-gate";

/** Source tests, AST rule, exact public declarations and build ONLY. Never executes an emitted Native module. */
const args = process.argv.slice(2);
const option = (name: string) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const source = option("source"), publicPackage = option("public-package"), output = option("output");
if (!source || !publicPackage || !output || args.length !== 3) {
  throw new Error("USAGE --source=<owned Native> --public-package=<immutable nominal control-io> "
    + "--output=<record>");
}
const repository = path.resolve(import.meta.dir, ".."), native = await fs.realpath(source);
const base = path.join(native, "packages/coding-agent"), directory = path.join(base, "src/launch/ownership");
const publicRoot = await fs.realpath(publicPackage);
const expected: Record<string, string> = {
  "index.js": "868251d0086139ca00b3e85fcf8401da2a445f3f4b77b4b5c8d5422946fd9cef",
  "index.d.ts": "382399a7f2031331ab3cd7351d4435d03c22ca13339265c53f0038ede0120d27",
  "loader.d.ts": "4854f57b450fc705d2a2e4cd01a5283279fe59e5e0f10e7797665b67d169dd8b",
  "socket.d.ts": "50d2cf2a4a94cc2f2f6222407f382c4aac592d81c3afbd834b13d1017e0c1506",
  "selection.d.ts": "290111ebaffda7c21e2a381067e2291a0fac42176fce9c07f9dc1643579cd4f8",
  "errors.d.ts": "bd309ebbb659418643ce5c22e8c79e10582262a04cd4eed0bff49febc1e1e413",
  "package.json": "7c8e2f455aaba9912eca09baee3859292ea4eb0609ba322b9a4bd7d2c750bd26",
};
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
async function checkPublic(): Promise<void> {
  for (const [name, identity] of Object.entries(expected)) {
    const file = path.join(publicRoot, name), stat = await fs.lstat(file);
    if (!stat.isFile() || stat.nlink !== 1 || await fs.realpath(file) !== file
      || digest(await fs.readFile(file)) !== identity) throw new Error("IMMUTABLE_PUBLIC_CONTRACT_DRIFT");
  }
}
await checkPublic();
const visited = new Set<string>();
async function visit(file: string): Promise<void> {
  if (visited.has(file)) return; visited.add(file);
  for (const dependency of ownershipClientImports(await fs.readFile(file, "utf8"))) {
    if (dependency.startsWith(".")) {
      await visit(path.resolve(path.dirname(file), dependency.replace(/\.ts$/, "") + ".ts"));
    } else if (!dependency.startsWith("node:")) throw new Error("OWNERSHIP_UNEXPECTED_CLIENT_PACKAGE");
  }
}
for (const name of ["bootstrap", "context", "uds-client", "worker-bootstrap"]) await visit(path.join(directory, name + ".ts"));
const testNames = ["helper-fences", "helper-terminal", "helper-policy", "drain",
  "approval", "maintenance-handoff", "control-selection", "inventory", "control-owner", "dispatcher",
  "authentication", "client", "context", "contract", "helper-wire", "fences", "worker"];
const tests = testNames.map(name => path.join(base, `test/execution-ownership-${name}.test.ts`));
tests.push(path.join(repository, "tests/ownership/import-gate.test.ts"));
const temporary = await fs.mkdtemp("/tmp/native-control-owner-check-");
try {
  for (const name of ["home", "profile", "config", "data", "state", "cache", "cwd"]) {
    await fs.mkdir(path.join(temporary, name), { mode: 0o700 });
  }
  const env = { HOME: path.join(temporary, "home"), PI_CODING_AGENT_DIR: path.join(temporary, "profile"),
    XDG_CONFIG_HOME: path.join(temporary, "config"), XDG_DATA_HOME: path.join(temporary, "data"),
    XDG_STATE_HOME: path.join(temporary, "state"), XDG_CACHE_HOME: path.join(temporary, "cache"), TMPDIR: "/tmp",
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` };
  const modules = (await fs.readdir(directory)).filter(name => name.endsWith(".ts")).map(name => path.join(directory, name));
  const typeTests = (await fs.readdir(path.join(base, "test"))).filter(name => /^execution-ownership-.*\.test\.ts$/.test(name))
    .map(name => path.join(base, "test", name));
  const files = [...modules, ...typeTests, path.join(base, "test/fixtures/ownership-server-runner.ts"),
    path.join(repository, "scripts/check-native-helper-drain.ts"), path.join(repository, "scripts/ownership-import-gate.ts"),
    path.join(repository, "tests/ownership/import-gate.test.ts")];
  const config = path.join(temporary, "tsconfig.json");
  await fs.writeFile(config, JSON.stringify({ compilerOptions: { target: "ESNext", module: "Preserve", moduleResolution: "Bundler",
    strict: true, noEmit: true, types: ["bun"], skipLibCheck: true, noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true, allowImportingTsExtensions: true,
    paths: { "@omp-webui/control-io": [path.join(publicRoot, "index.d.ts")] },
    typeRoots: [path.join(repository, "node_modules/@types"), path.join(repository, "node_modules")] }, files }));
  const suite = path.join(temporary, "cwd/suite.test.ts");
  await fs.writeFile(suite, tests.map(file => `import ${JSON.stringify(file)};\n`).join(""));
  const commands = [
    [process.execPath, "test", "--no-env-file", `--preload=${path.join(repository, "tests/preferences/no-provider.ts")}`, suite],
    [process.execPath, "check", "--no-script", "-p", config],
    ["/usr/bin/gcc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-Wpedantic", "-Wconversion", "-Wshadow", "-Wformat=2",
      "-O2", "-fPIC", "-fstack-protector-strong", "-D_FORTIFY_SOURCE=2", "-shared", "-Wl,-z,relro,-z,now",
      "-Wl,--no-undefined", "-o", path.join(temporary, "bridge.so"), path.join(directory, "linux-bridge.c")],
  ];
  const results = [];
  for (const argv of commands) {
    const result = Bun.spawnSync(argv, { cwd: path.join(temporary, "cwd"), env, stdout: "pipe", stderr: "pipe", timeout: 30_000 });
    const record = { argv, exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
    results.push(record); process.stdout.write(result.stdout); process.stderr.write(result.stderr);
    if (result.exitCode !== 0) {
      await fs.writeFile(output, JSON.stringify({ status: "FAIL", results }, null, 2) + "\n");
      throw new Error("NATIVE_HELPER_DRAIN_SOURCE_CHECK_FAILED");
    }
  }
  const build = await Bun.build({ entrypoints: [path.join(directory, "server.ts")], target: "bun", format: "esm",
    packages: "external", outdir: path.join(temporary, "build") });
  if (!build.success || build.outputs.length !== 1 || !build.outputs[0]) throw new Error("OWNERSHIP_SOURCE_BUILD_FAILED");
  const bundle = await build.outputs[0].text(); assertOwnershipFfiDeferred(bundle);
  await checkPublic();
  const record = { format: "omp-native-helper-drain-source-check-v1", status: "PASS_SOURCE_ONLY", native,
    publicContract: { package: publicRoot, files: expected, runtimeImported: false,
      typeMapping: path.join(publicRoot, "index.d.ts"), resolution: "SIGNED_CANONICAL_PUBLIC_ENTRY_DYNAMIC_IMPORT" },
    workerClientGraph: [...visited].sort().map(file => path.relative(native, file)), typeCheckedFiles: files.length,
    sourceTests: tests.length, testScope: "HELPER_TERMINAL_SOURCE_SUITE", results,
    build: { status: "PASS_BUILD_ONLY", bytes: Buffer.byteLength(bundle),
      sha256: digest(Buffer.from(bundle)), eagerFfiImports: 0, emittedNativeExecuted: false },
    nativeCliExecuted: false, ffiImported: false, librariesLoaded: false, socketsOpened: false,
    kernelLockAcquired: false, productionApprovalCreated: false, currentSourceActualComposition: "NOT_RUN", historicalNoPrepareComposition: "c17750a", actualHelperDrain: "NOT_RUN",
    actualGlobal: "BLOCKED", privateAdmission: "BLOCKED" };
  await fs.writeFile(output, JSON.stringify(record, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ status: record.status, graphModules: visited.size,
    typeCheckedFiles: files.length, bundleBytes: record.build.bytes, actualHelperDrain: "NOT_RUN" }) + "\n");
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
