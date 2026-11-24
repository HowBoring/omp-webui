import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { prepareDshSource } from "../../scripts/dsh-source.ts";

const root = resolve(import.meta.dir, "../..");
const require = createRequire(import.meta.url);
const dshRoot = resolve(dirname(require.resolve("@deepseek-ai/dsh-api-gateway/package.json")), "../../..");
const base = "38a6a5c965aa99ab525161efb7cc5cf1fe62fced";
const identity = z.object({
  dshBase: z.string(),
  dshSource: z.object({ mode: z.string(), sourceTree: z.string(), sourceSha256: z.string(),
    patches: z.array(z.object({ sha256: z.string() })) }),
  sourceInputs: z.number(),
  inputs: z.array(z.object({ package: z.string(), version: z.string(), file: z.string(), sha256: z.string() })),
  assets: z.record(z.string(), z.string()),
});

/** Run the shipped catalog entrypoint in an isolated workspace, with its real source and package links. */
async function workspace(): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), "catalog-build-"));
  for (const path of ["apps/catalog", "packages", "scripts/dsh-source.ts", "scripts/build-identities.ts", "compatibility/dsh",
    "package.json", "upstreams.lock.json"]) {
    await mkdir(resolve(dir, path, ".."), { recursive: true });
    await cp(resolve(root, path), resolve(dir, path), { recursive: true });
  }
  await mkdir(resolve(dir, "node_modules/@deepseek-ai"), { recursive: true });
  for (const name of await readdir(resolve(root, "node_modules"))) {
    if (name === "@deepseek-ai") continue;
    await symlink(resolve(root, "node_modules", name), resolve(dir, "node_modules", name));
  }
  for (const name of await readdir(resolve(root, "node_modules/@deepseek-ai"))) {
    await symlink(resolve(root, "node_modules/@deepseek-ai", name), resolve(dir, "node_modules/@deepseek-ai", name));
  }
  return dir;
}

async function build(dir: string): Promise<{ exitCode: number; stderr: string }> {
  const child = Bun.spawn([process.execPath, "--no-env-file", "apps/catalog/build.ts"], {
    cwd: dir, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", DSH_SOURCE: "/unused-declared-source" },
    stdout: "ignore", stderr: "pipe",
  });
  const stderr = await new Response(child.stderr).text();
  return { exitCode: await child.exited, stderr: stderr.slice(0, 2000) };
}

