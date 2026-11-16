import { test, expect } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The child environment is isolated BEFORE any native OMP module is imported.
for (const fixture of ["native-dialogs", "controlled-clock"]) test(`${fixture}: public RPC dialogs retain invalid answers and cancel native expiry without defaults`, async () => {
  const home = await mkdtemp(join(tmpdir(), "omp-interactions-"));
  await mkdir(join(home, "profile"));
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(`tests/interactions/${fixture}.ts`)], {
    cwd: home, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, TMPDIR: home,
      PI_CODING_AGENT_DIR: join(home, "profile"), XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home,
      OMP_NATIVE_ROOT: resolve("vendor/omp/packages/coding-agent/src"), OMP_NATIVE_SOURCE: resolve("vendor/omp/packages/coding-agent/src/modes/rpc/rpc-mode.ts") },
    stdout: "pipe", stderr: "pipe",
  });
  try {
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(),
      new Response(child.stderr).text()]);
    expect({code, out, err}).toEqual({code: 0, out: `${fixture}: PASS\n`, err: ""});
  } finally { child.kill(); await rm(home, { recursive: true, force: true }); }
}, 30_000);
