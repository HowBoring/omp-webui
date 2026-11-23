import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const manifest = resolve(root, "vendor/product/installation.json");
const identity = createHash("sha256").update(await Bun.file(manifest).bytes()).digest("hex");
const port = 32_917;

test("a fresh isolated agent home has its native sessions root before the product catalog opens", async () => {
  const home = await mkdtemp(join(tmpdir(), "product-sessions-root-"));
  const child = Bun.spawn([process.execPath, "--no-env-file", "apps/host/src/main.ts"], {
    cwd: root,
    env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: home,
      OMP_WEB_MANIFEST: manifest, OMP_WEB_MANIFEST_SHA256: identity,
      OMP_WEB_LAUNCHER: resolve(root, "vendor/omp-candidate/omp"),
      OMP_WEB_PORT: String(port), OMP_WEB_ORIGIN: `http://127.0.0.1:${port}`,
      OMP_WEB_DATA_DIR: join(home, "data") },
    stdout: "pipe", stderr: "pipe",
  });
  try {
    // The native catalog resolves its sources once per process: a sessions root that does not exist yet
    // stays INVALID_SOURCE for the rest of that process, hiding every Session native creates later.
    expect(JSON.parse(await firstLine(child.stdout)).sessionAdmission).toBe("admitted");
    expect((await stat(join(home, "sessions"))).isDirectory()).toBe(true);
  } finally {
    child.kill("SIGTERM");
    await child.exited;
    await rm(home, { recursive: true, force: true });
  }
}, 30_000);

async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader(), decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`host exited before it served a stage line: ${buffer}`);
      buffer += decoder.decode(value, { stream: true });
      const newline = buffer.indexOf("\n");
      if (newline >= 0) return buffer.slice(0, newline);
    }
  } finally { await reader.cancel(); }
}
