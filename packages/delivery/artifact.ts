import { lstat, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { assetSchema, digest, identifyAsset, type AssetIdentity } from "../compatibility/installation.ts";

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
  /** Recheck after acquiring the coordinated maintenance lease; hashes alone do not stabilize an installation. */
  verify(): Promise<void>;
}

async function checkedRoot(root: string): Promise<string> {
  if (!isAbsolute(root) || resolve(root) !== root || await realpath(root) !== root) {
    throw new Error("RELEASE_LAYOUT_UNSUPPORTED");
  }
  return root;
}

/** Enumerate every package member, including directory membership. No implicit out-of-release dependency escapes. */
async function inventory(root: string): Promise<AssetIdentity[]> {
  const assets: AssetIdentity[] = [];
  const visit = async (path: string): Promise<void> => {
    if (assets.length >= maxMembers) throw new Error("RELEASE_INVENTORY_LIMIT");
    const stat = await lstat(join(root, path));
    if (stat.isFile() && stat.nlink !== 1) throw new Error("RELEASE_HARDLINK_UNSUPPORTED");
    const asset = await identifyAsset(root, path, join(root, manifestName));
    // A relative direct link can point at an inventoried package member. Ancestors/indirection are rejected upstream.
    if (asset.kind === "link") {
      if (isAbsolute(asset.identity)) throw new Error("RELEASE_LINK_ABSOLUTE");
      const target = await realpath(join(root, path));
      if (!target.startsWith(`${root}/`)) throw new Error("RELEASE_LINK_ESCAPE");
    }
    assets.push(asset);
    if (asset.kind === "directory") {
      for (const name of (await readdir(join(root, path))).sort()) {
        if (path === "." && name === manifestName) continue;
        await visit(path === "." ? name : `${path}/${name}`);
      }
    }
  };
  await visit(".");
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
  const assets = await inventory(root);
  assertComponents(assets);
  const platformDependencies: AssetIdentity[] = [];
  for (const path of [...new Set(input.platformDependencies)].sort()) {
    if (!isAbsolute(path) || await realpath(path) !== path || !(await lstat(path)).isFile()) {
      throw new Error("RELEASE_PLATFORM_DEPENDENCY_UNSUPPORTED");
    }
    platformDependencies.push(await identifyAsset("/", path, ""));
  }
  const manifest = releaseSchema.parse({ format: "omp-webui-release-inventory-v1", stage: "unaccepted-artifact",
    platform: process.platform, arch: process.arch, assets, platformDependencies });
  const bytes = JSON.stringify(manifest, null, 2) + "\n";
  if (Buffer.byteLength(bytes) > maxManifestBytes) throw new Error("RELEASE_INVENTORY_LIMIT");
  await writeFile(join(root, manifestName), bytes);
  return digest(bytes);
}

/** The reviewed digest must come from independent operator configuration, never this mutable release directory. */
export async function inspectRelease(selection: ReleaseSelection): Promise<VerifiedRelease> {
  try {
    hash.parse(selection.expectedIdentity);
    const root = await checkedRoot(selection.root);
    const path = join(root, manifestName);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > maxManifestBytes) throw new Error("manifest");
    const bytes = await readFile(path);
    if (digest(bytes) !== selection.expectedIdentity) throw new Error("trust");
    const manifest = releaseSchema.parse(JSON.parse(bytes.toString("utf8")));
    const verify = async (): Promise<void> => {
      const manifestStat = await lstat(path);
      if (!manifestStat.isFile() || manifestStat.nlink !== 1 || manifestStat.size > maxManifestBytes
        || await checkedRoot(root) !== root || digest(await readFile(path)) !== selection.expectedIdentity
        || manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error("identity");
      const actual = await inventory(root);
      assertComponents(actual);
      if (JSON.stringify(actual) !== JSON.stringify(manifest.assets)) throw new Error("closure");
      for (const entry of manifest.platformDependencies) {
        if (!isAbsolute(entry.path) || await realpath(entry.path) !== entry.path
          || JSON.stringify(await identifyAsset("/", entry.path, "")) !== JSON.stringify(entry)) {
          throw new Error("platform dependency");
        }
      }
    };
    await verify();
    return { manifest, identity: selection.expectedIdentity, root, runtime: join(root, "runtime/bun"),
      target: join(root, "worker/cli.js"), launcher: join(root, "bin/omp"), verify };
  } catch { throw new Error("RELEASE_UNVERIFIED"); }
}
