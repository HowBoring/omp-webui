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
interface Observation { stamp: string; link: string | undefined }
/** Retained generation stability facts, not authenticated owner/inode enrollment. */
export class ReleaseObservation {
  #observed = new Map<string, Observation>();

  async observe(location: string): Promise<BigIntStats> {
    const stat = await fs.lstat(location, { bigint: true });
    const link = stat.isSymbolicLink() ? await fs.readlink(location) : undefined;
    if (stamp(await fs.lstat(location, { bigint: true })) !== stamp(stat)) refuse();
    const value = { stamp: stamp(stat), link }, previous = this.#observed.get(location);
    if (previous && (previous.stamp !== value.stamp || previous.link !== value.link)) refuse();
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
    for (const parent of parents.reverse()) if (!(await this.observe(parent)).isDirectory()) refuse();
    if (await fs.realpath(path.dirname(location)) !== path.dirname(location)) refuse();
  }

  async recheck(): Promise<void> {
    for (const location of this.#observed.keys()) await this.observe(location);
  }

  /** All reads are positioned, bounded and bracketed against both descriptor and named identity. */
  async read<T>(location: string, maximum: number, consume: (file: fs.FileHandle, size: number) => Promise<T>): Promise<T> {
    await this.parents(location);
    const before = await this.observe(location);
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maximum)
      || (before.mode & 0o7000n) !== 0n) refuse();
    const file = await fs.open(location, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (stamp(await file.stat({ bigint: true })) !== stamp(before)) refuse();
      await this.observe(location);
      const result = await consume(file, Number(before.size));
      if (stamp(await file.stat({ bigint: true })) !== stamp(before)) refuse();
      await this.observe(location);
      await this.parents(location);
      return result;
    } finally { await file.close(); }
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