test("catalog builds the resolved complete DSH candidate and records its source and consumed input identities", async () => {
  const dir = await workspace();
  try {
    expect(await build(dir)).toEqual({ exitCode: 0, stderr: "" });
    const manifest = identity.parse(JSON.parse(await readFile(resolve(dir, "vendor/dsh-catalog/manifest.json"), "utf8")));
    expect(manifest.dshBase).toBe(base);
    expect(manifest.dshSource).toMatchObject({ mode: "candidate",
      sourceTree: "f5cc084f803a001930f8d1c6fa1abba5bd78e08f",
      sourceSha256: "ea64f5c189d66fb482246f345cf6731a938a9613c6aa37bb6d6a3dac57f34347" });
    expect(manifest.dshSource.patches.map(patch => patch.sha256)).toEqual([
      "d70bfb244979edd3dbc3732f5b19d219923e1abe854901964d2def00de8177d4",
      "5424ef87842b96ba7af0b465bbeda573d0bd798cac3ee673ffdddccdf79f883f",
      "d911660293aacdab136de5cbaa4cf8aba69b45ec5bd658a90d03ed29366b7302",
      "52718beaff79d4892f2cf89768b9f7e8846b72d17e883007f9e308a8a70ff9d2",
      "e3ef9ab063b735d192279e3d46740d635128c500e308f89c6ee759e547147ab5",
      "48887717d2e13ab5a9b77a91fdecc29c7e72c250851030b05c58c2d38a87ca08",
      "9ba36f2083360e113118e1f86619081334ebc9a6c4e78ba15aaaa4c2347ead32",
      "90df8ac2915bd793af9988a545d06adcae64b1de1d5922bee3019c7fcf2c8592",
      "4caaf35b190d19164d47eb480e4192311e444b13e1611b5d268c7cbf0c144e2a",
      "81208a578e4e7b04a4812889a0c58d5312ad5c158705b899b48f0b252e7abedf",
      "754ea9266e5ad4ba4be317c494465a4bfe2df893d5bf288b21d32acac88e1b2b",
    ]);
    expect(manifest.inputs.length).toBe(manifest.sourceInputs);
    expect(manifest.inputs.find(input => input.package === "@deepseek-ai/dsh-api-gateway"
      && input.file === "src/client/index.ts")?.sha256).toBe(createHash("sha256")
        .update(await readFile(resolve(dshRoot, "packages/api/gateway/src/client/index.ts"))).digest("hex"));
    for (const [name, digest] of Object.entries(manifest.assets)) {
      expect(createHash("sha256").update(await readFile(resolve(dir, "vendor/dsh-catalog", name))).digest("hex"))
        .toBe(digest);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 30000);

function git(dir: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", "-C", dir, ...args]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

test("catalog rejects baseline, partial patches, wrong base and unrecorded resolved source before publishing assets", async () => {
  const dir = await workspace();
  const source = resolve(dir, "dsh-source");
  try {
    git(dir, "clone", "--shared", "--no-checkout", dshRoot, source);
    git(source, "checkout", "--detach", base);
    const gateway = resolve(dir, "node_modules/@deepseek-ai/dsh-api-gateway");
    await rm(gateway);
    await symlink(resolve(source, "packages/api/gateway"), gateway);
    const rejected = async (code: string): Promise<void> => {
      const result = await build(dir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(code);
      expect(await Bun.file(resolve(dir, "vendor/dsh-catalog/manifest.json")).exists()).toBe(false);
      expect(await Bun.file(resolve(dir, "vendor/dsh-catalog/client.js")).exists()).toBe(false);
    };
    await rejected("DSH_AUTHORED_SOURCE_MISMATCH");
    git(source, "apply", resolve(root, "compatibility/dsh/patches/0001-navigation-policy.patch"));
    await rejected("DSH_AUTHORED_SOURCE_MISMATCH");
    git(source, "apply", resolve(root, "compatibility/dsh/patches/0002-semantic-drafts.patch"));
    await rejected("DSH_AUTHORED_SOURCE_MISMATCH");
    git(source, "reset", "--hard", base);
    git(source, "clean", "-fd");
    await prepareDshSource(source);
    const consumed = resolve(source, "packages/api/gateway/src/client/index.ts");
    const original = await readFile(consumed);
    await writeFile(consumed, Buffer.concat([original, Buffer.from("\n// undeclared catalog input\n")]));
    await rejected("DSH_AUTHORED_SOURCE_MISMATCH");
    await writeFile(consumed, original);
    await writeFile(resolve(source, "packages/api/gateway/src/client/undeclared.ts"), "export const extra = true;\n");
    await rejected("DSH_AUTHORED_SOURCE_MISMATCH");
    await rm(resolve(source, "packages/api/gateway/src/client/undeclared.ts"));
    await writeFile(resolve(source, ".env"), "UNRECORDED_SYNTHETIC_VALUE=1\n");
    await rejected("DSH_UNRECORDED_IGNORED_SOURCE");
    await rm(resolve(source, ".env"));
    git(source, "add", "-A");
    const tree = git(source, "write-tree");
    const unrelated = git(source, "-c", "user.name=Catalog source fixture", "-c", "user.email=fixture@example.invalid",
      "commit-tree", tree, "-m", "Synthetic exact tree without pinned ancestry");
    git(source, "reset", "--hard", unrelated);
    await rejected("DSH_SOURCE_GIT_FAILED: merge-base");
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 60000);
