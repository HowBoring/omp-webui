/** Compile the pinned upstream CLI in the build process. Never load the resulting worker here. */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import inputs from "./strict-runtime-inputs.json";

const [native, compiler, registry, output] = process.argv.slice(2);
assert.ok(native && compiler && registry && output && process.argv.length === 6);
assert.equal(Bun.version, "1.4.4");
assert.equal(process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH, "0");
assert.equal(process.env.NODE_DISABLE_COMPILE_CACHE, "1");
assert.equal(process.env.NODE_PATH, registry);

const legacyPath = resolve(native, inputs.legacyPlugin.path);
const { createLegacyPiVirtualModulePlugin } = await import(legacyPath);
const generated = new Set(inputs.generatedOutputs.map(item => item.path));
const used = new Set<string>();
const registryRoot = resolve(registry, "puppeteer-core") + "/";
const exactInputs: Bun.BunPlugin = {
  name: "pinned-strict-inputs",
  setup(build) {
    build.onResolve({ filter: /^puppeteer-core\/internal\/(?:util\/Function|revisions)\.js$/ }, args => {
      const path = realpathSync(Bun.resolveSync(args.path, registry));
      assert.ok(path.startsWith(registryRoot), "Puppeteer export escaped the verified registry package");
      return { path };
    });
    build.onResolve({ filter: /^\.\.?\/.*\.generated(?:\.(?:js|ts))?$/ }, args => {
      if (!args.importer.startsWith(native + "/")) return;
      const requested = args.path.endsWith(".generated") ? args.path + ".ts" : args.path;
      const path = resolve(dirname(args.importer), requested);
      const name = relative(native, path);
      if (existsSync(path) || !generated.has(name)) return;
      return { path, namespace: "strict-generated" };
    });
    build.onLoad({ filter: /\.generated\.(?:js|ts)$/, namespace: "strict-generated" }, args => {
      const name = relative(native, args.path);
      assert.ok(generated.has(name));
      const donor = resolve(compiler, name);
      used.add(name);
      return { contents: readFileSync(donor), loader: donor.endsWith(".ts") ? "ts" : "js" };
    });
  },
};

const built = await Bun.build({
  entrypoints: [resolve(native, "packages/coding-agent/src/cli.ts")],
  root: native,
  target: "bun",
  minify: { whitespace: true },
  naming: { entry: "cli.js", asset: "[name]-[hash].[ext]" },
  plugins: [await createLegacyPiVirtualModulePlugin(), exactInputs],
});
assert.deepEqual(built.logs, []);
assert.deepEqual([...used].sort(), [...generated].sort());
assert.equal(built.outputs.length, inputs.bundleOutputs.length);

for (const artifact of built.outputs) {
  const name = basename(artifact.path);
  const expected = inputs.bundleOutputs.find(item => item.path === name);
  assert.ok(expected && artifact.path === `./${name}`, `Unexpected bundle output: ${artifact.path}`);
  assert.equal(artifact.size, expected.bytes, name);
  const bytes = await artifact.arrayBuffer();
  assert.equal(Bun.SHA256.hash(bytes, "hex"), expected.sha256, name);
  await Bun.write(resolve(output, name), bytes);
}
