import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { z } from "zod";
import { verifyDshSource } from "../../scripts/dsh-source.ts";

const root = resolve(import.meta.dir, "../..");
const outdir = resolve(root, "vendor/dsh-interactions");
const require = createRequire(import.meta.url);
const lockBytes = await readFile(resolve(root, "upstreams.lock.json"));
const lock = z.object({ dsh: z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/) }) })
  .parse(JSON.parse(lockBytes.toString()));
const dshRoot = resolve(dirname(require.resolve("@deepseek-ai/dsh-api-gateway/package.json")), "../../..");
const dshSource=await verifyDshSource(dshRoot,"candidate");
const actualBase=dshSource.baseCommit;
if (actualBase !== lock.dsh.commit) throw new Error("Diagnostic DSH pin mismatch");
// Published browser bundles use DSH's module-loader wrapper. For this standalone
// shell compile the explicitly exported source entrypoints into one Cordis realm.
const entries = new Map([
  ["@deepseek-ai/dsh-client-ui-renderer/client", "@deepseek-ai/dsh-client-ui-renderer/src/client/index.ts"],
  ["@deepseek-ai/dsh-client-connection/client", "@deepseek-ai/dsh-client-connection/src/client/index.ts"],
  ["@deepseek-ai/dsh-typert-registry/client", "@deepseek-ai/dsh-typert-registry/src/client/index.ts"],
  ["@deepseek-ai/dsh-api-gateway/client", "@deepseek-ai/dsh-api-gateway/src/client/index.ts"],
]);
interface InputIdentity { package: string; version: string; file: string; sha256: string }
const inputs = new Map<string, InputIdentity>();
const packageMetadata = z.object({ name: z.string().optional(), version: z.string().optional() });
const packageRoots = new Map<string, { root: string; name: string; version: string }>();
async function inputIdentity(path: string, contents: string): Promise<InputIdentity> {
  let cursor = dirname(path);
  while (!packageRoots.has(cursor)) {
    try {
      const manifest = packageMetadata.parse(JSON.parse(await readFile(resolve(cursor, "package.json"), "utf8")));
      if (typeof manifest.name === "string" && typeof manifest.version === "string") {
        packageRoots.set(cursor, { root: cursor, name: manifest.name, version: manifest.version });
        continue;
      }
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error("Unidentified diagnostic build input");
    cursor = parent;
  }
  const owner = packageRoots.get(cursor);
  if (owner === undefined) throw new Error("Unidentified diagnostic build input");
  return { package: owner.name, version: owner.version, file: relative(owner.root, path),
    sha256: createHash("sha256").update(contents).digest("hex") };
}
const build = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "src/client.tsx")],
  target: "browser",
  format: "esm",
  outdir,
  minify: true,
  plugins: [{
    name: "pinned-dsh-public-source",
    setup(builder) {
      // One pinned React realm for this shell and every DSH source import.
      builder.onResolve({filter:/^react(?:-dom)?(?:\/.*)?$/},args=>({path:require.resolve(args.path)}));
      builder.onResolve({ filter: /^@deepseek-ai\/dsh-[a-z-]+\/client$/ }, args => {
        const source = entries.get(args.path);
        return source === undefined ? undefined : { path: require.resolve(source) };
      });
      builder.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async args => {
        const contents = await readFile(args.path, "utf8");
        inputs.set(args.path, await inputIdentity(args.path, contents));
        return { contents, loader: args.path.endsWith("tsx") ? "tsx" : args.path.endsWith("ts") ? "ts" : "js" };
      });
    },
  }],
});
if (!build.success) throw new AggregateError(build.logs, "Diagnostic build failed");
await mkdir(outdir, { recursive: true });
await writeFile(resolve(outdir, "index.html"), await readFile(resolve(import.meta.dir, "index.html")));
const assets: Record<string, string> = {};
for (const name of ["client.js", "index.html"]) {
  assets[name] = createHash("sha256").update(await readFile(resolve(outdir, name))).digest("hex");
}
const inputDigests = [...inputs.values()].sort((left, right) =>
  `${left.package}@${left.version}/${left.file}`.localeCompare(`${right.package}@${right.version}/${right.file}`, "en"));
for (const input of inputDigests) {
  if (["react","react-dom"].includes(input.package) && input.version !== "18.3.1") {
    throw new Error("S0_REACT_REALM_MISMATCH");
  }
}
const manifest = {
  kind: "S0-isolated-interactions", dshBase: actualBase,dshSource,
  lockSha256: createHash("sha256").update(lockBytes).digest("hex"), runtime: { name: "bun", version: Bun.version },
  sourceInputs: inputs.size,
  inputs: inputDigests,
  sourceSha256: createHash("sha256").update(JSON.stringify(inputDigests)).digest("hex"),
  contractSha256: createHash("sha256").update(await readFile(resolve(root, "packages/contracts/interactions.ts"))).digest("hex"),
  assets,
};
await writeFile(resolve(outdir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ ...manifest, inputs: `${inputDigests.length} retained per-file identities` }));
