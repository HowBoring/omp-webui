/** Fixed isolated native launcher. No executable, argv, profile or raw path comes from a browser. */
import { CatalogTransport } from "../../packages/compatibility/catalog-transport.ts";
import { resolve } from "node:path";
import { z } from "zod";
import { PhysicalFrames } from "../../packages/compatibility/framing.ts";
const frameSchema = z.object({ type: z.string(), id: z.string().optional() }).catchall(z.unknown());
export type StrictFrame = z.infer<typeof frameSchema>;
export function strictWorker(home: string, cwd: string, runtimeArgs: string[] = []) {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", resolve("compatibility/omp/fixtures/no-provider.ts"),
    resolve("vendor/omp-candidate/cli.js"), "--mode", "rpc-ui", "--strict-start", ...runtimeArgs], {
    cwd, env: { HOME: home, PATH: "/usr/bin:/bin", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", TMPDIR: home,
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

export async function selectedDescriptor(home: string) {
  const client = await CatalogTransport.open({ argv: [process.execPath, "--no-env-file", "--preload",
    resolve("compatibility/omp/fixtures/no-provider.ts"), resolve("vendor/omp-candidate/cli.js"), "--rpc-catalog"],
    env: { HOME: home, PATH: "/usr/bin:/bin", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" }, timeoutMs: 3000 });
  try {
    const page = await client.catalog.page();
    const item = page.items[0]; if (!item) throw new Error("STRICT_FIXTURE_DESCRIPTOR_MISSING"); return item;
  } finally { await client.close(); }
}
export const isolatedRuntimeArgs = ["--offline", "--provider", "openai", "--model", "gpt-4o", "--no-extensions",
  "--no-skills", "--no-rules", "--no-tools", "--no-context-files"];
export async function negotiateStrict(worker: { wait(predicate: (frame: StrictFrame) => boolean): Promise<StrictFrame>; request(command: object): Promise<StrictFrame> }): Promise<void> {
  await worker.wait(frame => frame.type === "ready");
  await worker.request({ type: "negotiate_protocol", protocolVersion: 2 });
}
