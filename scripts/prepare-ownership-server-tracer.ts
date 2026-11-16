import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Explicit synthetic operator fixture preparation only. Never imports Native, loads FFI, listens, probes or installs. */
const buildPath = process.argv[2];
if (!buildPath || process.argv.length !== 3) throw new Error("USAGE: prepare-ownership-server-tracer.ts <owned-bridge-build.json>");
const repository = path.resolve(import.meta.dir, ".."), source = path.join(repository, "vendor/omp-ownership");
const hash = (bytes: Uint8Array | string): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("TRACER_INVALID_BUILD");
  return value as Record<string, unknown>;
}
const build = object(await Bun.file(buildPath).json()), artifact = object(build.artifact);
if (build.format !== "omp-execution-ownership-bridge-preparation-v1" || build.libraryLoaded !== false
  || typeof artifact.file !== "string" || typeof artifact.sha256 !== "string"
  || !artifact.file.startsWith(path.join(repository, "vendor/ownership-bridge-preparation/"))) throw new Error("TRACER_OWNED_BUILD_REQUIRED");
const bridgeSource = path.join(source, "packages/coding-agent/src/launch/ownership/linux-bridge.c");
if (hash(await fs.readFile(bridgeSource)) !== build.sourceSha256) throw new Error("TRACER_BRIDGE_SOURCE_CHANGED");
const library = await fs.readFile(artifact.file);
if (hash(library) !== artifact.sha256) throw new Error("TRACER_BRIDGE_ARTIFACT_CHANGED");
const modules = path.join(source, "packages/coding-agent/src/launch/ownership");
const inputs = [...(await fs.readdir(modules)).filter(file => /\.(?:ts|c|json)$/.test(file)).map(file => path.join(modules, file)),
  path.join(repository, "compatibility/omp/fixtures/ownership-server-public-uds.test.ts"),
  path.join(repository, "compatibility/omp/fixtures/ownership-transport-drop.test.ts"),
  path.join(source, "packages/coding-agent/test/fixtures/ownership-server-runner.ts"), path.join(repository, "bunfig.toml"),
  path.join(repository, "compatibility/omp/fixtures/no-provider.ts"), path.resolve(buildPath), artifact.file, process.execPath,
  path.join(repository, "scripts/prepare-ownership-server-tracer.ts"),
  path.join(repository, "scripts/retain-ownership-server-tracer.py"),
  await fs.realpath("/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3"),
  await fs.realpath("/usr/bin/strace")];
const identities = await Promise.all(inputs.sort().map(async file => ({ file, sha256: hash(await fs.readFile(file)) })));
const root = await fs.mkdtemp("/tmp/ownership-server-tracer-"); await fs.chmod(root, 0o700);
for (const name of ["operator", "release", "home", "home/state", "home/state/fences", "profile", "cwd", "config", "data", "cache", "xdg-state"]) {
  await fs.mkdir(path.join(root, name), { mode: 0o700 });
}
const marker = path.join(root, "home/fixture-marker.json");
const markerBytes = JSON.stringify({ kind: "ownership-server-synthetic-home/1", privateData: false });
await fs.writeFile(marker, markerBytes, { mode: 0o600, flag: "wx" });
identities.push({ file: marker, sha256: hash(markerBytes) });
const entry = path.join(root, "cwd/server.test.ts");
const entryBytes = `import ${JSON.stringify(path.join(repository, "compatibility/omp/fixtures/ownership-server-public-uds.test.ts"))};\n`;
await fs.writeFile(entry, entryBytes, { mode: 0o600, flag: "wx" });
identities.push({ file: entry, sha256: hash(entryBytes) });
const bridge = path.join(root, "release/bridge.so"); await fs.writeFile(bridge, library, { mode: 0o600, flag: "wx" });
const state = path.join(root, "home/state"), fences = path.join(state, "fences");
const stateStat = await fs.stat(state, { bigint: true }), fenceStat = await fs.stat(fences, { bigint: true });
const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey)).toString("base64url");
const privateKey = Buffer.from(await crypto.subtle.exportKey("pkcs8", keys.privateKey)).toString("base64url");
const installation = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
const releaseRoot = path.join(root, "release"), releaseStat = await fs.stat(releaseRoot, { bigint: true });
const approvalKeys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
const approvalPublicKey = Buffer.from(await crypto.subtle.exportKey("raw", approvalKeys.publicKey)).toString("base64url");
async function writeAndPin(file: string, bytes: string) {
  await fs.writeFile(file, bytes, { mode: 0o600, flag: "wx" }); const stat = await fs.stat(file, { bigint: true });
  return { path: file, device: String(stat.dev), inode: String(stat.ino), sha256: hash(bytes) };
}
// Identity-only placeholders: these are never a real global entry/control or production capability.
async function syntheticPin(name: string) {
  const file = path.join(root, name), bytes = `synthetic-ownership-${name}/1`;
  const pin = await writeAndPin(file, bytes);
  identities.push({ file, sha256: pin.sha256 });
  return pin;
}
const entryPin = await syntheticPin("entry-marker"), controlPin = await syntheticPin("control-marker");
const approval = { version: "omp-execution-approval/2", policy: "omp-execution-ownership/1", installation,
  identity: { closure: hash(JSON.stringify(identities)), schema: hash(await fs.readFile(path.join(modules, "wire.schema.json"))) },
  dispatcherReplyPublicKey: publicKey, releaseRoot,
  releaseDirectory: { path: releaseRoot, device: String(releaseStat.dev), inode: String(releaseStat.ino) },
  entry: entryPin, control: controlPin,
  controlIo: { file: path.join(releaseRoot, "no-control-io-authorized"), sha256: "0".repeat(64) },
  validator: { file: path.join(releaseRoot, "no-validator-authorized"), sha256: "0".repeat(64) }, endpoint: path.join(state, "socket"),
  stateDirectory: { path: state, device: String(stateStat.dev), inode: String(stateStat.ino) },
  fenceDirectory: { path: fences, device: String(fenceStat.dev), inode: String(fenceStat.ino) },
  bridge: { file: bridge, sha256: artifact.sha256 },
  // This first identity tracer deliberately authorizes no real helper executable or Native process.
  helper: { file: path.join(root, "release/no-helper-authorized"), sha256: "0".repeat(64) } };
