import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const root = resolve(import.meta.dir, "../..");
const outdir = resolve(root, "vendor/dsh-diagnostics");
const require = createRequire(import.meta.url);
const lockBytes = await readFile(resolve(root, "upstreams.lock.json"));
const lock = JSON.parse(lockBytes.toString()) as { dsh: { commit: string } };
const dshRoot = resolve(dirname(require.resolve("@deepseek-ai/dsh-api-gateway/package.json")), "../../..");
const actualBase = execFileSync("git", ["-C", dshRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (actualBase !== lock.dsh.commit) throw new Error("Diagnostic DSH pin mismatch");
execFileSync("git", ["-C", dshRoot, "diff", "--exit-code", "HEAD", "--"], { stdio: "pipe" });
// Published browser bundles use DSH's module-loader wrapper. For this standalone
// shell compile the explicitly exported source entrypoints into one Cordis realm.
const entries = new Map([
  ["@deepseek-ai/dsh-client-connection/client", "@deepseek-ai/dsh-client-connection/src/client/index.ts"],
  ["@deepseek-ai/dsh-typert-registry/client", "@deepseek-ai/dsh-typert-registry/src/client/index.ts"],
  ["@deepseek-ai/dsh-api-gateway/client", "@deepseek-ai/dsh-api-gateway/src/client/index.ts"],
]);
const inputs = new Map<string, string>();
const build = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "src/client.ts")],
  target: "browser",
  format: "esm",
  outdir,
  minify: true,
  plugins: [{
    name: "pinned-dsh-public-source",
    setup(builder) {
      builder.onResolve({ filter: /^@deepseek-ai\/dsh-[a-z-]+\/client$/ }, args => {
        const source = entries.get(args.path);
        return source === undefined ? undefined : { path: require.resolve(source) };
      });
      builder.onLoad({ filter: /\.[cm]?[jt]s$/ }, async args => {
        const contents = await readFile(args.path, "utf8");
        inputs.set(args.path, createHash("sha256").update(contents).digest("hex"));
        return { contents, loader: args.path.endsWith("ts") ? "ts" : "js" };
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
const inputDigests = [...inputs.values()].sort();
const manifest = {
  kind: "diagnostic-only", dshBase: actualBase,
  lockSha256: createHash("sha256").update(lockBytes).digest("hex"), runtime: { name: "bun", version: Bun.version },
  sourceInputs: inputs.size,
  sourceSha256: createHash("sha256").update(JSON.stringify(inputDigests)).digest("hex"),
  contractSha256: createHash("sha256").update(await readFile(resolve(root, "packages/contracts/diagnostics.ts"))).digest("hex"),
  assets,
};
await writeFile(resolve(outdir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest));
