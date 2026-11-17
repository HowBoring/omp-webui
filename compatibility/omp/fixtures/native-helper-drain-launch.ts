import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { probePin, probeLaunchMembers, probePlatformMembers, readProbePin, sha256 } from "./native-signed-probe-launch";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const absolute = z.string().max(4096).refine(value => path.isAbsolute(value) && path.resolve(value) === value);
const directory = z.strictObject({ path: absolute, device: z.string().regex(/^\d+$/), inode: z.string().regex(/^[1-9]\d*$/) });
export const helperDrainConfiguration = z.strictObject({
  stage: absolute.refine(value => /^\/tmp\/native-helper-drain-[A-Za-z0-9-]+$/.test(value)),
  installation: hash, generation: hash, anchor: probePin, replyKey: probePin,
  dispatcherReplyPublicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export type HelperDrainConfiguration = z.infer<typeof helperDrainConfiguration>;
const member = z.strictObject({ path: z.string(), kind: z.enum(["file", "directory"]), identity: hash,
  mode: z.number().int().min(0).max(0o777) });
const closure = z.strictObject({ format: z.literal("omp-native-helper-drain-launch/1"),
  members: z.array(member).min(1).max(2048), platformDependencies: z.array(member.extend({
    kind: z.enum(["file", "link"]), identity: z.string() })).length(7) });
function canonical(bytes: string): unknown {
  const value: unknown = JSON.parse(bytes);
  if (JSON.stringify(value) !== bytes) throw new Error("DRAIN_NONCANONICAL_APPROVAL");
  return value;
}

/** Compare semantic rosters after the same strict schema normalization; object insertion order grants no identity. */
export function assertHelperDrainLaunchRoster(signed: unknown, members: unknown,
  platformDependencies: unknown): z.infer<typeof closure> {
  const inventory = closure.parse(signed);
  if (JSON.stringify(inventory.members) !== JSON.stringify(closure.shape.members.parse(members))
    || JSON.stringify(inventory.platformDependencies)
      !== JSON.stringify(closure.shape.platformDependencies.parse(platformDependencies))) throw new Error("DRAIN_LAUNCH_CHANGED");
  return inventory;
}

/** No Native/Host/FFI import in this graph. The private reply-key file is never opened by the bootstrap. */
export async function authenticateHelperDrainLaunch(input: HelperDrainConfiguration): Promise<void> {
  const config = helperDrainConfiguration.parse(input), root = `${config.stage}/launch`;
  if (!Object.hasOwn(globalThis, Symbol.for("omp.s0.network-guard"))) throw new Error("DRAIN_PREIMPORT_GUARD_MISSING");
  if (config.anchor.path !== `${config.stage}/operator/anchor.json`
    || config.replyKey.path !== `${config.stage}/operator/reply-key.json`) throw new Error("DRAIN_OPERATOR_PATHS");
  const anchor = z.strictObject({ version: z.literal("omp-execution-approval-anchor/3"), installation: hash,
    approvalPublicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/), approvalRecord: z.strictObject({ path: absolute,
      parent: directory }), approvalVersion: z.literal("omp-execution-approval/4"), recordBytes: z.literal(16384) })
    .parse(canonical(await readProbePin(config.anchor)));
  if (anchor.installation !== config.installation || anchor.approvalRecord.path !== `${config.stage}/operator/approval.json`
    || anchor.approvalRecord.parent.path !== `${config.stage}/operator`
    || anchor.approvalPublicKey === config.dispatcherReplyPublicKey) throw new Error("DRAIN_ANCHOR_SCOPE");
  const parent = await fs.lstat(anchor.approvalRecord.parent.path, { bigint: true });
  if (!parent.isDirectory() || parent.uid !== BigInt(process.getuid?.() ?? -1) || (parent.mode & 0o7777n) !== 0o700n
    || String(parent.dev) !== anchor.approvalRecord.parent.device || String(parent.ino) !== anchor.approvalRecord.parent.inode
    || await fs.realpath(anchor.approvalRecord.parent.path) !== anchor.approvalRecord.parent.path) throw new Error("DRAIN_OPERATOR_CHANGED");
  const metadata = await fs.lstat(anchor.approvalRecord.path, { bigint: true });
  if (metadata.size > 16384n) throw new Error("DRAIN_APPROVAL_LIMIT");
  const recordPin = { path: anchor.approvalRecord.path, device: String(metadata.dev), inode: String(metadata.ino),
    sha256: sha256(await fs.readFile(anchor.approvalRecord.path)) };
  const record = await readProbePin(recordPin);
  const envelope = z.strictObject({ version: z.literal("omp-execution-signed-approval/1"), payload: z.string(),
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }).parse(canonical(record));
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(Buffer.from(anchor.approvalPublicKey, "base64url")),
    "Ed25519", false, ["verify"]);
  if (!await crypto.subtle.verify("Ed25519", key, Uint8Array.from(Buffer.from(envelope.signature, "base64url")),
    new TextEncoder().encode(`omp-execution-release-approval/4\0${envelope.payload}`))) throw new Error("DRAIN_APPROVAL_SIGNATURE");
  // Production subsequently validates the full strict payload. This outer check confers no peer/lifetime authority.
  const approved = z.object({ version: z.literal("omp-execution-approval/4"), installation: hash,
    identity: z.strictObject({ closure: hash, schema: hash }), releaseRoot: absolute, entry: probePin,
    dispatcherReplyPublicKey: z.string() }).parse(canonical(envelope.payload));
  if (approved.installation !== config.installation || approved.releaseRoot !== `${root}/components`
    || approved.entry.path !== `${root}/bin/omp` || approved.dispatcherReplyPublicKey !== config.dispatcherReplyPublicKey) {
    throw new Error("DRAIN_APPROVAL_SCOPE");
  }
  const bytes = await fs.readFile(`${root}/launch-closure.json`);
  if (sha256(bytes) !== approved.identity.closure) throw new Error("DRAIN_LAUNCH_DIGEST");
  const inventory = assertHelperDrainLaunchRoster(JSON.parse(bytes.toString("utf8")),
    await probeLaunchMembers(root), await probePlatformMembers());
  if (process.execPath !== `${root}/runtime/bun` || Bun.version !== "1.4.4") throw new Error("DRAIN_RUNTIME_CHANGED");
  const entry = await fs.lstat(approved.entry.path, { bigint: true });
  if (String(entry.dev) !== approved.entry.device || String(entry.ino) !== approved.entry.inode
    || inventory.members.find(value => value.path === "bin/omp")?.identity !== approved.entry.sha256) throw new Error("DRAIN_ENTRY_CHANGED");
  await readProbePin(config.anchor); await readProbePin(recordPin);
}
