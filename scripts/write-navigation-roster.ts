import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Final candidate roster for the isolated navigation fixture: what the run consumes and what it does not. */
const json = async <T>(path: string): Promise<T> => JSON.parse(await readFile(resolve(path), "utf8")) as T;
const digestOf = async (path: string) => createHash("sha256").update(await readFile(resolve(path))).digest("hex");

interface PageManifest { kind: string; dshBase: string; dshSource: { baseCommit: string; sourceTree: string; mode: string;
  patches: { path: string; sha256: string; treeAfter: string }[] }; lockSha256: string; contractSha256: string;
  assets: Record<string, string>; inputs: { package: string; version: string; file: string; sha256: string }[] }
interface HostManifest { kind: string; inputs: { path: string; sha256: string }[]; bundle: { file: string; sha256: string } }
interface Patches { baseCommit: string; baseTree: string; patches: { path: string; sha256: string; treeAfter: string }[] }

export async function buildNavigationRoster() {
  const lock = await json<{ dsh: { commit: string; version: string } }>("upstreams.lock.json");
  const patches = await json<Patches>("compatibility/dsh/patches.json");
  const page = await json<PageManifest>("vendor/dsh-navigation/manifest.json");
  const host = await json<HostManifest>("vendor/host-navigation/manifest.json");
  const candidate = await json<{ kind: string; source: { patches: { path: string; bytes: number; sha256: string }[] };
    artifacts: Record<string, { bytes: number; sha256: string } | undefined> }>(
    "packages/contracts/candidates/durable-navigation-v1/candidate.json");
  return {
    ticket: 41, honesty: "isolated-navigation-fixture",
    lockSha256: await digestOf("upstreams.lock.json"), dshBase: lock.dsh.commit, dshVersion: lock.dsh.version,
    dshSource: { baseCommit: patches.baseCommit, baseTree: patches.baseTree,
      patches: await Promise.all(patches.patches.map(async patch => ({ path: `compatibility/dsh/${patch.path}`,
        bytes: (await readFile(resolve(`compatibility/dsh/${patch.path}`))).byteLength,
        sha256: await digestOf(`compatibility/dsh/${patch.path}`), treeAfter: patch.treeAfter }))),
      declaredTree: patches.patches.at(-1)?.treeAfter ?? null },
    page: { kind: page.kind, lockSha256: page.lockSha256, dshBase: page.dshBase, sourceTree: page.dshSource.sourceTree,
      contractSha256: page.contractSha256, assets: page.assets,
      digests: await Promise.all(Object.keys(page.assets).map(async name =>
        ({ path: `vendor/dsh-navigation/${name}`, sha256: await digestOf(`vendor/dsh-navigation/${name}`) }))) },
    host: { kind: host.kind, bundle: { path: `vendor/host-navigation/${host.bundle.file}`, sha256: host.bundle.sha256 },
      inputs: host.inputs.length,
      digests: await Promise.all(host.inputs.map(async input =>
        ({ path: input.path, sha256: await digestOf(input.path) }))) },
    contract: { candidateKind: candidate.kind,
      artifacts: (await Promise.all(Object.entries(candidate.artifacts).map(async ([name, artifact]) =>
        artifact === undefined ? [] : [{ path: `packages/contracts/candidates/durable-navigation-v1/${name}`,
          bytes: artifact.bytes, sha256: artifact.sha256,
          actual: await digestOf(`packages/contracts/candidates/durable-navigation-v1/${name}`) }]))).flat(),
      sourcePatches: await Promise.all(candidate.source.patches.map(async patch =>
        ({ path: patch.path, bytes: patch.bytes, sha256: patch.sha256,
          actual: await digestOf(patch.path), actualBytes: (await readFile(resolve(patch.path))).byteLength }))) },
    externalStages: [{ path: "compatibility/omp/candidates/native-cohort-38/stage-strict-runtime.py",
      kind: "external-strict-runtime-stage", enrolled: false,
      reason: "38-archive native closure; vendor/omp-strict holds only installed validators, not src/cli.ts" }],
    excluded: [{ path: "vendor/navigation-profile", reason: "per-run fixture home recreated by start()" },
      { path: "vendor/omp-strict", reason: "staged build output, not a reproducible source tree" },
      { path: "node_modules/@deepseek-ai", reason: "dsh:link symlinks, not candidate content" }],
    seams: ["authorization", "joint-idle", "metadata", "projection-rebuild"],
    capabilities: { runtimeEvidence: "NOT_RUN", registration: "none", hostRpcPort: "absent" },
  };
}

if (import.meta.main) {
  const roster = await buildNavigationRoster();
  await writeFile(resolve("docs/evidence/ticket-41-navigation-roster.json"), `${JSON.stringify(roster, null, 2)}\n`);
  console.info(JSON.stringify({ status: "roster-written", pageAssets: Object.keys(roster.page.assets).length,
    hostInputs: roster.host.inputs, externalStages: roster.externalStages.length }));
}
