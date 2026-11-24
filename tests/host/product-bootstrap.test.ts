import { expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");

test("bootstrap printing rejects a blocked product installation", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", "apps/host/src/main.ts", "--print-bootstrap"], {
    cwd: root,
    env: {
      ...process.env,
      OMP_WEB_MANIFEST: resolve(root, "vendor/product/does-not-exist.json"),
      OMP_WEB_LAUNCHER: resolve(root, "vendor/omp-candidate/does-not-exist"),
      OMP_WEB_MANIFEST_SHA256: "0".repeat(64),
      OMP_WEB_PORT: "32999",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill(), 2000);
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  clearTimeout(timer);
  expect(exitCode).not.toBe(0);
  expect(`${stdout}\n${stderr}`).toContain("PRODUCT_BOOTSTRAP_BLOCKED");
}, 10_000);
