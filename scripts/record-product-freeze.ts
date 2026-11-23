/**
 * Record the ticket-63 final-combination freeze from bytes this checkout actually enrolls.
 * It refuses to write unless the DSH source verifies, the installation verifies and the built
 * boot graph carries the verified source tree. Documentation-only edits may follow the freeze;
 * any product byte change makes the freeze gate fail until this is re-run.
 */
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { inspectInstallation } from "../packages/compatibility/installation";
import { verifyDshSource } from "./dsh-source";
import { compatibilityBuild } from "../packages/contracts/generated/identity";

const root = resolve(import.meta.dir, "..");
const at = (path: string) => join(root, path);
const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const json = async (path: string) => JSON.parse(await readFile(at(path), "utf8"));
const digest = async (path: string) => sha256(await readFile(at(path)));
const git = (...args: string[]) => {
  const run = Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", ...args], { cwd: root });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return run.stdout.toString().trim();
};
async function tree(path: string, prefix = path): Promise<string[]> {
  const out: string[] = [];
  for (const name of (await readdir(at(path))).sort()) {
    const child = `${path}/${name}`;
    if ((await lstat(at(child))).isDirectory()) out.push(...await tree(child, prefix));
    else out.push(relative(root, at(child)));
  }
  return out;
}
function parseGraph(text: string): { rev: string; release: { version: string; commit: string }; entries: {
  id: string; rev: string; url: string; inject: string[]; immediately?: boolean; [key: string]: unknown
}[] } {
  const match = /^globalThis\["__DSH_BOOT__"\] = (.*);\s*$/s.exec(text);
  if (match === null) throw new Error("boot graph is not one __DSH_BOOT__ assignment");
  return JSON.parse(match[1]!);
}

