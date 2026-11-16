import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { identifyAsset, type VerifiedInstallation } from "./installation.ts";

/** Linux process-owned executable/shared-library mappings; never reads Session files. */
export async function runtimeMappings(pid: number): Promise<string[]> {
  const maps = await readFile(`/proc/${pid}/maps`, "utf8");
  const paths = new Set<string>();
  for (const line of maps.split("\n")) {
    const path = /\s(\/.*)$/.exec(line)?.[1];
    if (path !== undefined) paths.add(await realpath(path));
  }
  return [...paths].sort();
}

/** Bind approved runtime/native identities to the actual spawned diagnostic child. */
export async function verifyChildMappings(verified: VerifiedInstallation, manifestPath: string, pid: number): Promise<void> {
  const root = resolve(dirname(manifestPath), "../..");
  const approved = new Map([verified.manifest.runtime, ...verified.manifest.runtimeDependencies]
    .map(asset => [resolve(root, asset.path), asset]));
  const actual = await runtimeMappings(pid);
  for (const path of actual) {
    const expected = approved.get(path);
    if (expected === undefined || JSON.stringify(await identifyAsset(root, expected.path, manifestPath))
      !== JSON.stringify(expected)) throw new Error("PREFLIGHT_RUNTIME_MAPPING_MISMATCH");
  }
  if (actual.length !== approved.size) throw new Error("PREFLIGHT_RUNTIME_MAPPING_MISMATCH");
}
