import * as fs from "node:fs/promises";
import * as path from "node:path";
import { constants, type BigIntStats } from "node:fs";
import { createHash } from "node:crypto";
import type { AssetIdentity } from "../compatibility/installation.ts";

/** Bounded delivery refusal; filesystem paths and underlying read failures never cross this interface. */
export class ReleaseVerificationError extends Error {
  readonly code = "RELEASE_UNVERIFIED";
  constructor() { super("RELEASE_UNVERIFIED"); this.name = "ReleaseVerificationError"; }
}
export function refuse(): never { throw new ReleaseVerificationError(); }
export function canonical(location: string): void {
  if (!path.isAbsolute(location) || path.resolve(location) !== location || location.includes("\0")
    || location.length > 4096) refuse();
}
function stamp(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.uid, stat.gid, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}
function directoryIdentity(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.uid, stat.gid, stat.mode].join(":");
}
type ObservationRole = "ancestor" | "member";
interface Observation { role: ObservationRole; identity: string; stamp: string; link: string | undefined }
/** Retained generation stability facts, not authenticated owner/inode enrollment. */
export class ReleaseObservation {
  #observed = new Map<string, Observation>();

  async observe(location: string, requested: ObservationRole = "member"): Promise<BigIntStats> {
    const stat = await fs.lstat(location, { bigint: true });
    const previous = this.#observed.get(location);
    // Only nonmember traversal directories ignore metadata changed by unrelated children.
    // A member observation dominates forever; upgrading an ancestor first checks its retained identity.
    const role: ObservationRole = requested === "ancestor" && stat.isDirectory() && previous?.role !== "member"
      ? "ancestor" : "member";
    const snapshot = role === "ancestor" ? directoryIdentity : stamp;
    if (role === "ancestor" && await fs.realpath(location) !== location) refuse();
    const link = stat.isSymbolicLink() ? await fs.readlink(location) : undefined;
    if (snapshot(await fs.lstat(location, { bigint: true })) !== snapshot(stat)) refuse();
    const value = { role, identity: directoryIdentity(stat), stamp: snapshot(stat), link };
    if (previous && (previous.identity !== value.identity || previous.link !== value.link
      || (previous.role === "member" && previous.stamp !== value.stamp))) refuse();
    if (this.#observed.size >= 220_000 && !previous) refuse();
    this.#observed.set(location, value);
    return stat;
  }

  async parents(location: string): Promise<void> {
    canonical(location);
    let current = path.dirname(location);
    const parents: string[] = [];
    while (true) {
      parents.push(current);
      if (current === "/") break;
      current = path.dirname(current);
    }
    for (const parent of parents.reverse()) if (!(await this.observe(parent, "ancestor")).isDirectory()) refuse();
    if (await fs.realpath(path.dirname(location)) !== path.dirname(location)) refuse();
  }

  async recheck(): Promise<void> {
    for (const [location, value] of this.#observed) await this.observe(location, value.role);
  }

  /** Transfers close responsibility on open. Verify the descriptor against its name and ancestry before and after use. */
  async pin(location: string, maximum: number): Promise<{
    file: fs.FileHandle; size: number; verify(): Promise<void>;
  }> {
    await this.parents(location);
    const before = await this.observe(location);
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maximum)
      || (before.mode & 0o7000n) !== 0n) refuse();
    const file = await fs.open(location, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    return { file, size: Number(before.size), verify: async () => {
      if (stamp(await file.stat({ bigint: true })) !== stamp(before)) refuse();
      await this.observe(location);
      await this.parents(location);
    } };
  }

  /** All reads are positioned, bounded and bracketed against both descriptor and named identity. */
  async read<T>(location: string, maximum: number, consume: (file: fs.FileHandle, size: number) => Promise<T>): Promise<T> {
    const pin = await this.pin(location, maximum);
    try {
      await pin.verify();
      const result = await consume(pin.file, pin.size);
      await pin.verify();
      return result;
    } finally { await pin.file.close(); }
  }

  async bytes(location: string, maximum: number): Promise<Buffer> {
    return this.read(location, maximum, async (file, size) => readRange(file, size, 0, size, maximum));
  }

  async member(location: string, name: string, excluded = ""): Promise<AssetIdentity> {
    await this.parents(location);
    const before = await this.observe(location), mode = Number(before.mode & 0o7777n);
    if (mode > 0o777) refuse();
    let kind: AssetIdentity["kind"], identity: string;
    if (before.isSymbolicLink()) {
      if (before.nlink !== 1n) refuse();
      kind = "link"; identity = await fs.readlink(location);
      if (!identity || identity.length > 4096 || identity.includes("\0") || path.isAbsolute(identity)) refuse();
    } else if (before.isDirectory()) {
      kind = "directory";
      const names = (await fs.readdir(location)).filter(name => path.join(location, name) !== excluded).sort();
      identity = createHash("sha256").update(JSON.stringify(names)).digest("hex");
    } else {
      kind = "file";
      identity = await this.read(location, 1_073_741_824, async (file, size) => {
        const hash = createHash("sha256"), buffer = Buffer.alloc(65_536);
        for (let offset = 0; offset < size;) {
          const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, size - offset), offset);
          if (bytesRead === 0) refuse();
          hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
        }
        return hash.digest("hex");
      });
    }
    await this.observe(location);
    return { path: name, kind, identity, mode };
  }
}

export async function readRange(file: fs.FileHandle, size: number, offset: number, length: number,
  maximum = 1_048_576): Promise<Buffer> {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0
    || length > maximum || offset + length > size) refuse();
  const bytes = Buffer.alloc(length);
  for (let count = 0; count < length;) {
    const result = await file.read(bytes, count, length - count, offset + count);
    if (!result.bytesRead) refuse();
    count += result.bytesRead;
  }
  return bytes;
}
