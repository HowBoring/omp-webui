import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildControlledLauncher } from "../../scripts/build-controlled-launcher.ts";

/** Harmless actual Bun OS fixture; the shell delegate avoids copying the large pinned runtime. */
export async function launcherFixture() {
  const parent = await mkdtemp(join(tmpdir(), "delivery-launcher-"));
  const root = join(parent, "release");
  try {
    await mkdir(root);
    for (const name of ["bin", "runtime", "worker"]) await mkdir(join(root, name));
    const runtime = join(root, "runtime/bun");
    await writeFile(runtime, `#!/bin/sh\nexec ${process.execPath} "$@"\n`);
    await chmod(runtime, 0o755);
    await writeFile(join(root, "runtime/bunfig.toml"), "preload = []\n");
    const cwd = join(parent, "project");
    await mkdir(cwd);
    await writeFile(join(root, "worker/cli.js"),
      'console.log(JSON.stringify({pid:process.pid,args:process.argv.slice(2)})); await Bun.stdin.text();\n');
    const path = join(parent, "maintenance.lock");
    await writeFile(path, "", { mode: 0o600, flag: "wx" });
    const metadata = await stat(path, { bigint: true });
    const control = { path, device: metadata.dev.toString(), inode: metadata.ino.toString() };
    await buildControlledLauncher({ root, control });
    return { root, parent, cwd, control, entry: join(root, "bin/omp"),
      cleanup: () => rm(parent, { recursive: true, force: true }) };
  } catch (error) {
    await rm(parent, { recursive: true, force: true });
    throw error;
  }
}
