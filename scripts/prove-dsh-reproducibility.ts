/** Rebuild the pinned DSH artifacts in two different absolute checkouts and require one identity. */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const source = resolve(process.argv[2] ?? "vendor/dsh");
const evidence = resolve(process.argv[3] ?? "docs/evidence/ticket-63-dsh-reproducibility.json");
const base = await mkdtemp(join(resolve(process.env.DSH_PROOF_ROOT ?? ".dsh-proof"), "run-"));
const checkouts = [join(base, "checkout-a"), join(base, "checkout-b")];

async function run(argv: string[], cwd: string, env?: Record<string, string>): Promise<void> {
  const child = Bun.spawn(argv, { cwd, env: { ...process.env, ...env }, stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`DSH_REPRODUCIBILITY_COMMAND_FAILED: ${argv.join(" ")}`);
}

try {
  for (const checkout of checkouts) {
    // Hardlink the prepared tree, then drop generated outputs so only a real rebuild can match.
    await run(["cp", "-al", source, checkout], base);
    await run(["find", ".", "-path", "./node_modules", "-prune", "-o", "-type", "d",
      "(", "-name", "lib", "-o", "-name", "dist", "-o", "-name", ".dsh-build", ")", "-exec", "rm", "-rf", "{}", "+"],
      checkout);
  }
  await Promise.all(checkouts.map(checkout =>
    run(["corepack", "pnpm", "run", "build:artifacts", "--serial"], checkout,
      { DSH_CLIENT_TITLE: "OMP WebUI" })));
  const built = await Promise.all(checkouts.map(async checkout => JSON.parse(await readFile(
    join(checkout, ".dsh-build", "client-build-environment.json"), "utf8")) as {
      artifacts: { fileCount: number; sha256: string } }));
  const a = built[0]!, b = built[1]!;
  const sourceRecord = JSON.parse(await readFile(join(source, ".dsh-build", "omp-webui-source.json"), "utf8")) as {
    sourceTree?: string };
  const shipped = JSON.parse(await readFile(join(source, ".dsh-build", "client-build-environment.json"), "utf8")) as {
    artifacts: { fileCount: number; sha256: string } };
  const identical = a.artifacts.sha256 === b.artifacts.sha256 && a.artifacts.fileCount === b.artifacts.fileCount
    && a.artifacts.sha256 === shipped.artifacts.sha256;
  await writeFile(evidence, `${JSON.stringify({ checkouts, sourceTree: sourceRecord.sourceTree,
    artifacts: [a.artifacts, b.artifacts], shipped: shipped.artifacts, identical }, null, 2)}\n`);
  if (!identical) throw new Error("DSH_REPRODUCIBILITY_MISMATCH");
  console.info(`identical ${a.artifacts.fileCount} artifacts: ${a.artifacts.sha256}`);
} finally {
  if (process.env.KEEP_DSH_PROOF === undefined) await rm(base, { recursive: true, force: true });
}
