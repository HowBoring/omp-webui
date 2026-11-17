import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const absolute = z.string().max(4096).refine(value => path.isAbsolute(value) && path.resolve(value) === value);
export const probePin = z.strictObject({ path: absolute, device: z.string().regex(/^\d+$/),
  inode: z.string().regex(/^[1-9]\d*$/), sha256: digest });
export const probeConfiguration = z.strictObject({ stage: absolute, installation: digest,
  anchor: probePin, key: probePin });
export type ProbeConfiguration = z.infer<typeof probeConfiguration>;
const member = z.strictObject({ path: z.string().max(4096), kind: z.enum(["file", "directory"]),
  identity: digest, mode: z.number().int().min(0).max(0o777) });
const dependency = member.extend({ path: absolute, kind: z.enum(["file", "link"]), identity: z.string().max(4096) });
const closure = z.strictObject({ format: z.literal("omp-native-signed-probe-launch/1"),
  members: z.array(member).min(1).max(2048), platformDependencies: z.array(dependency).length(7) });
export const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
function json(bytes: string): unknown {
  const value: unknown = JSON.parse(bytes);
  if (JSON.stringify(value) !== bytes) throw new Error("PROBE_NONCANONICAL_OPERATOR_JSON");
  return value;
}
export async function readProbePin(pin: z.infer<typeof probePin>): Promise<string> {
  const metadata = await fs.lstat(pin.path, { bigint: true });
  if (await fs.realpath(pin.path) !== pin.path || !metadata.isFile() || metadata.nlink !== 1n
    || metadata.size > 16384n || metadata.uid !== BigInt(process.getuid?.() ?? -1)
    || (metadata.mode & 0o7777n) !== 0o600n || String(metadata.dev) !== pin.device
    || String(metadata.ino) !== pin.inode) throw new Error("PROBE_OPERATOR_PIN_CHANGED");
  const bytes = await fs.readFile(pin.path);
  const after = await fs.lstat(pin.path, { bigint: true });
  if (metadata.ctimeNs !== after.ctimeNs || metadata.mtimeNs !== after.mtimeNs || metadata.ino !== after.ino
    || sha256(bytes) !== pin.sha256) throw new Error("PROBE_OPERATOR_PIN_CHANGED");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** Fixture launch closure only, separate from production Native's strict component/ELF inventory. No symlinks. */
export async function probeLaunchMembers(root: string, excluded = "launch-closure.json"): Promise<z.infer<typeof member>[]> {
  if (await fs.realpath(root) !== root) throw new Error("PROBE_LAUNCH_ROOT_CHANGED");
  const members: z.infer<typeof member>[] = [];
  async function visit(relative: string, depth: number): Promise<void> {
    if (depth > 32 || members.length >= 2048) throw new Error("PROBE_LAUNCH_LIMIT");
    const file = path.join(root, relative), before = await fs.lstat(file, { bigint: true });
    const mode = Number(before.mode & 0o7777n);
    if (mode > 0o777 || await fs.realpath(file) !== file) throw new Error("PROBE_LAUNCH_ALIAS");
    if (before.isDirectory()) {
      const names = (await fs.readdir(file)).filter(name => relative !== "." || name !== excluded).sort();
      members.push({ path: relative, kind: "directory", mode, identity: sha256(JSON.stringify(names)) });
      for (const name of names) await visit(relative === "." ? name : `${relative}/${name}`, depth + 1);
    } else if (before.isFile() && before.nlink === 1n && before.size <= 134_217_728n) {
      const hash = createHash("sha256"), handle = await fs.open(file, "r");
      try { for await (const bytes of handle.createReadStream({ autoClose: false })) hash.update(bytes); }
      finally { await handle.close(); }
      members.push({ path: relative, kind: "file", mode, identity: hash.digest("hex") });
    } else throw new Error("PROBE_LAUNCH_MEMBER_UNSUPPORTED");
    const after = await fs.lstat(file, { bigint: true });
    if (["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"].some(key =>
      Reflect.get(before, key) !== Reflect.get(after, key))) throw new Error("PROBE_LAUNCH_CHANGED");
  }
  await visit(".", 0); return members;
}

/** Fixed Linux x64 fixture dependency roster, established by the existing bounded ELF source audit. */
export async function probePlatformMembers(): Promise<z.infer<typeof dependency>[]> {
  if (process.platform !== "linux" || process.arch !== "x64") throw new Error("PROBE_PLATFORM_UNSUPPORTED");
  const members: z.infer<typeof dependency>[] = [];
  for (const name of ["libc.so.6", "ld-linux-x86-64.so.2", "libdl.so.2", "libm.so.6", "libpthread.so.0"]) {
    const file = `/usr/lib/x86_64-linux-gnu/${name}`, metadata = await fs.lstat(file);
    if (!metadata.isFile() || await fs.realpath(file) !== file) throw new Error("PROBE_PLATFORM_CHANGED");
    members.push({ path: file, kind: "file", identity: sha256(await fs.readFile(file)), mode: metadata.mode & 0o7777 });
  }
  for (const [file, target] of [["/lib64", "usr/lib64"],
    ["/usr/lib64/ld-linux-x86-64.so.2", "../lib/x86_64-linux-gnu/ld-linux-x86-64.so.2"]]) {
    if (!file || !target) throw new Error("PROBE_ALIAS_CONFIGURATION");
    const metadata = await fs.lstat(file);
    if (!metadata.isSymbolicLink() || await fs.readlink(file) !== target) throw new Error("PROBE_PLATFORM_ALIAS_CHANGED");
    members.push({ path: file, kind: "link", identity: target, mode: metadata.mode & 0o7777 });
  }
  return members;
}

async function authenticatedPayload(config: ProbeConfiguration) {
  const anchor = z.strictObject({ version: z.literal("omp-execution-approval-anchor/2"), installation: digest,
    approvalPublicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/), approvalRecord: z.strictObject({ path: absolute,
      parent: z.strictObject({ path: absolute, device: z.string(), inode: z.string() }) }),
    approvalVersion: z.literal("omp-execution-approval/3"), recordBytes: z.literal(16384) })
    .parse(json(await readProbePin(config.anchor)));
  if (anchor.installation !== config.installation || anchor.approvalRecord.path !== `${config.stage}/operator/approval.json`
    || anchor.approvalRecord.parent.path !== `${config.stage}/operator`) throw new Error("PROBE_ANCHOR_SCOPE");
  const parent = await fs.lstat(anchor.approvalRecord.parent.path, { bigint: true });
  if (!parent.isDirectory() || await fs.realpath(anchor.approvalRecord.parent.path) !== anchor.approvalRecord.parent.path
    || String(parent.dev) !== anchor.approvalRecord.parent.device || String(parent.ino) !== anchor.approvalRecord.parent.inode
    || parent.uid !== BigInt(process.getuid?.() ?? -1) || (parent.mode & 0o7777n) !== 0o700n) {
    throw new Error("PROBE_APPROVAL_PARENT_CHANGED");
  }
  const record = await fs.lstat(anchor.approvalRecord.path, { bigint: true });
  if (record.size > 16384n) throw new Error("PROBE_APPROVAL_LIMIT");
  const recordBytes = await readProbePin({ path: anchor.approvalRecord.path, device: String(record.dev),
    inode: String(record.ino), sha256: sha256(await fs.readFile(anchor.approvalRecord.path)) });
  const envelope = z.strictObject({ version: z.literal("omp-execution-signed-approval/1"), payload: z.string(),
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }).parse(json(recordBytes));
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(Buffer.from(anchor.approvalPublicKey, "base64url")),
    "Ed25519", false, ["verify"]);
  if (!await crypto.subtle.verify("Ed25519", key, Uint8Array.from(Buffer.from(envelope.signature, "base64url")),
    new TextEncoder().encode(`omp-execution-release-approval/3\0${envelope.payload}`))) {
    throw new Error("PROBE_APPROVAL_SIGNATURE");
  }
  // The production loader subsequently validates the ENTIRE strict v3 payload; this bootstrap grants no Native authority.
  const approved = z.object({ version: z.literal("omp-execution-approval/3"), installation: digest,
    identity: z.strictObject({ closure: digest, schema: digest }), releaseRoot: absolute,
    entry: probePin, dispatcherReplyPublicKey: z.string() }).parse(json(envelope.payload));
  if (approved.installation !== config.installation || approved.releaseRoot !== `${config.stage}/launch/components`
    || approved.entry.path !== `${config.stage}/launch/bin/omp` || approved.dispatcherReplyPublicKey === anchor.approvalPublicKey) {
    throw new Error("PROBE_APPROVAL_SCOPE");
  }
  return { approved, recordBytes, recordPath: anchor.approvalRecord.path };
}

