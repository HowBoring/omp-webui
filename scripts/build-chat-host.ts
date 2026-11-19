import { readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import { digest } from "../packages/compatibility/installation.ts";
const inputs: { path: string; sha256: string }[] = [];
const built = await Bun.build({
  entrypoints: ["apps/host/src/chat-component-main.ts"], target: "bun", outdir: "vendor/host-chat",
  plugins: [{ name: "audited-chat-host-inputs", setup(build) {
    build.onLoad({ filter: /\.[cm]?[jt]s$/ }, async args => {
      const contents = await readFile(args.path, "utf8");
      inputs.push({ path: relative(process.cwd(), args.path), sha256: digest(contents) });
      return { contents, loader: args.path.endsWith("ts") ? "ts" : "js" };
    });
  } }],
});
if (!built.success) throw new AggregateError(built.logs, "Chat host diagnostics build failed");
await writeFile("vendor/host-chat/manifest.json", JSON.stringify({
  kind: "isolated-chat-component", runtime: { name: "bun", version: Bun.version },
  inputs: inputs.sort((a, b) => a.path.localeCompare(b.path)),
  bundle: { file: "chat-component-main.js", sha256: digest(await readFile("vendor/host-chat/chat-component-main.js")) },
}, null, 2) + "\n");
console.info(JSON.stringify({ status: "chat-host-built", inputs: inputs.length }));