async function pinned(name: string, value: unknown) {
  return writeAndPin(path.join(root, "operator", name), JSON.stringify(value));
}
const payload = JSON.stringify(approval);
const signature = Buffer.from(await crypto.subtle.sign("Ed25519", approvalKeys.privateKey,
  new TextEncoder().encode("omp-execution-release-approval/2\0" + payload))).toString("base64url");
const recordPin = await pinned("approval.json", { version: "omp-execution-signed-approval/1", payload, signature });
const operator = path.join(root, "operator"), operatorStat = await fs.stat(operator, { bigint: true });
const anchorPin = await pinned("anchor.json", { version: "omp-execution-approval-anchor/1", installation,
  approvalPublicKey, approvalRecord: { path: recordPin.path,
    parent: { path: operator, device: String(operatorStat.dev), inode: String(operatorStat.ino) } },
  approvalVersion: "omp-execution-approval/2", recordBytes: 16384 });
const keyPin = await pinned("key.json", { version: "omp-execution-signing-key/1", installation, publicKey, privateKey });
const fixture = { format: "omp-execution-server-tracer/1", scope: "synthetic-operator-public-uds-kernel-peer-signature-only",
  // Retained fixture field name: approval pins the stable anchor; approvalRecord pins the signed release record.
  approval: anchorPin, approvalRecord: recordPin, key: keyPin, sourceInputs: identities,
  syntheticHome: path.join(root, "home"), marker: { file: marker, sha256: hash(markerBytes) },
  guard: path.join(repository, "compatibility/omp/fixtures/no-provider.ts"), bunConfig: path.join(repository, "bunfig.toml"),
  retainingParent: path.join(repository, "scripts/retain-ownership-server-tracer.py"),
  retainingInterpreter: "/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3",
  retentionPolicy: "sole-P_ALL-waiter-with-held-root-pidfd-no-signals-retain-until-ECHILD",
  createdSyntheticKeys: true, distinctApprovalAndReplyKeys: true, autoEnrolledClientTrust: false, ffiLoaded: false, endpointOpened: false,
  nativeExecuted: false, helperAuthorized: false, maintenanceRetentionProven: false, productPrivateAdmission: "BLOCKED" };
await fs.writeFile(path.join(root, "fixture.json"), JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600, flag: "wx" });
process.stdout.write(JSON.stringify({ root, fixture: path.join(root, "fixture.json"), sourceInputs: identities.length,
  syntheticOnly: true, ffiLoaded: false, endpointOpened: false, nativeExecuted: false, runtimeStatus: "NOT RUN" }) + "\n");
