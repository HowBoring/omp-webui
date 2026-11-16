import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

for (const boundary of ["overflow", "exact"] as const) test(`native generation ${boundary} encoded carrier budget stays readable`, async () => {
  const home = await mkdtemp(join(tmpdir(), "strict-carrier-"));
  try {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", resolve("compatibility/omp/fixtures/no-provider.ts"),
      resolve("compatibility/omp/fixtures/carrier-budget.ts"), boundary], { cwd: home,
      env: { HOME: home, TMPDIR: home, PATH: "/usr/bin:/bin", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
      stdout: "pipe", stderr: "pipe" });
    const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code) throw new Error(errors || `Native boundary probe exited ${code}`);
    const value = JSON.parse(output);
    if (boundary === "overflow") expect(value).toMatchObject({ error: "GENERATION_CARRIER_LIMIT", unchanged: true,
      size: 268435184, reopenedTitle: "先前标题" });
    else expect(value).toMatchObject({ unchanged: false, size: 268435456, reopenedTitle: "完整的原生标题" });
  } finally { await rm(home, { recursive: true, force: true }); }
}, 60_000);
