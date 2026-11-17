/** Explicit SOURCE/BUILD action only. Produces UNSIGNED bytes; never executes output, imports Native, loads FFI or listens. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { probeConfiguration, probeLaunchMembers, probePlatformMembers, readProbePin, sha256 } from "../compatibility/omp/fixtures/native-signed-probe-launch";
import { assertOwnershipFfiDeferred } from "./ownership-import-gate";

const repository = path.resolve(import.meta.dir, ".."), args = process.argv.slice(2);
const configFile = args[0], materialize = args[1] === "--materialize-one-runtime";
if (!configFile || args.length !== (materialize ? 2 : 1)) throw new Error("USAGE <Root-owned-configuration.json> [--materialize-one-runtime]");
const config = probeConfiguration.parse(await Bun.file(configFile).json());
if (!/^\/tmp\/native-signed-probe-[A-Za-z0-9-]+$/.test(config.stage)) throw new Error("PROBE_ISOLATED_STAGE_REQUIRED");
if (config.anchor.path !== `${config.stage}/operator/anchor.json` || config.key.path !== `${config.stage}/operator/key.json`) {
  throw new Error("PROBE_FIXED_OPERATOR_PATHS_REQUIRED");
}
const root = `${config.stage}/launch`, release = `${root}/components`;
const native = path.join(repository, "vendor/omp-ownership/packages/coding-agent/src/launch/ownership");
const publicRoot = "/workspace/work/omp-webui-ticket-41-controlio-public-adapter/vendor/public-adapter-nominal-v1/release";
const pinnedRuntime = "/workspace/work/rpc-public-module-probe/tooling/bun/package/bin/bun";
if (process.execPath !== pinnedRuntime || Bun.version !== "1.4.4"
  || Buffer.byteLength(`${config.stage}/home/state/socket`) >= 108) throw new Error("PROBE_TOOL_OR_ENDPOINT_UNSUPPORTED");
await readProbePin(config.anchor); await readProbePin(config.key);
await fs.mkdir(root, { mode: 0o700 }); // Exclusive fresh attempt; never overwrite an earlier attempt/evidence.
const inputs = new Map<string, string>();
async function pin(file: string): Promise<void> { inputs.set(file, sha256(await fs.readFile(file))); }
async function write(file: string, bytes: string | Uint8Array, mode = 0o600): Promise<void> {
  await fs.writeFile(file, bytes, { mode, flag: "wx" });
}
async function directory(file: string): Promise<void> { await fs.mkdir(file, { mode: 0o700, recursive: true }); }
async function copy(source: string, destination: string): Promise<void> {
  await directory(path.dirname(destination)); await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
  await fs.chmod(destination, 0o600); await pin(source);
}
async function fileApproval(file: string) { return { file, sha256: sha256(await fs.readFile(file)) }; }
async function pinned(file: string) {
  const stat = await fs.lstat(file, { bigint: true });
  return { path: file, device: String(stat.dev), inode: String(stat.ino), sha256: sha256(await fs.readFile(file)) };
}
async function directoryApproval(file: string) {
  const stat = await fs.lstat(file, { bigint: true }); return { path: file, device: String(stat.dev), inode: String(stat.ino) };
}
async function build(entrypoint: string, destination: string, define?: Record<string, string>): Promise<void> {
  const result = await Bun.build({ entrypoints: [entrypoint], target: "bun", format: "esm", packages: "bundle",
    minify: false, metafile: true, ...(define ? { define } : {}) });
  if (!result.success || result.outputs.length !== 1 || !result.outputs[0] || !result.metafile) throw new Error("PROBE_BUILD_FAILED");
  const bytes = await result.outputs[0].text(); assertOwnershipFfiDeferred(bytes); await write(destination, bytes);
  const metadata: unknown = typeof result.metafile === "string" ? JSON.parse(result.metafile) : result.metafile;
  if (typeof metadata !== "object" || metadata === null || !("inputs" in metadata)
    || typeof metadata.inputs !== "object" || metadata.inputs === null) throw new Error("PROBE_BUILD_METADATA");
  for (const name of Object.keys(metadata.inputs)) {
    const source = path.resolve(repository, name); await pin(source);
    // Record the complete compiled source graph; keep it OUTSIDE the executable closure to avoid self-referential inputs.
    const relative = source.startsWith(`${repository}/`) ? path.relative(repository, source)
      : `shared/${source.slice(1)}`;
    await directory(path.dirname(`${config.stage}/source-inputs/${relative}`));
    try { await fs.copyFile(source, `${config.stage}/source-inputs/${relative}`, fs.constants.COPYFILE_EXCL); }
    catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error; }
  }
}
for (const name of ["bin", "runtime", "worker", "components/native", "components/lib", "components/control-io",
  "components/provenance", "components/contracts"]) await directory(`${root}/${name}`);
for (const name of ["home", "home/state", "home/state/fences", "profile", "cwd", "config", "data", "cache", "xdg-state"]) {
  await directory(`${config.stage}/${name}`);
}
await write(`${config.stage}/home/fixture-marker.json`, '{"kind":"native-signed-probe/1","privateData":false}');
const control = `${config.stage}/control`; await write(control, "");
const controlPin = await pinned(control), header = `${config.stage}/control-build.h`;
await write(header, `#define OMP_CONTROL_PATH ${JSON.stringify(control)}\n`
  + `#define OMP_CONTROL_DEVICE UINTMAX_C(${controlPin.device})\n#define OMP_CONTROL_INODE UINTMAX_C(${controlPin.inode})\n`);
const compiler = ["/usr/bin/gcc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2", "-static", "-include", header,
  `${repository}/compatibility/launcher/omp-entry.c`, "-o", `${root}/bin/omp`];
const compiled = Bun.spawnSync(compiler, { env: { PATH: "/usr/bin:/bin", TMPDIR: "/tmp" }, stdout: "pipe", stderr: "pipe" });
if (compiled.exitCode !== 0) throw new Error(`PROBE_C_BUILD_FAILED:${compiled.stderr.toString().slice(0, 4096)}`);
await fs.chmod(`${root}/bin/omp`, 0o700);
await pin(`${repository}/compatibility/launcher/omp-entry.c`); await pin(`${repository}/compatibility/launcher/control.h`);
await pin(await fs.realpath("/usr/bin/gcc"));
await build(`${repository}/compatibility/omp/fixtures/no-provider.ts`, `${root}/runtime/no-provider.js`);
await write(`${root}/runtime/bunfig.toml`, `telemetry = false\npreload = [${JSON.stringify(`${root}/runtime/no-provider.js`)}]\n`);
await build(`${repository}/compatibility/omp/fixtures/native-signed-probe-bootstrap.ts`, `${root}/worker/cli.js`,
  { NATIVE_SIGNED_PROBE_CONFIGURATION: JSON.stringify(config) });
await build(`${repository}/compatibility/omp/fixtures/native-signed-probe.ts`, `${release}/native/probe.js`);
for (const [source, destination] of [["server.ts", "native/dispatcher.ts"], ["uds-client.ts", "native/client.ts"],
  ["wire.schema.json", "contracts/ownership.schema.json"]]) await copy(`${native}/${source}`, `${release}/${destination}`);
const publicMembers = ["control-io/package.json", "control-io/index.js", "lib/libomp-control-io.so",
  "provenance/owned-control-io.c", "provenance/owned-control-io.h", "provenance/control-io/package.json",
  "provenance/build-control-io.ts", "provenance/build-control-io-public.ts", "provenance/control-io-build.json",
  "provenance/control-io-toolchain-package.json", "provenance/control-io-toolchain-bun.lock",
  ...["index", "loader", "socket", "selection", "errors"].flatMap(name =>
    [`control-io/${name}.d.ts`, `provenance/control-io/${name}.ts`])];
for (const name of publicMembers) await copy(`${publicRoot}/${name}`, `${release}/${name}`);
const expectedPublic = { "control-io/index.js": "868251d0086139ca00b3e85fcf8401da2a445f3f4b77b4b5c8d5422946fd9cef",
  "lib/libomp-control-io.so": "d97a49a02167da8ad4d07d7bd0eb3a921e486696041e7d0512bd9d728a7222f2" };
for (const [name, expected] of Object.entries(expectedPublic)) {
  if (sha256(await fs.readFile(`${release}/${name}`)) !== expected) throw new Error("PROBE_PUBLIC_ARTIFACT_CHANGED");
}
const bridge = `${release}/lib/ownership-bridge.so`;
const bridgeCommand = ["/usr/bin/gcc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2", "-shared", "-fPIC",
  `${native}/linux-bridge.c`, "-o", bridge];
const bridgeResult = Bun.spawnSync(bridgeCommand, { env: { PATH: "/usr/bin:/bin", TMPDIR: "/tmp" }, stdout: "pipe", stderr: "pipe" });
if (bridgeResult.exitCode !== 0) throw new Error(`PROBE_BRIDGE_BUILD_FAILED:${bridgeResult.stderr.toString().slice(0, 4096)}`);
await fs.chmod(bridge, 0o600); await pin(`${native}/linux-bridge.c`);
// Required strict roles are real files; the helper role is inert source, expressly NOT an approved executable.
await copy(`${native}/entry.ts`, `${release}/native/unavailable-entry.ts`);
await copy(`${native}/protocol.ts`, `${release}/contracts/protocol.ts`);
if (materialize) {
  // One exact owned runtime only. Never substitute a shell delegate, symlink or hardlink for production C validation.
  const result = Bun.spawnSync(["/bin/cp", "--reflink=always", "--no-clobber", pinnedRuntime, `${root}/runtime/bun`],
    { env: { PATH: "/usr/bin:/bin", TMPDIR: "/tmp" }, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    await fs.rm(`${root}/runtime/bun`, { force: true });
    await fs.copyFile(pinnedRuntime, `${root}/runtime/bun`, fs.constants.COPYFILE_EXCL);
  }
  await fs.chmod(`${root}/runtime/bun`, 0o700); await pin(pinnedRuntime);
  if (sha256(await fs.readFile(`${root}/runtime/bun`)) !== inputs.get(pinnedRuntime)) throw new Error("PROBE_RUNTIME_COPY_CHANGED");
}
const platformDependencies = await probePlatformMembers();
// The INNER ELF graph contains the two actual libraries and libc's interpreter, not the OUTER Bun runtime.
const innerDependencies = platformDependencies.filter(member => member.kind === "link"
  || /\/(?:libc\.so\.6|ld-linux-x86-64\.so\.2)$/.test(member.path));
const manifest = { format: "omp-webui-release-inventory-v1", stage: "unaccepted-artifact", platform: "linux", arch: "x64",
  assets: await probeLaunchMembers(release, "release.json"), platformDependencies: innerDependencies };
await write(`${release}/release.json`, JSON.stringify(manifest, null, 2) + "\n");
const nativeRoles = { dispatcher: await fileApproval(`${release}/native/dispatcher.ts`), client: await fileApproval(`${release}/native/client.ts`),
  bundle: await fileApproval(`${release}/native/probe.js`), schema: await fileApproval(`${release}/contracts/ownership.schema.json`) };
const controlIo = { version: "omp-execution-control-io/1", abi: 1, ...await fileApproval(`${release}/lib/libomp-control-io.so`),
  source: await fileApproval(`${release}/provenance/owned-control-io.c`), header: await fileApproval(`${release}/provenance/owned-control-io.h`),
  inventory: await fileApproval(`${release}/release.json`), package: { entry: await fileApproval(`${release}/control-io/index.js`),
    types: await fileApproval(`${release}/control-io/index.d.ts`), manifest: await fileApproval(`${release}/control-io/package.json`),
    build: await fileApproval(`${release}/provenance/control-io-build.json`) }, native: nativeRoles };
const fullClosure = { format: "omp-native-signed-probe-launch/1", members: await probeLaunchMembers(root), platformDependencies };
await write(`${root}/launch-closure.json`, JSON.stringify(fullClosure, null, 2) + "\n");
const replyKey: unknown = JSON.parse(await readProbePin(config.key));
if (typeof replyKey !== "object" || replyKey === null || !("publicKey" in replyKey) || typeof replyKey.publicKey !== "string") {
  throw new Error("PROBE_REPLY_PUBLIC_KEY_REQUIRED");
}
const payload = { version: "omp-execution-approval/3", policy: "omp-execution-ownership/1", installation: config.installation,
  identity: { closure: sha256(await fs.readFile(`${root}/launch-closure.json`)), schema: nativeRoles.schema.sha256 },
  dispatcherReplyPublicKey: replyKey.publicKey, releaseRoot: release, releaseDirectory: await directoryApproval(release),
  entry: await pinned(`${root}/bin/omp`), control: controlPin, controlIo,
  stateDirectory: await directoryApproval(`${config.stage}/home/state`), fenceDirectory: await directoryApproval(`${config.stage}/home/state/fences`),
  endpoint: `${config.stage}/home/state/socket`, bridge: await fileApproval(bridge),
  helper: await fileApproval(`${release}/native/unavailable-entry.ts`), validator: await fileApproval(`${release}/contracts/protocol.ts`) };
const request = { format: "omp-native-signed-probe-approval-request/1", status: "UNSIGNED_NOT_APPROVED_NOT_READY",
  configuration: config, launchRoot: root, componentsRoot: release, payload: JSON.stringify(payload),
  entry: await pinned(`${root}/bin/omp`), control: controlPin,
  releaseDirectory: await directoryApproval(release), stateDirectory: await directoryApproval(`${config.stage}/home/state`),
  fenceDirectory: await directoryApproval(`${config.stage}/home/state/fences`), endpoint: `${config.stage}/home/state/socket`,
  version: "omp-execution-approval/3", signatureDomain: "omp-execution-release-approval/3\u0000",
  nativeRoles,
  bridge: await fileApproval(bridge), helper: { role: "INERT_SOURCE_NO_EXECUTABLE_AUTHORITY", ...await fileApproval(`${release}/native/unavailable-entry.ts`) },
  validator: { role: "INERT_SOURCE_NOT_FULL_VALIDATOR_PROOF", ...await fileApproval(`${release}/contracts/protocol.ts`) },
  publicArtifacts: expectedPublic, runtimeMaterialized: materialize,
  blockers: ["ROOT_INDEPENDENT_SOURCE_REVIEW", ...(!materialize ? ["ONE_EXACT_CANONICAL_RUNTIME_MATERIALIZATION"] : []),
    "ROOT_INDEPENDENT_EXACT_COMPONENT_AND_LAUNCH_INVENTORY_REVIEW",
    "ROOT_REVIEW_AND_SIGN_FINAL_APPROVAL_BYTES", "ROOT_EXACT_ONE_RUN_AUTHORIZATION"],
  actual: { nativeImported: false, ffiLoaded: false, libraryLoaded: false, socketOpened: false, launcherExecuted: false,
    helperExecuted: false, processLockAcquired: false, privateAdmission: "BLOCKED", globalAdmission: "BLOCKED" } };
await write(`${config.stage}/approval-request.json`, JSON.stringify(request, null, 2) + "\n");
await pin(import.meta.path); await pin(`${repository}/scripts/ownership-import-gate.ts`);
await write(`${config.stage}/source-inputs.json`, JSON.stringify({ inputs: Object.fromEntries(inputs), compiler, bridgeCommand }, null, 2) + "\n");
await write(`${config.stage}/NOT_READY.json`, JSON.stringify({ status: request.status, blockers: request.blockers,
  launchMembersBeforeFinalization: await probeLaunchMembers(root), actual: request.actual }, null, 2) + "\n");
process.stdout.write(JSON.stringify({ stage: config.stage, request: `${config.stage}/approval-request.json`, status: request.status }) + "\n");
