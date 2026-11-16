import { readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import { digest } from "../packages/compatibility/installation.ts";
const inputs: { path: string; sha256: string }[] = [];
const built = await Bun.build({
  entrypoints: ["apps/host/src/workspace-component-main.ts"], target: "bun", outdir: "vendor/host-workspaces",
  plugins: [{ name: "audited-host-inputs", setup(build) {
    build.onLoad({ filter: /\.[cm]?[jt]s$/ }, async args => {
      const contents = await readFile(args.path, "utf8");
      inputs.push({ path: relative(process.cwd(), args.path), sha256: digest(contents) });
      return { contents, loader: args.path.endsWith("ts") ? "ts" : "js" };
    });
  } }],
});
if (!built.success) throw new AggregateError(built.logs, "Host diagnostics build failed");
await writeFile("vendor/host-workspaces/manifest.json", JSON.stringify({
  kind: "isolated-workspace-component", runtime: { name: "bun", version: Bun.version },
  inputs: inputs.sort((a, b) => a.path.localeCompare(b.path)),
  bundle: { file: "workspace-component-main.js", sha256: digest(await readFile("vendor/host-workspaces/workspace-component-main.js")) },
}, null, 2) + "\n");
console.info(JSON.stringify({ status: "host-built", inputs: inputs.length, bundle: built.outputs[0]?.size }));
