import { lstat, readdir, readlink, realpath, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { assetSchema, digest, type AssetIdentity } from "../compatibility/installation.ts";

import { ReleaseObservation, canonical, refuse } from "./observation.ts";
import { platformMember, verifyPlatform } from "./platform.ts";

const manifestName = "release.json";
const maxMembers = 200_000;
const maxManifestBytes = 32 * 1024 * 1024;
export const releaseComponents = ["bin", "runtime", "worker", "native", "host", "client", "contracts", "provenance"] as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const releaseSchema = z.strictObject({
  format: z.literal("omp-webui-release-inventory-v1"), stage: z.literal("unaccepted-artifact"),
  platform: z.string(), arch: z.string(), assets: z.array(assetSchema).max(maxMembers),
  platformDependencies: z.array(assetSchema).max(256),
});
export type ReleaseManifest = z.infer<typeof releaseSchema>;
export interface ReleaseSelection { root: string; expectedIdentity: string }
export interface VerifiedRelease {
  manifest: ReleaseManifest; identity: string; root: string; runtime: string; target: string; launcher: string;
  /** Recheck the exhaustive ELF/alias closure under retained maintenance; any failure permanently fences this generation. */
  verify(): Promise<void>;
}

async function checkedRoot(root: string): Promise<string> {
  canonical(root);
  if (root === "/" || !isAbsolute(root) || resolve(root) !== root || await realpath(root) !== root) {
    throw new Error("RELEASE_LAYOUT_UNSUPPORTED");
  }
  return root;
}

/** Enumerate every package member, including directory membership. No implicit out-of-release dependency escapes. */
async function inventory(root: string, observation = new ReleaseObservation()): Promise<AssetIdentity[]> {
  const assets: AssetIdentity[] = [];
  let total = 0n;
  const visit = async (path: string, depth = 0): Promise<void> => {
    if (assets.length >= maxMembers || depth > 64) throw new Error("RELEASE_INVENTORY_LIMIT");
    const stat = await observation.observe(join(root, path));
    total += stat.isFile() ? stat.size : 0n;
    if (total > 8_589_934_592n) throw new Error("RELEASE_INVENTORY_LIMIT");
    if (stat.isFile() && stat.nlink !== 1n) throw new Error("RELEASE_HARDLINK_UNSUPPORTED");
    if (stat.isSymbolicLink() && isAbsolute(await readlink(join(root, path)))) {
      throw new Error("RELEASE_LINK_ABSOLUTE");
    }
    const asset = await observation.member(join(root, path), path, join(root, manifestName));
    // A relative direct link can point at an inventoried package member. Ancestors/indirection are rejected upstream.
    if (asset.kind === "link") {
      if (isAbsolute(asset.identity)) throw new Error("RELEASE_LINK_ABSOLUTE");
      const target = await realpath(join(root, path));
      if (!target.startsWith(`${root}/`) || target !== resolve(root, path, "..", asset.identity)) {
        throw new Error("RELEASE_LINK_ESCAPE");
      }
    }
    assets.push(asset);
    if (asset.kind === "directory") {
      for (const name of (await readdir(join(root, path))).sort()) {
        if (path === "." && name === manifestName) continue;
        await visit(path === "." ? name : `${path}/${name}`, depth + 1);
      }
    }
  };
  await visit(".");
  await observation.recheck();
  return assets;
}

function assertComponents(assets: AssetIdentity[]): void {
  for (const component of releaseComponents) {
    if (!assets.some(asset => asset.path === component && asset.kind === "directory")
      || !assets.some(asset => asset.path.startsWith(`${component}/`) && asset.kind === "file")) {
      throw new Error("RELEASE_COMPONENT_MISSING");
    }
  }
  for (const path of ["bin/omp", "runtime/bun", "runtime/bunfig.toml", "worker/cli.js"]) {
    const entry = assets.find(asset => asset.path === path);
    if (entry?.kind !== "file" || (["bin/omp", "runtime/bun"].includes(path) && (entry.mode & 0o111) === 0)) {
      throw new Error("RELEASE_ENTRY_MISSING");
    }
  }
}

/** Explicit operator build action. This inventories bytes; it cannot authenticate a publisher or approve a tuple. */
export async function writeReleaseManifest(input: { root: string; platformDependencies: string[] }): Promise<string> {
  const root = await checkedRoot(input.root);
  const destination = join(root, manifestName);
  const existing = await lstat(destination).catch(error => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existing !== undefined && (!existing.isFile() || existing.nlink !== 1)) {
    throw new Error("RELEASE_MANIFEST_PATH_UNSUPPORTED");
  }
  const observation = new ReleaseObservation();
  const assets = await inventory(root, observation);
  assertComponents(assets);
  const platformDependencies: AssetIdentity[] = [];
  if (input.platformDependencies.length > 256 || new Set(input.platformDependencies).size !== input.platformDependencies.length) {
    throw new Error("RELEASE_PLATFORM_DEPENDENCY_UNSUPPORTED");
  }
  for (const path of [...input.platformDependencies].sort()) {
    platformDependencies.push(await platformMember(observation, path, root));
  }
  await verifyPlatform(observation, root, assets.filter(asset => asset.kind === "file")
    .map(asset => join(root, asset.path)), platformDependencies);
  const manifest = releaseSchema.parse({ format: "omp-webui-release-inventory-v1", stage: "unaccepted-artifact",
    platform: process.platform, arch: process.arch, assets, platformDependencies });
  const bytes = JSON.stringify(manifest, null, 2) + "\n";
  if (Buffer.byteLength(bytes) > maxManifestBytes) throw new Error("RELEASE_INVENTORY_LIMIT");
  const temporary = join(root, `.release-${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await rename(temporary, destination);
  } finally { await rm(temporary, { force: true }); }
  return digest(bytes);
}

/** The reviewed digest must come from independent operator configuration, never this mutable release directory. */
export async function inspectRelease(selection: ReleaseSelection): Promise<VerifiedRelease> {
  try {
    hash.parse(selection.expectedIdentity);
    const root = await checkedRoot(selection.root);
    const path = join(root, manifestName);
    const observation = new ReleaseObservation();
    const bytes = await observation.bytes(path, maxManifestBytes);
    if (digest(bytes) !== selection.expectedIdentity) throw new Error("trust");
    const manifest = releaseSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    for (const asset of [...manifest.assets, ...manifest.platformDependencies]) Object.freeze(asset);
    Object.freeze(manifest.assets); Object.freeze(manifest.platformDependencies); Object.freeze(manifest);
    let failed = false;
    let pending = Promise.resolve();
    const verify = (): Promise<void> => {
      const check = async (): Promise<void> => {
        try {
          if (failed || await checkedRoot(root) !== root || !(await observation.bytes(path, maxManifestBytes)).equals(bytes)
            || manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error("identity");
          const actual = await inventory(root, observation);
          assertComponents(actual);
          if (JSON.stringify(actual) !== JSON.stringify(manifest.assets)) throw new Error("closure");
          await verifyPlatform(observation, root, actual.filter(asset => asset.kind === "file")
            .map(asset => join(root, asset.path)), manifest.platformDependencies);
          if (!(await observation.bytes(path, maxManifestBytes)).equals(bytes)) throw new Error("identity");
          await observation.recheck();
          if (failed) throw new Error("generation");
        } catch { failed = true; refuse(); }
      };
      const result = pending.then(check);
      pending = result.catch(() => {});
      return result;
    };
    await verify();
    return { manifest, identity: selection.expectedIdentity, root, runtime: join(root, "runtime/bun"),
      target: join(root, "worker/cli.js"), launcher: join(root, "bin/omp"), verify };
  } catch { refuse(); }
}
