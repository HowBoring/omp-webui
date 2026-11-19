import { lstat, readFile, readdir, readlink, realpath, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

export const digest = (bytes: Uint8Array | string): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const assetSchema = z.strictObject({
  path: z.string(), kind: z.enum(["file", "directory", "link"]), identity: z.string(), mode: z.number().int(),
});
export const manifestSchema = z.strictObject({
  format: z.literal("omp-webui-s0-v1"), base: z.literal("57771ae562b9345e0579bceb2d68d585e3e6927e"),
  patch: hash, schema: hash, launcher: z.string(), target: z.string(), runtime: assetSchema,
  platform: z.string(), arch: z.string(), assets: z.array(assetSchema).min(1),
  runtimeDependencies: z.array(assetSchema),
});
export type InstallationManifest = z.infer<typeof manifestSchema>;
export type AssetIdentity = z.infer<typeof assetSchema>;
export interface InstallationSelection { manifest: string; launcher: string; expectedIdentity?: string }
export interface VerifiedInstallation {
  manifest: InstallationManifest; identity: string; runtime: string; target: string;
  verify(): Promise<void>;
}

/** Content, symlink targets, modes and directory membership all affect runtime resolution. */
export async function identifyAsset(root: string, path: string, excluded: string): Promise<AssetIdentity> {
  const absolute = resolve(root, path);
  if (await realpath(dirname(absolute)) !== dirname(absolute)) throw new Error("Symlinked ancestor unsupported");
  const stat = await lstat(absolute);
  const mode = stat.mode & 0o777;
  if (stat.isSymbolicLink()) {
    const target = await readlink(absolute);
    if (await realpath(absolute) !== resolve(dirname(absolute), target)) {
      throw new Error("Indirect symlink unsupported");
    }
    return { path, kind: "link", identity: target, mode };
  }
  if (stat.isDirectory()) {
    const names = (await readdir(absolute)).filter(name => resolve(absolute, name) !== excluded).sort();
    return { path, kind: "directory", identity: digest(JSON.stringify(names)), mode };
  }
  if (!stat.isFile()) throw new Error("Unsupported closure object");
  const content = new Bun.CryptoHasher("sha256");
  // Runtime/native assets exceed 100 MiB. Identity verification must not retain whole-file buffers.
  const file = await open(absolute, "r");
  try {
    const buffer = Buffer.alloc(Math.max(4096, Math.min(stat.size, 65_536)));
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      content.update(buffer.subarray(0, bytesRead));
    }
  } finally { await file.close(); }
  return { path, kind: "file", identity: content.digest("hex"), mode };
}

/** A manifest is an operator-selected trust root, never supplied by a browser. */
export async function inspectInstallation(selection: InstallationSelection): Promise<VerifiedInstallation> {
  try {
    const bytes = await readFile(selection.manifest);
    if (selection.expectedIdentity !== undefined && selection.expectedIdentity !== digest(bytes)) {
      throw new Error("trust changed");
    }
    const manifest = manifestSchema.parse(JSON.parse(bytes.toString("utf8")));
    const root = resolve(dirname(selection.manifest), "../..");
    const target = resolve(root, manifest.target);
    const runtime = resolve(root, manifest.runtime.path);
    const verify = async (): Promise<void> => {
      if (digest(await readFile(selection.manifest)) !== digest(bytes)) throw new Error("manifest changed");
      if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error("platform");
      if (resolve(selection.launcher) !== resolve(root, manifest.launcher)) throw new Error("launcher selection");
      if (await realpath(selection.launcher) !== target) throw new Error("launcher target");
      for (const entry of [manifest.runtime, ...manifest.runtimeDependencies, ...manifest.assets]) {
        const actual = await identifyAsset(root, entry.path, resolve(selection.manifest));
        if (JSON.stringify(actual) !== JSON.stringify(entry)) throw new Error("closure changed");
      }
    };
    await verify();
    return { manifest, identity: digest(bytes), runtime, target, verify };
  } catch { throw new Error("INSTALLATION_UNVERIFIED"); }
}
