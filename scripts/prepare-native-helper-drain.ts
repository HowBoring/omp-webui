/** UNSIGNED SOURCE/BUILD producer. Never runs output, imports Native, loads FFI, listens, signs or copies ELF/runtime. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { helperDrainConfiguration,
  helperDrainPlatformMembers } from "../compatibility/omp/fixtures/native-helper-drain-launch";
import { probeLaunchMembers, readProbePin, sha256 } from "../compatibility/omp/fixtures/native-signed-probe-launch";
import { assertOwnershipFfiDeferred } from "./ownership-import-gate";
import { helperDrainAdapter, helperDrainPublicRoot, helperDrainPublicMembers,
  verifyHelperDrainPublicInputs } from "../compatibility/omp/fixtures/native-helper-drain-public";

import { readHelperDrainRuntime } from "../compatibility/omp/fixtures/native-helper-drain-runtime";
import { helperDrainNativeRoot, helperDrainNativeAlias, readHelperDrainSourcePlan,
  assertHelperDrainSourceInput } from "../compatibility/omp/fixtures/native-helper-drain-source-plan";

const repository = path.resolve(import.meta.dir, ".."), args = process.argv.slice(2);
if (args.length !== 1 || !args[0]) throw new Error("USAGE <Root-owned-fresh-public-build-configuration.json>");
const configurationBytes = await fs.readFile(args[0]);
const config = helperDrainConfiguration.parse(JSON.parse(configurationBytes.toString("utf8")));
const root = `${config.stage}/launch`, release = `${root}/components`;
const adapter = helperDrainAdapter, publicRoot = helperDrainPublicRoot;
const native = `${helperDrainNativeRoot}/packages/coding-agent/src/launch/ownership`;
const sourcePlan = await readHelperDrainSourcePlan(repository);
const inputs = new Map<string, string>();
inputs.set(path.resolve(args[0]), sha256(configurationBytes));
async function write(file: string, bytes: string | Uint8Array): Promise<void> {
  await fs.writeFile(file, bytes, { mode: 0o600, flag: "wx" });
}
async function directory(file: string): Promise<void> { await fs.mkdir(file, { mode: 0o700, recursive: true }); }
async function pin(file: string): Promise<void> { inputs.set(file, sha256(await fs.readFile(file))); }
async function copySource(source: string, destination: string): Promise<void> {
  if (source !== `${config.stage}/control-build.h`) await assertHelperDrainSourceInput(sourcePlan, source);
  const bytes = await fs.readFile(source);
  if (bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70]))) throw new Error("DRAIN_ELF_COPY_FORBIDDEN");
  await directory(path.dirname(destination)); await write(destination, bytes); inputs.set(source, sha256(bytes));
}
async function pinned(file: string) {
  const stat = await fs.lstat(file, { bigint: true });
  return { path: file, device: String(stat.dev), inode: String(stat.ino), sha256: sha256(await fs.readFile(file)) };
}
async function directoryPin(file: string) {
  const stat = await fs.lstat(file, { bigint: true });
  return { path: file, device: String(stat.dev), inode: String(stat.ino) };
}
async function approvedFile(file: string) { return { file, sha256: sha256(await fs.readFile(file)) }; }
async function compile(source: string, output: string, extra: string[] = []): Promise<void> {
  try { await fs.lstat(output); throw new Error("DRAIN_BUILD_DESTINATION_EXISTS"); }
  catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error; }
  await assertHelperDrainSourceInput(sourcePlan, source);
  await pin(source);
  const argv = ["/usr/bin/gcc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2", ...extra, source, "-o", output];
  const captureLimitBytes = 1_048_576;
  const result = Bun.spawnSync(argv, { env: { PATH: "/usr/bin:/bin", TMPDIR: "/tmp" },
    stdout: "pipe", stderr: "pipe", maxBuffer: captureLimitBytes });
  if (result.exitCode !== 0 || !result.success) {
    const captured = (bytes: Buffer) => ({ encoding: "base64", data: bytes.toString("base64"),
      bytes: bytes.length, sha256: sha256(bytes) });
    await write(`${output}.build.json`, JSON.stringify({ argv, sourcePath: source, source: inputs.get(source),
      status: "FAILED_NEVER_LOADED_OR_EXECUTED", exitCode: result.exitCode,
      signalCode: result.signalCode ?? null, success: result.success, pid: result.pid,
      resourceUsage: result.resourceUsage, captureLimitBytes,
      exitedDueToTimeout: result.exitedDueToTimeout ?? false,
      exitedDueToMaxBuffer: result.exitedDueToMaxBuffer ?? false,
      stdout: captured(result.stdout), stderr: captured(result.stderr) }, null, 2) + "\n");
    throw new Error("DRAIN_C_BUILD_FAILED");
  }
  await assertHelperDrainSourceInput(sourcePlan, source);
  await pin(source); await pin(await fs.realpath("/usr/bin/gcc"));
  await write(`${output}.build.json`, JSON.stringify({ argv, source: inputs.get(source), diagnostics: result.stderr.toString(),
    status: "COMPILED_NEVER_LOADED_OR_EXECUTED" }, null, 2) + "\n");
}
async function bundle(source: string, output: string, host = false, define?: Record<string, string>): Promise<void> {
  const result = await Bun.build({ entrypoints: [source], tsconfig: `${repository}/tsconfig.json`,
    target: "bun", format: "esm", packages: "bundle", metafile: true,
    ...(define ? { define } : {}), plugins: [helperDrainNativeAlias(repository, sourcePlan), ...(host ? [{
      name: "one-selected-public-control-io", setup(build: Parameters<import("bun").BunPlugin["setup"]>[0]) {
      build.onResolve({ filter: /control-io\/index\.ts$/ }, () => ({ path: `${release}/control-io/index.js`, external: true }));
    } }] : [])] });
  if (!result.success || result.outputs.length !== 1 || !result.outputs[0] || !result.metafile) throw new Error("DRAIN_BUILD_FAILED");
  const bytes = await result.outputs[0].text();
  if (!host) assertOwnershipFfiDeferred(bytes);
  await write(output, bytes);
  const metadata: unknown = typeof result.metafile === "string" ? JSON.parse(result.metafile) : result.metafile;
  if (typeof metadata !== "object" || metadata === null || !("inputs" in metadata)
    || typeof metadata.inputs !== "object" || metadata.inputs === null) throw new Error("DRAIN_BUILD_METADATA");
  for (const name of Object.keys(metadata.inputs)) {
    await pin(await assertHelperDrainSourceInput(sourcePlan, path.resolve(repository, name)));
  }
}

if (Bun.version !== "1.4.4" || process.platform !== "linux" || process.arch !== "x64"
  || config.anchor.path !== `${config.stage}/operator/anchor.json`
  || config.replyKey.path !== `${config.stage}/operator/reply-key.json`
  || Buffer.byteLength(`${config.stage}/home/state/socket`) >= 108) throw new Error("DRAIN_BUILD_CONFIGURATION");
await readProbePin(config.anchor); // Public anchor only. Never open/derive a fingerprint from the private reply key.
await verifyHelperDrainPublicInputs();
// Root must supply ONE canonical runtime and the exact nominal public library before this explicit producer.
// There is deliberately no Bun/Python/compiler/library/ELF copy or fallback/materialize option.
const runtime = config.runtime.kind === "root-platform-runtime/1" ? config.runtime.path : `${root}/runtime/bun`;
if (config.runtime.kind === "root-platform-runtime/1") await readHelperDrainRuntime(config.runtime);
const library = `${release}/lib/libomp-control-io.so`;
for (const file of [runtime, library]) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.nlink !== 1 || await fs.realpath(file) !== file) throw new Error("DRAIN_ROOT_ARTIFACT_REQUIRED");
}
if (sha256(await fs.readFile(library)) !== "d97a49a02167da8ad4d07d7bd0eb3a921e486696041e7d0512bd9d728a7222f2") {
  throw new Error("DRAIN_PUBLIC_LIBRARY_CHANGED");
}
for (const name of ["bin", "runtime", "worker", "components/bin", "components/runtime", "components/worker",
  "components/native", "components/host", "components/client", "components/contracts", "components/provenance"]) await directory(`${root}/${name}`);
for (const name of ["home", "profile", "cwd", "config", "data", "cache", "xdg-state", "home/state/fences", "helper-fences"]) {
  await directory(`${config.stage}/${name}`);
}
const control = `${config.stage}/control`; await write(control, "");
const controlPin = await pinned(control), helperFences = await directoryPin(`${config.stage}/helper-fences`);
// The preserved no-provider preload permits public UDS only below the synthetic HOME.
const endpoint = `${config.stage}/home/state/socket`, helperHeader = `${release}/provenance/private-helper-configuration.h`;
const controlConstants = `#define OMP_CONTROL_PATH ${JSON.stringify(control)}\n`
  + `#define OMP_CONTROL_DEVICE UINTMAX_C(${controlPin.device})\n#define OMP_CONTROL_INODE UINTMAX_C(${controlPin.inode})\n`;
const runtimeConstants = config.runtime.kind === "root-platform-runtime/1"
  ? `#define OMP_TEST_HARNESS_RUNTIME_PATH ${JSON.stringify(runtime)}\n`
    + `#define OMP_TEST_HARNESS_RUNTIME_DEVICE UINTMAX_C(${config.runtime.device})\n`
    + `#define OMP_TEST_HARNESS_RUNTIME_INODE UINTMAX_C(${config.runtime.inode})\n`
    + `#define OMP_TEST_HARNESS_RUNTIME_UID UINTMAX_C(${config.runtime.uid})\n` : "";
await write(`${config.stage}/control-build.h`, controlConstants + runtimeConstants);
await copySource(`${config.stage}/control-build.h`, `${release}/provenance/fixture-launcher-configuration.h`);
await write(helperHeader, `#define OMP_DISPATCHER_PATH ${JSON.stringify(endpoint)}\n`
  + `#define OMP_INSTALLATION_ID ${JSON.stringify(config.installation)}\n`
  + `#define OMP_NATIVE_ENTRY ${JSON.stringify(`${release}/bin/omp`)}\n` + controlConstants
  + `#define OMP_FENCE_PATH ${JSON.stringify(helperFences.path)}\n`
  + `#define OMP_FENCE_DEVICE UINTMAX_C(${helperFences.device})\n#define OMP_FENCE_INODE UINTMAX_C(${helperFences.inode})\n`);
await compile(`${repository}/compatibility/launcher/omp-entry.c`, `${root}/bin/omp`, ["-static", "-include", `${config.stage}/control-build.h`]);
await compile(`${adapter}/compatibility/supervision/private-helper.c`, `${release}/bin/omp-private-helper`, ["-static", "-include", helperHeader]);
await compile(`${adapter}/tests/supervision/fixtures/worker.c`, `${release}/bin/omp`, ["-static"]);
// Host's inspected nominal layout requires these members. This second finite C image is never a selected Bun runtime.
await compile(`${adapter}/tests/supervision/fixtures/worker.c`, `${release}/runtime/bun`, ["-static"]);
await compile(`${native}/linux-bridge.c`, `${release}/lib/ownership-bridge.so`, ["-shared", "-fPIC"]);
for (const file of [`${root}/bin/omp`, `${release}/bin/omp-private-helper`, `${release}/bin/omp`, `${release}/runtime/bun`]) await fs.chmod(file, 0o700);
await bundle(`${repository}/compatibility/omp/fixtures/no-provider.ts`, `${root}/runtime/no-provider.js`);
await write(`${root}/runtime/bunfig.toml`, `telemetry = false\npreload = [${JSON.stringify(`${root}/runtime/no-provider.js`)}]\n`);
await write(`${release}/runtime/bunfig.toml`, "telemetry = false\npreload = []\n");
await write(`${release}/worker/cli.js`, "// Finite C worker fixture: this layout member is never executed.\n");
await bundle(`${repository}/compatibility/omp/fixtures/native-helper-drain-bootstrap.ts`, `${root}/worker/cli.js`, false,
  { HELPER_DRAIN_CONFIGURATION: JSON.stringify(config) });
await bundle(`${repository}/compatibility/omp/fixtures/native-helper-drain-native.ts`, `${release}/native/fixture.js`);
await bundle(`${repository}/compatibility/omp/fixtures/native-helper-drain-host.ts`, `${release}/host/fixture.js`, true);
for (const [source, destination] of [[`${native}/server.ts`, "native/dispatcher.ts"], [`${native}/uds-client.ts`, "client/client.ts"],
  [`${native}/wire.schema.json`, "contracts/ownership.schema.json"], [`${native}/protocol.ts`, "contracts/protocol.ts"],
  [`${adapter}/compatibility/supervision/private-helper.c`, "provenance/private-helper.c"],
  [`${adapter}/compatibility/supervision/candidates.h`, "provenance/candidates.h"],
  [`${adapter}/compatibility/launcher/control.h`, "provenance/control.h"],
  [import.meta.path, "provenance/build-private-helper.ts"]] as const) await copySource(source, `${release}/${destination}`);
for (const name of helperDrainPublicMembers) await copySource(`${publicRoot}/${name}`, `${release}/${name}`);
await verifyHelperDrainPublicInputs();
if (sha256(await fs.readFile(`${release}/control-io/index.js`)) !== "868251d0086139ca00b3e85fcf8401da2a445f3f4b77b4b5c8d5422946fd9cef") {
  throw new Error("DRAIN_PUBLIC_ENTRY_CHANGED");
}
await readHelperDrainSourcePlan(repository);
const platformDependencies = await helperDrainPlatformMembers(config.runtime);
const innerDependencies = platformDependencies.filter(member => member.kind === "link" || /\/(?:libc\.so\.6|ld-linux-x86-64\.so\.2)$/.test(member.path));
await pin(import.meta.path); await pin(`${repository}/compatibility/launcher/control.h`); await pin(process.execPath);
await pin(helperHeader);
await pin(`${repository}/compatibility/omp/fixtures/native-helper-drain-source-plan.json`);
const sourceInputs = JSON.stringify({ status: "SOURCE_BUILD_ONLY_NOT_APPROVAL", inputs: Object.fromEntries(inputs),
  sourcePlan, runtimeVariant: config.runtime,
  rootSuppliedArtifacts: { runtime: await pinned(runtime), publicLibrary: await approvedFile(library) },
  finiteWorker: "C_IDENTITY_ONLY_NO_NATIVE_AGENT_OR_RUNTIME_CLAIM" }, null, 2) + "\n";
// Bind the source/build input record into BOTH final inventories; Root still independently reviews final bytes.
await write(`${release}/provenance/native-helper-drain-source-inputs.json`, sourceInputs);
await write(`${release}/release.json`, JSON.stringify({ format: "omp-webui-release-inventory-v1", stage: "unaccepted-artifact",
  platform: "linux", arch: "x64", assets: await probeLaunchMembers(release, "release.json"), platformDependencies: innerDependencies }, null, 2) + "\n");
await write(`${root}/launch-closure.json`, JSON.stringify({ ...(config.runtime.kind === "root-platform-runtime/1"
    ? { format: "omp-native-helper-drain-launch/2", runtime: config.runtime }
    : { format: "omp-native-helper-drain-launch/1" }),
  members: await probeLaunchMembers(root), platformDependencies }, null, 2) + "\n");
const nativeRoles = { dispatcher: await approvedFile(`${release}/native/dispatcher.ts`), client: await approvedFile(`${release}/client/client.ts`),
  bundle: await approvedFile(`${release}/native/fixture.js`), schema: await approvedFile(`${release}/contracts/ownership.schema.json`) };
const payload = { version: "omp-execution-approval/4", policy: "omp-execution-ownership/1", installation: config.installation,
  identity: { closure: sha256(await fs.readFile(`${root}/launch-closure.json`)), schema: nativeRoles.schema.sha256 },
  dispatcherReplyPublicKey: config.dispatcherReplyPublicKey, releaseRoot: release, releaseDirectory: await directoryPin(release),
  entry: await pinned(`${root}/bin/omp`), control: controlPin, stateDirectory: await directoryPin(`${config.stage}/home/state`),
  fenceDirectory: await directoryPin(`${config.stage}/home/state/fences`), endpoint,
  bridge: await approvedFile(`${release}/lib/ownership-bridge.so`), helper: await approvedFile(`${release}/bin/omp-private-helper`),
  validator: await approvedFile(`${release}/contracts/protocol.ts`),
  helperFence: { policy: "omp-private-helper-fence/1", directory: helperFences, helperSha256: sha256(await fs.readFile(`${release}/bin/omp-private-helper`)) },
  controlIo: { version: "omp-execution-control-io/1", abi: 1, ...await approvedFile(library),
    source: await approvedFile(`${release}/provenance/owned-control-io.c`), header: await approvedFile(`${release}/provenance/owned-control-io.h`),
    inventory: await approvedFile(`${release}/release.json`), package: { entry: await approvedFile(`${release}/control-io/index.js`),
      types: await approvedFile(`${release}/control-io/index.d.ts`), manifest: await approvedFile(`${release}/control-io/package.json`),
      build: await approvedFile(`${release}/provenance/control-io-build.json`) }, native: nativeRoles } };
await write(`${config.stage}/source-inputs.json`, sourceInputs);
await write(`${config.stage}/approval-request.json`, JSON.stringify({ status: "UNSIGNED_NOT_READY_NOT_RUN",
  signatureDomain: "omp-execution-release-approval/4\u0000", payload: JSON.stringify(payload),
  blockers: ["FRESH_PAIRED_SOURCE_REVIEW", "ROOT_EXACT_STAGE_INVENTORY_REVIEW", "ROOT_FINAL_APPROVAL_SIGNATURE",
    "ROOT_ORIGINAL_TWO_PROCESS_RETAINER", "ROOT_ONE_RUNTIME_CLEARANCE"],
  actual: { emittedExecuted: false, ffiLoaded: false, helperStarted: false, productAdmission: "BLOCKED" } }, null, 2) + "\n");
process.stdout.write(JSON.stringify({ status: "UNSIGNED_NOT_READY_NOT_RUN", stage: config.stage,
  dispatcherReplyPublicKeyFingerprint: sha256(Buffer.from(config.dispatcherReplyPublicKey, "base64url")) }) + "\n");