/** Runs after reviewed bunfig preload and before EVERY Native import. No Native/FFI imports exist in this graph. */
export async function authenticateProbeLaunch(input: ProbeConfiguration): Promise<void> {
  const config = probeConfiguration.parse(input), root = `${config.stage}/launch`;
  const { approved, recordBytes, recordPath } = await authenticatedPayload(config);
  const bytes = await fs.readFile(`${root}/launch-closure.json`);
  if (sha256(bytes) !== approved.identity.closure) throw new Error("PROBE_UNSIGNED_LAUNCH_CLOSURE");
  const inventory = closure.parse(JSON.parse(bytes.toString("utf8")));
  // Parse both rosters into the same strict field order; producer insertion order is not identity.
  const currentMembers = closure.shape.members.parse(await probeLaunchMembers(root));
  if (JSON.stringify(inventory.members) !== JSON.stringify(currentMembers)) {
    throw new Error("PROBE_LAUNCH_CLOSURE_CHANGED");
  }
  if (JSON.stringify(inventory.platformDependencies) !== JSON.stringify(await probePlatformMembers())) {
    throw new Error("PROBE_PLATFORM_CLOSURE_CHANGED");
  }
  if (process.execPath !== `${root}/runtime/bun` || Bun.version !== "1.4.4") throw new Error("PROBE_RUNTIME_CHANGED");
  await readProbePin(config.anchor); await readProbePin(config.key);
  const entry = await fs.lstat(approved.entry.path, { bigint: true });
  if (String(entry.dev) !== approved.entry.device || String(entry.ino) !== approved.entry.inode
    || inventory.members.find(value => value.path === "bin/omp")?.identity !== approved.entry.sha256) {
    throw new Error("PROBE_ENTRY_PIN_CHANGED");
  }
  if (await fs.readFile(recordPath, "utf8") !== recordBytes) throw new Error("PROBE_APPROVAL_CHANGED");
}
