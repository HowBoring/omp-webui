/** Pure tests/types/build/AST only. Never imports a fixture entry, starts the producer/retainer or executes output. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import ts from "typescript";
import { assertOwnershipFfiDeferred } from "./ownership-import-gate";
import { helperDrainAdapter, helperDrainPublicRoot,
  verifyHelperDrainPublicInputs } from "../compatibility/omp/fixtures/native-helper-drain-public";

import { readHelperDrainSourcePlan, helperDrainNativeAlias,
  assertHelperDrainSourceInput } from "../compatibility/omp/fixtures/native-helper-drain-source-plan";

const root = path.resolve(import.meta.dir, "..");
// Explicit pure selection: no build, compiler, subprocess, Native import or emitted fixture execution.
if (process.argv[2] === "--runtime-source-only") {
  const plan = await readHelperDrainSourcePlan(root);
  await verifyHelperDrainPublicInputs();
  const imports: Record<string, string[]> = {};
  for (const name of ["native-helper-drain-launch", "native-helper-drain-runtime", "native-signed-probe-launch"]) {
    const file = `${root}/compatibility/omp/fixtures/${name}.ts`;
    const source = ts.createSourceFile(file, await fs.readFile(file, "utf8"), ts.ScriptTarget.Latest, true);
    const diagnostics: unknown = Reflect.get(source, "parseDiagnostics");
    if (!Array.isArray(diagnostics) || diagnostics.length) throw new Error("DRAIN_SOURCE_SYNTAX");
    const names: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) names.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        throw new Error("DRAIN_PREAUTH_DYNAMIC_IMPORT");
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (names.some(value => /vendor|bun:ffi|native-helper-drain-(?:native|host)|supervision/.test(value))) {
      throw new Error("DRAIN_PREAUTH_IMPORT");
    }
    imports[path.relative(root, file)] = names;
  }
  process.stdout.write(JSON.stringify({ status: "PASS_PURE_SOURCE_ONLY", plannedInputs: Object.keys(plan.inputs).length,
    imports, nativeImported: false, built: false, emittedExecuted: false,
    actualProof: "NOT_RUN", admission: "BLOCKED" }) + "\n");
  process.exit(0);
}
const temporary = await fs.mkdtemp("/tmp/helper-two-process-source-");
const records: { entry: string; bytes: number; sha256: string; eagerFfi: string;
  inputs: Record<string, string> }[] = [];
const commands: { argv: string[]; exitCode: number; stdout: string; stderr: string }[] = [];
try {
  const sourcePlan = await readHelperDrainSourcePlan(root);
  await verifyHelperDrainPublicInputs();
  const fixtures = `${root}/compatibility/omp/fixtures`;
  for (const [entry, host] of [[`${fixtures}/native-helper-drain-bootstrap.ts`, false],
    [`${fixtures}/native-helper-drain-native.ts`, false], [`${fixtures}/native-helper-drain-host.ts`, true],
    [`${root}/scripts/prepare-native-helper-drain.ts`, false]] as const) {
    const result = await Bun.build({ entrypoints: [entry], tsconfig: `${root}/tsconfig.json`,
      target: "bun", format: "esm", packages: "bundle", metafile: true,
      plugins: [helperDrainNativeAlias(root, sourcePlan), ...(host ? [{ name: "source-only-public-control-io",
        setup(build: Parameters<import("bun").BunPlugin["setup"]>[0]) {
        build.onResolve({ filter: /control-io\/index\.ts$/ }, () => ({ path: "/__SOURCE_ONLY__/control-io/index.js", external: true }));
      } }] : [])] });
    if (!result.success || result.outputs.length !== 1 || !result.outputs[0]) throw new Error("DRAIN_SOURCE_BUILD_FAILED");
    const bytes = await result.outputs[0].text();
    if (!host) assertOwnershipFfiDeferred(bytes);
    const metadata: unknown = typeof result.metafile === "string" ? JSON.parse(result.metafile) : result.metafile;
    if (!metadata || typeof metadata !== "object" || !("inputs" in metadata)
      || !metadata.inputs || typeof metadata.inputs !== "object") throw new Error("DRAIN_SOURCE_METADATA");
    const inputs: Record<string, string> = {};
    for (const name of Object.keys(metadata.inputs)) {
      const file = await assertHelperDrainSourceInput(sourcePlan, path.resolve(root, name));
      inputs[path.relative(root, file)] = new Bun.CryptoHasher("sha256").update(await fs.readFile(file)).digest("hex");
    }
    if (host) {
      for (const name of ["coordinator", "resolver", "artifact", "observation", "elf", "platform"]) {
        if (!inputs[`packages/delivery/${name}.ts`]) throw new Error("DRAIN_REVIEWED_HOST_VERIFIER_MISSING");
      }
      if (Object.keys(inputs).some(name => path.resolve(root, name).startsWith(`${helperDrainAdapter}/packages/delivery/`))) {
        throw new Error("DRAIN_LEGACY_HOST_VERIFIER_BUNDLED");
      }
    }
    records.push({ entry: path.relative(root, entry), bytes: Buffer.byteLength(bytes),
      sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
      eagerFfi: host ? "HOST_MAINTENANCE_GRAPH_LOADS_ONLY_AFTER_AUTHENTICATED_BOOTSTRAP" : "ZERO", inputs });
  }
  const files = (await fs.readdir(fixtures)).filter(name => /^native-helper-drain-.*\.ts$/.test(name))
    .map(name => `${fixtures}/${name}`);
  files.push(`${root}/scripts/prepare-native-helper-drain.ts`, import.meta.path,
    `${root}/tests/ownership/native-helper-two-process.test.ts`,
    `${root}/tests/ownership/native-helper-drain-diagnostics.test.ts`,
    `${root}/tests/ownership/native-helper-drain-runtime.test.ts`);
  const config = `${temporary}/tsconfig.json`;
  await fs.writeFile(config, JSON.stringify({ compilerOptions: { target: "ESNext", module: "Preserve", moduleResolution: "Bundler",
    strict: true, noEmit: true, skipLibCheck: true, types: ["bun"], noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true, allowImportingTsExtensions: true,
    typeRoots: [`${root}/node_modules/@types`, `${root}/node_modules`], paths: { "@omp-webui/control-io": [
      `${helperDrainPublicRoot}/control-io/index.d.ts`] } }, files }));
  for (const name of ["home", "profile", "cwd", "config", "data", "state", "cache"]) await fs.mkdir(`${temporary}/${name}`, { mode: 0o700 });
  const env = { HOME: `${temporary}/home`, PI_CODING_AGENT_DIR: `${temporary}/profile`, XDG_CONFIG_HOME: `${temporary}/config`,
    XDG_DATA_HOME: `${temporary}/data`, XDG_STATE_HOME: `${temporary}/state`, XDG_CACHE_HOME: `${temporary}/cache`,
    PATH: "/usr/bin:/bin", TMPDIR: "/tmp" };
  for (const argv of [[process.execPath, "test", "--no-env-file", `--preload=${root}/tests/preferences/no-provider.ts`,
    `${root}/tests/ownership/native-helper-two-process.test.ts`,
    `${root}/tests/ownership/native-helper-drain-diagnostics.test.ts`,
    `${root}/tests/ownership/native-helper-drain-runtime.test.ts`],
    ["/usr/bin/python3", "-B", `${root}/tests/ownership/native_helper_drain_retainer_test.py`],
    [process.execPath, "check", "--no-script", "-p", config]]) {
    const result = Bun.spawnSync(argv, { cwd: `${temporary}/cwd`, env, stdout: "pipe", stderr: "pipe", timeout: 30_000 });
    process.stdout.write(result.stdout); process.stderr.write(result.stderr);
    commands.push({ argv, exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() });
    if (result.exitCode !== 0) throw new Error("DRAIN_SOURCE_CHECK_FAILED");
  }
  await verifyHelperDrainPublicInputs();
  await readHelperDrainSourcePlan(root);
  const record = { sourcePlan, status: "PASS_SOURCE_ONLY", builds: records, commands, emittedExecuted: false,
    producerExecuted: false, retainerExecuted: false, retainerPolicyTested: "PURE_FAKE_OS_BOUNDARIES",
    nativeImported: false, ffiLoaded: false,
    helperStarted: false, socketsOpened: false, signatureKeysUsed: false, actualProof: "NOT_RUN", admission: "BLOCKED" };
  const output = process.argv[2];
  if (output) await fs.writeFile(output, JSON.stringify(record, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ status: record.status, builds: records.map(({ inputs, ...build }) =>
    ({ ...build, sourceInputs: Object.keys(inputs).length })), actualProof: record.actualProof, admission: record.admission }) + "\n");
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
