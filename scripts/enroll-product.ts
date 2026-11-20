import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { compatibilityBuild } from "../packages/contracts/generated/identity.ts";
import { digest, identifyAsset, inspectInstallation, type AssetIdentity } from "../packages/compatibility/installation.ts";
import { runtimeMappings } from "../packages/compatibility/runtime-mappings.ts";
import { PreflightTransport } from "../packages/compatibility/transport.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const value = (name: string): string | undefined => process.argv.slice(2).find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const candidate = resolve(value("candidate") ?? "vendor/omp-candidate");
const runtime = resolve(value("runtime") ?? process.execPath);
const manifestPath = resolve(value("manifest") ?? "vendor/product/installation.json");
const root = resolve(dirname(manifestPath), "../..");

/** Enroll one concrete candidate closure; walking the directory keeps stale chunk inventory out. */
async function walk(directory: string): Promise<string[]> {
  const names = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
  const paths = [directory];
  for (const entry of names) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path));
    else paths.push(path);
  }
  return paths;
}
const assets: AssetIdentity[] = [];
for (const path of await walk(candidate)) assets.push(await identifyAsset(root, path, manifestPath));
for (const name of ["client.js", "index.html"]) assets.push(await identifyAsset(root, `vendor/dsh-product/${name}`, manifestPath));
assets.push(await identifyAsset(root, "vendor/dsh-product", manifestPath));
// The enrolled runtime closure is what the preflight child actually maps, not a guessed list.
const probeHome = await mkdtemp(join(tmpdir(), "omp-product-enroll-"));
let runtimeDependencies: AssetIdentity[] = [];
try {
  const probe = await PreflightTransport.open({ argv: [runtime, "--no-env-file", join(candidate, "cli.js"), "--rpc-preflight"],
    cwd: probeHome, env: { HOME: probeHome, PI_CODING_AGENT_DIR: probeHome, TMPDIR: probeHome } });
  const mapped = (await runtimeMappings(probe.processId)).filter(path => path !== runtime);
  await probe.close();
  runtimeDependencies = await Promise.all(mapped.map(path => identifyAsset(root, path, manifestPath)));
} finally { await rm(probeHome, { recursive: true, force: true }); }
const manifest = {
  format: "omp-webui-s0-v1",
  base: compatibilityBuild.base,
  patch: compatibilityBuild.patchSha256,
  schema: compatibilityBuild.schemaSha256,
  launcher: join(candidate, "omp"),
  target: join(candidate, "cli.js"),
  runtime: await identifyAsset(root, runtime, manifestPath),
  platform: process.platform,
  arch: process.arch,
  assets,
  runtimeDependencies,
};
await mkdir(dirname(manifestPath), { recursive: true });
const text = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(manifestPath, text);
// Prove the emitted enrollment before printing it as the product identity.
await inspectInstallation({ manifest: manifestPath, launcher: join(candidate, "omp") });
console.log(JSON.stringify({ manifest: manifestPath, sha256: digest(text), assets: assets.length, launcher: manifest.launcher, candidate, runtime }));
