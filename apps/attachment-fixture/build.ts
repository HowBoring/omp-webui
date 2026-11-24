import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { z } from "zod";
import { BuildIdentities, assetIdentities } from "../../scripts/build-identities.ts";
import { verifyDshSource } from "../../scripts/dsh-source.ts";

const root = resolve(import.meta.dir, "../..");
const outdir = resolve(root, "vendor/dsh-attachment");
const require = createRequire(import.meta.url);
const lockBytes = await readFile(resolve(root, "upstreams.lock.json"));
const lock = z.object({ dsh: z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/) }) }).parse(JSON.parse(lockBytes.toString()));
const dshRoot = resolve(dirname(require.resolve("@deepseek-ai/dsh-api-gateway/package.json")), "../../..");
const dshSource = await verifyDshSource(dshRoot, "candidate");
if (dshSource.baseCommit !== lock.dsh.commit) throw new Error("attachment DSH pin mismatch");
const entries: Record<string, string> = {
  "@deepseek-ai/dsh-client-connection/client": "@deepseek-ai/dsh-client-connection/src/client/index.ts",
  "@deepseek-ai/dsh-typert-registry/client": "@deepseek-ai/dsh-typert-registry/src/client/index.ts",
  "@deepseek-ai/dsh-api-gateway/client": "@deepseek-ai/dsh-api-gateway/src/client/index.ts",
};
const identities = new BuildIdentities();
const build = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "src/client.ts")],
  target: "browser", format: "esm", outdir, minify: true,
  plugins: [{
    name: "pinned-dsh-public-source",
    setup(builder) {
      builder.onResolve({ filter: /^@deepseek-ai\/dsh-[a-z-]+\/client$/ }, args => {
        const source = entries[args.path];
        return source === undefined ? undefined : { path: require.resolve(source) };
      });
      builder.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async args => {
        const contents = await readFile(args.path, "utf8");
        await identities.record(args.path, contents);
        return { contents, loader: args.path.endsWith(".tsx") ? "tsx" : args.path.endsWith("ts") ? "ts" : "js" };
      });
    },
  }],
});
if (!build.success) throw new AggregateError(build.logs, "attachment page build failed");
await mkdir(outdir, { recursive: true });
await writeFile(resolve(outdir, "index.html"), await readFile(resolve(import.meta.dir, "index.html")));
const assets = await assetIdentities(outdir, ["client.js", "index.html"]);
const inputSnapshot = identities.snapshot();
const contractSha256 = createHash("sha256")
  .update(await readFile(resolve(root, "packages/contracts/attachment-fixture.ts")))
  .update(await readFile(resolve(root, "packages/contracts/attachment-remote.ts")))
  .update(await readFile(resolve(root, "packages/contracts/attachment-preparation.ts")))
  .update(await readFile(resolve(root, "packages/client-extensions/attachment-preparation.ts")))
  .digest("hex");
const manifest = { kind: "isolated-attachment-fixture", dshBase: dshSource.baseCommit, dshSource,
  lockSha256: createHash("sha256").update(lockBytes).digest("hex"), runtime: { name: "bun", version: Bun.version },
  ...inputSnapshot, contractSha256, assets };
await writeFile(resolve(outdir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ kind: manifest.kind, assets, inputs: inputSnapshot.inputs.length }));
