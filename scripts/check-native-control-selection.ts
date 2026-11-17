import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";

/** Build tools plus guarded pure filesystem tests only. Never invokes any Native CLI, server, FFI or OS fixture. */
const args = process.argv.slice(2);
const option = (name: string) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const source = option("source"), contract = option("public-contract"), output = option("output");
if (!source || !contract || !output || args.length !== 3) {
  throw new Error("USAGE --source=<owned Native> --public-contract=<immutable public selection.ts> --output=<record>");
}
const repository = path.resolve(import.meta.dir, ".."), native = await fs.realpath(source);
const base = path.join(native, "packages/coding-agent"), directory = path.join(base, "src/launch/ownership");
const contractBytes = await fs.readFile(contract);
const contractSha256 = createHash("sha256").update(contractBytes).digest("hex");
const parser = new Bun.Transpiler({ loader: "ts", target: "bun" });
async function graph(entrypoints: string[]): Promise<string[]> {
  const visited = new Set<string>();
  const visit = async (location: string): Promise<void> => {
    if (visited.has(location)) return; visited.add(location);
    const imports = parser.scanImports(await fs.readFile(location, "utf8"));
    for (const item of imports) {
      if (item.path === "bun:ffi" || item.path === "@omp-webui/control-io"
        || /\/(server|linux-bridge|linux-system|entry)$/.test(item.path)) throw new Error("PURE_GRAPH_IMPORT_REFUSED");
      if (item.path.startsWith(".")) await visit(path.resolve(path.dirname(location), item.path.replace(/\.ts$/, "") + ".ts"));
    }
  };
  for (const entry of entrypoints) await visit(entry);
  return [...visited].sort();
}
const tests = ["approval", "maintenance-handoff", "control-selection", "inventory"]
  .map(name => path.join(base, `test/execution-ownership-${name}.test.ts`));
const pureGraph = await graph([...tests, path.join(directory, "selected-control-release.ts"),
  path.join(directory, "uds-client.ts"), path.join(directory, "worker-bootstrap.ts")]);
const server = await fs.readFile(path.join(directory, "server.ts"), "utf8");
if (parser.scanImports(server).some(item => /linux-bridge|bun:ffi/.test(item.path))) throw new Error("SERVER_EAGER_FFI_IMPORT");
const bridge = await fs.readFile(path.join(directory, "linux-bridge.ts"), "utf8");
if (!bridge.includes("assertOwnershipControlSelection(selected, approval);")
  || !bridge.includes("selected.assertCurrent();\n\t\tconst library = dlopen(")
  || !bridge.includes("try {\n\t\t\tselected.assertCurrent();\n\t\t\tawait selected.verify();")) {
  throw new Error("BRIDGE_SYNCHRONOUS_GUARD_BARRIER_MISSING");
}
const temporary = await fs.mkdtemp("/tmp/native-control-selection-check-");
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
  const config = path.join(temporary, "tsconfig.json");
  await fs.writeFile(config, JSON.stringify({ compilerOptions: { target: "ESNext", module: "Preserve", moduleResolution: "Bundler",
    strict: true, noEmit: true, types: ["bun"], skipLibCheck: true, noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true, allowImportingTsExtensions: true,
    paths: { "@omp-webui/control-io": [path.resolve(contract)] },
    typeRoots: [path.join(repository, "node_modules/@types"), path.join(repository, "node_modules")] },
    files: [...modules, ...typeTests, path.join(base, "test/fixtures/ownership-server-runner.ts")] }));
  const commands = [
    [process.execPath, "test", "--no-env-file", `--preload=${path.join(repository, "compatibility/omp/fixtures/no-provider.ts")}`, ...tests],
    [process.execPath, path.join(repository, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", config],
    ["/usr/bin/gcc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2", '-DOMP_CONTROL_PATH="/synthetic/control"',
      "-DOMP_CONTROL_DEVICE=27", "-DOMP_CONTROL_INODE=42", "-c", path.join(repository, "compatibility/launcher/omp-entry.c"),
      "-o", path.join(temporary, "entry.o")],
  ];
  const results = commands.map(argv => {
    const result = Bun.spawnSync(argv, { cwd: path.join(temporary, "cwd"), env, stdout: "pipe", stderr: "pipe", timeout: 30_000 });
    process.stdout.write(result.stdout); process.stderr.write(result.stderr);
    return { argv, exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  });
  const passed = results.every(value => value.exitCode === 0);
  const record = { format: "omp-native-control-selection-source-check-v1", status: passed ? "PASS_SOURCE_ONLY" : "FAIL",
    native, publicContract: { path: path.resolve(contract), sha256: contractSha256, runtimeResolution: "BLOCKED_TYPE_MAPPING_ONLY" },
    pureGraph: pureGraph.map(file => path.relative(native, file)), typeCheckedFiles: modules.length + typeTests.length + 1,
    results, nativeCliExecuted: false, ffiImported: false, librariesLoaded: false, socketsOpened: false,
    kernelLockAcquired: false, productionApprovalCreated: false, actualGlobal: "BLOCKED", privateAdmission: "BLOCKED" };
  await fs.writeFile(output, JSON.stringify(record, null, 2) + "\n");
  if (!passed) throw new Error("NATIVE_CONTROL_SELECTION_SOURCE_CHECK_FAILED");
  process.stdout.write(JSON.stringify({ status: record.status, pureModules: pureGraph.length,
    typeCheckedFiles: record.typeCheckedFiles, actualGlobal: "BLOCKED", privateAdmission: "BLOCKED" }) + "\n");
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
