import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HistoryTransport } from "../../packages/compatibility/history-transport.ts";

test("Bun history adapter reads real native same-cut scopes and cancellation closes the owned worker", async () => {
  const profile = await mkdtemp(join(tmpdir(), "omp-history-transport-"));
  const control = new AbortController();
  const transport = await HistoryTransport.open({ argv: [process.execPath, "--no-env-file", "--preload",
    resolve("compatibility/omp/fixtures/history-network-guard.js"), resolve("compatibility/omp/fixtures/history-rpc.js")],
    env: { HOME: profile, PI_CODING_AGENT_DIR: profile, OMP_HISTORY_FIXTURE_PROFILE: profile,
      PATH: process.env.PATH ?? "/usr/bin:/bin" }, signal: control.signal });
  try {
    const opened = await transport.history.open("tree");
    const [tree, active] = await Promise.all([
      transport.history.page(opened.cursor), transport.history.page(opened.cursors.active),
    ]);
    expect(tree.cut).toEqual(active.cut);
    expect(tree.cut.sourceBindingStatus).toBe("worker");
    expect(tree.items[0]?.text).toBe("Before native compaction");
    expect(tree.nextCursor).toBeDefined();
    await expect(transport.history.page("foreign")).rejects.toThrow("history_stale_cursor");
    await transport.history.close(opened.snapshot);
    await expect(transport.history.page(opened.cursor)).rejects.toThrow("history_stale_cursor");
    control.abort();
    await expect(transport.history.open("tree")).rejects.toThrow("RPC_CANCELLED");
    const drained = await transport.close();
    expect(drained.protocolFailure).toBe("RPC_CANCELLED");
    expect(drained.forced).toBe(false);
    const audit: unknown = JSON.parse(await readFile(join(profile, "network-audit.json"), "utf8"));
    expect(audit).toMatchObject({ guard: "history-egress-v1", actualNetworkDispatches: 0 });
  } finally { await transport.close(); await rm(profile, { recursive: true, force: true }); }
}, 30_000);