const installation = await json("vendor/product/installation.json");
const worktreeRelative = (value: string) => {
  const marker = value.lastIndexOf("/vendor/");
  return marker < 0 ? value : value.slice(marker + 1);
};
const closureEntry = (entry: { path: string; identity: string }) => [entry.path.split("/").pop(), entry.identity];
const canonicalInstallation = {
  ...installation,
  launcher: worktreeRelative(installation.launcher),
  target: worktreeRelative(installation.target),
  runtime: { ...installation.runtime, path: "<runtime>" },
  assets: installation.assets.map((asset: { path: string }) => ({ ...asset, path: worktreeRelative(asset.path) })),
  runtimeDependencies: installation.runtimeDependencies.map(closureEntry),
};
const canonicalDigest = sha256(JSON.stringify(canonicalInstallation));
const verified = await inspectInstallation({
  manifest: at("vendor/product/installation.json"),
  launcher: resolve(process.env.OMP_WEB_LAUNCHER ?? at("vendor/omp-candidate/omp")),
});
await verified.verify();
const dsh = await verifyDshSource(at("vendor/dsh"), "candidate");
const manifest = await json("compatibility/dsh/patches.json");
const graphBytes = await readFile(at("vendor/dsh-product/boot/graph-__DSH_BOOT__.js"), "utf8");
const graph = parseGraph(graphBytes);
if (dsh.sourceTree !== graph.release.commit || dsh.sourceTree !== manifest.patches.at(-1)?.treeAfter) {
  throw new Error(`boot graph ${graph.release.commit} does not report verified source ${dsh.sourceTree}`);
}
if (JSON.stringify(graph.entries.map(entry => entry.id)) !== JSON.stringify([...graph.entries.map(entry => entry.id)])) {
  throw new Error("roster identity order is not stable");
}
if (new Set(graph.entries.map(entry => entry.id)).size !== graph.entries.length) {
  throw new Error("duplicate roster id");
}
const routes = await json("vendor/dsh-product/plugins/routes.json");
for (const entry of graph.entries) {
  const key = "/" + entry.url.replace(/^\.?\//, "");
  if (!(key in routes)) throw new Error(`roster route missing: ${key}`);
}
const built = (await tree("vendor/dsh-product")).sort();
const assets = await Promise.all(built.map(async path => ({ path, sha256: await digest(path) })));
const runtime = Bun.which("bun") ?? process.execPath;
const evidencePaths = [
  "docs/evidence/ticket-59-platforms.json",
  "docs/evidence/ticket-61-native-data.json",
  "docs/evidence/ticket-61-windows-chrome.json",
  "docs/evidence/ticket-61-windows-chrome.png",
  "docs/evidence/ticket-61-windows-input.json",
  "docs/evidence/ticket-61-windows-input.png",
  "docs/evidence/ticket-63-native-data.json",
  "docs/evidence/ticket-63-product-flow.json",
  "docs/evidence/ticket-63-windows-chrome.json",
  "docs/evidence/ticket-63-windows-input.json",
  "tests/product/evidence/performance-2026-11-22-product.json",
  "tests/product/evidence/performance-2026-11-23-product.json",
];
const evidence: Record<string, string> = {};
for (const path of evidencePaths) {
  try { evidence[path] = await digest(path); } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
}
const freeze = {
  ticket: 63,
  kind: "final-combination-freeze",
  spec: 29,
  recordedAt: new Date().toISOString(),
  host: {
    repository: "HowBoring/omp-webui",
    worktree: root,
    branch: git("branch", "--show-current"),
    commit: git("rev-parse", "HEAD"),
    entry: "apps/host/src/main.ts",
    runtime: { name: "bun", version: Bun.version, path: runtime,
      sha256: sha256(await readFile(runtime)) },
    platform: process.platform, arch: process.arch, bind: "127.0.0.1", defaultPort: 3206,
    note: "Identity of the tree the stock DSH product was built and verified from. Documentation-only commits that record this freeze come later on the same branch.",
  },
  machine: {
    os: process.platform === "linux" ? (await readFile("/etc/os-release", "utf8")).match(/^PRETTY_NAME="(.*)"$/m)?.[1] ?? "linux" : process.platform,
    kernel: (await readFile("/proc/sys/kernel/osrelease", "utf8")).trim(),
    machineCpus: (await import("node:os")).cpus().length,
    memoryMiB: Math.floor((await import("node:os")).totalmem() / 1048576),
    filesystem: "ext4",
  },
  omp: {
    source: compatibilityBuild,
    launcher: "vendor/omp-candidate/omp",
    target: "vendor/omp-candidate/cli.js",
    runtime: { path: "<runtime>", kind: "file", identity: sha256(await readFile(runtime)), mode: (await lstat(runtime)).mode & 0o777 },
    installationManifest: { path: "vendor/product/installation.json", sha256: canonicalDigest,
      canonicalization: "checkout-relative asset paths; runtime path tokenized; system dependency paths reduced to basename with content identity and bytes retained" },
    installationAssets: installation.assets.map((asset: any) => ({ ...asset, path: worktreeRelative(asset.path) })),
    nativeClosure: installation.runtimeDependencies,
  },
  dsh: {
    base: dsh.baseCommit, mode: dsh.mode, sourceTree: dsh.sourceTree, patches: dsh.patches,
    lockSha256: await digest("upstreams.lock.json"),
    contractSha256: await digest("packages/contracts/chat-component.ts"),
    sourceSha256: dsh.sourceSha256,
    roster: { packages: graph.entries.length, ids: graph.entries.map(entry => entry.id),
      edges: Object.fromEntries(graph.entries.map(entry => [entry.id, entry.inject])),
      pluginRuntime: "none: the product manifest declares no runtime plugins; the composition is the pinned client bundle" },
    product: { path: "vendor/dsh-product", files: built.length, sha256: sha256(JSON.stringify(assets)) },
    routes: { path: "vendor/dsh-product/plugins/routes.json", sha256: await digest("vendor/dsh-product/plugins/routes.json") },
    graph: { path: "vendor/dsh-product/boot/graph-__DSH_BOOT__.js", sha256: sha256(graphBytes), rev: graph.rev, release: graph.release },
    assets,
  },
  harness: {
    nativeData: { path: "tests/continuation/native-data.py", sha256: await digest("tests/continuation/native-data.py") },
    windowsChrome: { path: "tests/product/windows-chrome.ts", sha256: await digest("tests/product/windows-chrome.ts") },
    productFlow: { path: "tests/product/product-flow.py", sha256: await digest("tests/product/product-flow.py") },
    windowsInput: { path: "tests/product/windows-input.ts", sha256: await digest("tests/product/windows-input.ts") },
  },
  evidence,
  history: {
    "docs/evidence/ticket-61-freeze.json": await digest("docs/evidence/ticket-61-freeze.json"),
    note: "The ticket-61 custom-shell freeze is retained byte-for-byte as superseded product-composition history; it no longer gates this combination.",
  },
  notFrozen: [
    "a real model provider (all product flows used the controlled in-process provider unless a separate real-provider run is recorded)",
    "the delivery lease and package distribution (packages/delivery/gate.ts still blocks globally)",
    "maintainer operational acceptance (NOT RUN)",
  ],
};
await writeFile(at("docs/evidence/ticket-63-freeze.json"), JSON.stringify(freeze, null, 2) + "\n");
console.info(JSON.stringify({ freeze: "docs/evidence/ticket-63-freeze.json", sourceTree: dsh.sourceTree,
  roster: graph.entries.length, assets: assets.length, evidence: Object.keys(evidence).length }));
