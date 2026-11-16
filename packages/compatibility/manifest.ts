import { readdir, writeFile, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { identifyAsset, type AssetIdentity, type InstallationManifest } from "./installation.ts";

interface ManifestInput {
  root: string; path: string; launcher: string; target: string; runtime: string;
  trees: string[]; patch: string; schema: string;
}

/** Build-time enrollment. Never call this from a request or regenerate trust on startup. */
export async function writeInstallationManifest(input: ManifestInput): Promise<InstallationManifest> {
  const assets: AssetIdentity[] = [];
  const seen = new Set<string>();
  const visit = async (path: string): Promise<void> => {
    if (seen.has(path) || resolve(input.root, path) === resolve(input.path)) return;
    seen.add(path);
    const asset = await identifyAsset(input.root, path, resolve(input.path));
    assets.push(asset);
    if (asset.kind === "directory") {
      for (const name of (await readdir(resolve(input.root, path))).sort()) await visit(`${path}/${name}`);
    }
    if (asset.kind === "link") {
      // Record both the link and its resolved dependency subtree; reject unknown cycles via seen.
      await visit(relative(input.root, await realpath(resolve(input.root, path))));
    }
  };
  for (const tree of input.trees) await visit(tree);
  const runtime = await identifyAsset(input.root, relative(input.root, await realpath(input.runtime)), input.path);
  const manifest: InstallationManifest = {
    format: "omp-webui-s0-v1", base: "7c49c11aa5bbaf3f418406583096168ad5b8c6dc",
    patch: input.patch, schema: input.schema, launcher: input.launcher, target: input.target,
    runtime, platform: process.platform, arch: process.arch, assets,
  };
  await writeFile(input.path, JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
