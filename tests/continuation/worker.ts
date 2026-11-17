/** Fixed isolated native launcher. No executable, argv, profile or raw path comes from a browser. */
import { CatalogTransport } from "../../packages/compatibility/catalog-transport.ts";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { PhysicalFrames } from "../../packages/compatibility/framing.ts";
const frameSchema = z.object({ type: z.string(), id: z.string().optional() }).catchall(z.unknown());
export type StrictFrame = z.infer<typeof frameSchema>;
export function strictWorker(home: string, cwd: string, runtimeArgs: string[] = [], ordinaryFile?: string, fault?: { name: string; target: string }, leaseDirectory?: string) {
  if (fault && !existsSync(resolve("vendor/strict-fixture/native-faults.so"))) throw new Error("STRICT_FIXTURE_FAULT_SHIM_MISSING");
  const child = Bun.spawn([...(fault && fault.name !== "unknown-lease"
    ? [Bun.which("python3") ?? "/usr/bin/python3", resolve("tests/continuation/syscall-faults.py")] : []),
    process.execPath, "--no-env-file", "--preload", resolve("compatibility/omp/fixtures/no-provider.ts"),
    ...(fault ? ["--preload", resolve("tests/continuation/native-faults.ts")] : []),
    resolve("vendor/omp-candidate/cli.js"), "--mode", "rpc-ui", ...(ordinaryFile ? ["--session", ordinaryFile] : ["--strict-start"]), ...runtimeArgs], {
    cwd, env: { HOME: home, PATH: "/usr/bin:/bin", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", TMPDIR: home,
      ...(leaseDirectory ? { PI_TEST_SESSION_OWNERS_DIR: leaseDirectory } : {}),
      ...(fault ? { OMP_STRICT_FIXTURE_HOME: home, OMP_STRICT_FAULT: fault.name, OMP_STRICT_FAULT_TARGET: fault.target, LD_PRELOAD: resolve("vendor/strict-fixture/native-faults.so") } : {}),
      PI_CODING_AGENT_DIR: resolve(home, ".omp/agent"), XDG_CONFIG_HOME: resolve(home, "config"),
      XDG_CACHE_HOME: resolve(home, "cache"), XDG_DATA_HOME: resolve(home, "data"),
      OPENAI_API_KEY: "synthetic-unused-no-provider-calls", NO_COLOR: "1", PI_NOTIFICATIONS: "off" },
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  const frames: StrictFrame[] = [], listeners = new Set<(frame: StrictFrame) => void>();
  const stderr = new Response(child.stderr).text();
  let serial = 0;
  const reader = (async () => {
    const physical = new PhysicalFrames();
    for await (const bytes of child.stdout) for (const value of physical.push(bytes)) {
      const frame = frameSchema.parse(value);
      if (frame.type === "response" && frame.command === "negotiate_protocol" && frame.success === true) physical.negotiate(2);
      frames.push(frame); for (const listener of listeners) listener(frame);
    }
    physical.finish();
  })();
  reader.catch(() => {});
  const wait = async (predicate: (frame: StrictFrame) => boolean): Promise<StrictFrame> => {
    const found = frames.find(predicate); if (found) return found;
    const pending = Promise.withResolvers<StrictFrame>();
    const listener = (frame: StrictFrame) => { if (predicate(frame)) pending.resolve(frame); };
    listeners.add(listener);
    const timer = setTimeout(() => pending.reject(new Error("STRICT_FIXTURE_TIMEOUT")), 10_000);
    void child.exited.then(async code => pending.reject(new Error(`STRICT_FIXTURE_EXIT_${code}: ${(await stderr).slice(0, 1500)}`)));
    try { return await pending.promise; } finally { clearTimeout(timer); listeners.delete(listener); }
  };
  const send = (command: object): void => { child.stdin.write(JSON.stringify(command) + "\n"); };
  const request = (command: object): Promise<StrictFrame> => {
    const id = `strict-${++serial}`; send({ ...command, id }); return wait(frame => frame.type === "response" && frame.id === id);
  };
  return { child, frames, wait, send, request,
    async close() {
      child.stdin.end(); const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      try { const code = await child.exited; await reader; return { code, stderr: await stderr }; }
      finally { clearTimeout(timer); }
    },
  };
}

export async function selectedDescriptor(home: string, leaseDirectory?: string) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000);
  try {
    const client = await CatalogTransport.open({ argv: [process.execPath, "--no-env-file", "--preload",
      resolve("compatibility/omp/fixtures/no-provider.ts"), resolve("vendor/omp-candidate/cli.js"), "--rpc-catalog"],
      env: { HOME: home, PATH: "/usr/bin:/bin", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
        ...(leaseDirectory ? { PI_TEST_SESSION_OWNERS_DIR: leaseDirectory } : {}) }, timeoutMs: 3000,
      signal: controller.signal });
    try {
      let cursor: string | undefined;
      // Scanning can return no items and repeat the same opaque cursor while making progress.
      for (let pages = 0; pages < 64; pages++) {
        const page = await client.catalog.page(cursor === undefined ? {} : { cursor });
        const item = page.items[0]; if (item) return item;
        const failure = page.failures[0]; if (failure) throw new Error(failure.code);
        if (page.status === "partial") throw new Error("STRICT_FIXTURE_CATALOG_PARTIAL");
        if (!page.nextCursor) throw new Error(page.status === "complete"
          ? "STRICT_FIXTURE_DESCRIPTOR_MISSING" : "STRICT_FIXTURE_CATALOG_STALLED");
        cursor = page.nextCursor;
      }
      throw new Error("STRICT_FIXTURE_CATALOG_PAGE_LIMIT");
    } finally { await client.close(); }
  } finally { clearTimeout(timer); }
}
export const isolatedRuntimeArgs = ["--offline", "--provider", "openai", "--model", "gpt-4o", "--no-extensions",
  "--no-skills", "--no-rules", "--no-tools", "--no-context-files"];
export async function negotiateStrict(worker: { wait(predicate: (frame: StrictFrame) => boolean): Promise<StrictFrame>; request(command: object): Promise<StrictFrame> }): Promise<void> {
  await worker.wait(frame => frame.type === "ready");
  await worker.request({ type: "negotiate_protocol", protocolVersion: 2 });
}
