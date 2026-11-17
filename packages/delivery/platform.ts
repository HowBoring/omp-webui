import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AssetIdentity } from "../compatibility/installation.ts";
import { inspectElf, type ElfMetadata } from "./elf.ts";
import { canonical, refuse, type ReleaseObservation } from "./observation.ts";

/** Existing v1 member shape: exact relative link text, canonical parent, or canonical single-link file. */
export async function platformMember(observation: ReleaseObservation, location: string, root: string): Promise<AssetIdentity> {
  canonical(location);
  if (location === root || location.startsWith(`${root}/`)) refuse();
  const member = await observation.member(location, location);
  if (member.kind === "directory") refuse();
  return member;
}

async function interpreter(observation: ReleaseObservation, location: string, members: Map<string, AssetIdentity>,
  used: Set<string>): Promise<string> {
  let pending = location.split("/").slice(1), current = "/", hops = 0, components = 0;
  while (pending.length) {
    if (++components > 256) refuse();
    const candidate = path.join(current, pending.shift()!);
    const stat = await observation.observe(candidate);
    if (stat.isSymbolicLink()) {
      if (++hops > 16) refuse();
      const link = await fs.readlink(candidate), member = members.get(candidate);
      if (member?.kind !== "link" || member.identity !== link || member.mode !== Number(stat.mode & 0o7777n)) refuse();
      used.add(candidate);
      pending = [...path.resolve(current, link).split("/").slice(1), ...pending]; current = "/";
    } else {
      if (pending.length && !stat.isDirectory()) refuse();
      current = candidate;
    }
  }
  if (members.get(current)?.kind !== "file" || await fs.realpath(location) !== current) refuse();
  used.add(current);
  return current;
}

/** Exhaustive recursive supported ELF closure, with no implicit loader search or platform enrollment. */
export async function verifyPlatform(observation: ReleaseObservation, root: string, files: string[],
  dependencies: AssetIdentity[]): Promise<void> {
  if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch) || dependencies.length > 256) refuse();
  const members = new Map<string, AssetIdentity>();
  for (const member of dependencies) {
    if (members.has(member.path) || !Number.isInteger(member.mode) || member.mode < 0 || member.mode > 0o777
      || JSON.stringify(await platformMember(observation, member.path, root)) !== JSON.stringify(member)) refuse();
    members.set(member.path, member);
  }
  const platformFiles = dependencies.filter(member => member.kind === "file").map(member => member.path);
  const entries = new Map<string, ElfMetadata | undefined>(), providers = new Map<string, string>();
  for (const location of [...files, ...platformFiles]) {
    const metadata = await inspectElf(observation, location);
    entries.set(location, metadata);
    if (!metadata) continue;
    for (const name of new Set([path.basename(location), ...(metadata.soname ? [metadata.soname] : [])])) {
      if (providers.has(name) && providers.get(name) !== location) refuse();
      providers.set(name, location);
    }
  }
  const pending = [...files], visited = new Set<string>(), used = new Set<string>();
  while (pending.length) {
    const location = pending.pop()!;
    if (visited.has(location)) continue;
    visited.add(location);
    const metadata = entries.get(location);
    if (!metadata) continue;
    for (const name of metadata.needed) {
      const provider = providers.get(name);
      if (!provider) refuse();
      if (members.has(provider)) used.add(provider);
      pending.push(provider);
    }
    if (metadata.interpreter) pending.push(await interpreter(observation, metadata.interpreter, members, used));
  }
  if (dependencies.some(member => !used.has(member.path))) refuse();
  // Preserve canonical-only fixtures without ELF. Real ELF closures require explicit libc and loader files.
  if ([...entries.values()].some(value => value !== undefined)
    && (!platformFiles.some(file => /\/libc(?:-[^/]+)?\.so(?:\.\d+)*$/.test(file))
      || !platformFiles.some(file => /\/(?:ld-linux[^/]*|ld-[^/]+\.so[^/]*)$/.test(file)))) refuse();
  await observation.recheck();
}
