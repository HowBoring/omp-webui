import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function fixtureRelease(parent: string): Promise<string> {
  const root = join(parent, "release");
  for (const name of ["bin", "runtime", "worker", "native", "host", "client", "contracts", "provenance"]) {
    await mkdir(join(root, name), { recursive: true });
    await writeFile(join(root, name, "member"), `synthetic ${name} fixture\n`);
  }
  await writeFile(join(root, "bin/omp"), "synthetic launcher fixture\n");
  await writeFile(join(root, "runtime/bunfig.toml"), "preload = []\n");
  await writeFile(join(root, "runtime/bun"), "synthetic runtime fixture\n");
  await writeFile(join(root, "worker/cli.js"), "synthetic deferred CLI fixture\n");
  await chmod(join(root, "bin/omp"), 0o755);
  await chmod(join(root, "runtime/bun"), 0o755);
  return root;
}

