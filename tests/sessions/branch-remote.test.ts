/** Actual HTTP + typed DSH Remote + real native catalog/worker for the Branched Session command. */
import { expect, test } from "bun:test";
import { Context } from "@deepseek-ai/cordis";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSessionComponentServer } from "../../apps/host/src/session-component-server.ts";
import { sessionsContribution } from "../../packages/contracts/sessions.ts";
import { nativeFixture } from "../catalog/fixture.ts";
import { catalog, launch } from "./worker.ts";

const extra = [
  { type: "message", id: "entry-1", parentId: "entry-0", timestamp: "2026-01-01T00:00:02.000Z",
    message: { role: "assistant", content: [{ type: "text", text: "Synthetic answer" }], timestamp: 1767225602000 } },
  { type: "message", id: "entry-2", parentId: "entry-1", timestamp: "2026-01-01T00:00:03.000Z",
    message: { role: "user", content: [{ type: "text", text: "Follow-up question" }], timestamp: 1767225603000 } },
];

test("the public branch command creates and verifies a new native Session for one browser", async () => {
  const home = await mkdtemp(join(tmpdir(), "session-branch-http-")), root = await nativeFixture(home, 2);
  const file = join(root, "bucket", "native-0000.jsonl");
  await Bun.write(file, (await readFile(file, "utf8")) + extra.map(row => JSON.stringify(row)).join("\n") + "\n");
  const discovery = await catalog(home);
  const host = await startSessionComponentServer({ dataDir: join(home, "state"), port: 0, catalog: discovery.catalog,
    manifest: join(home, "missing-manifest"), launcher: join(home, "missing-launcher"), launch: cwd => launch(home, cwd) });
  const origin = host.server.url.origin;
  const client = async () => {
    const exchange = await fetch(host.bootstrapLink(), { redirect: "manual" });
    const cookie = exchange.headers.get("set-cookie")!.split(";")[0]!;
    const csrf = (await (await fetch(origin + "/auth/status", { headers: { cookie } })).json()).csrf as string;
    const ctx = new Context();
    installConnection(ctx, { interactions: "none", transport: { fetch: (url, init) => fetch(new URL(url, origin), {
      ...init, headers: { cookie, origin, "x-omp-csrf": csrf, "content-type": "application/json" } }), openStream: async function* () {} } });
    registry(ctx); gateway(ctx); await ctx.remote.$mount(sessionsContribution);
    return ctx;
  };
  const first = await client(), other = await client();
  try {
    const preview = await first.remote.ompSessions.preview(join(home, "project")); if (!preview.ok) throw preview.error;
    if (!(await first.remote.ompSessions.confirm(preview.value.confirmation)).ok) throw new Error("GRANT_FAILED");
    const listed = await first.remote.ompSessions.catalog({}); if (!listed.ok) throw listed.error;
    const source = listed.value.choices.find(choice => choice.nativeSessionId === "native-0000")!;
    const opened = await first.remote.ompSessions.open(source.selectionId); if (!opened.ok) throw opened.error;
    const points = await first.remote.ompSessions.branchPoints(opened.value.workerId);
    expect(points).toMatchObject({ ok: true, value: { generation: opened.value.generation,
      points: [{ entryId: "entry-0" }, { entryId: "entry-2" }] } });
    const changed = await first.remote.ompSessions.branch({ workerId: opened.value.workerId,
      generation: opened.value.generation, entryId: "entry-2" });
    if (!changed.ok) throw changed.error;
    expect(changed.value).toMatchObject({ status: "created", previousSessionId: "native-0000", targetEntryId: "entry-2",
      retainedEntries: 2, text: "Follow-up question" });
    if (changed.value.status !== "created") throw new Error("BRANCH_NOT_CREATED");
    expect(changed.value.view).toMatchObject({ state: "open", registration: { nativeSessionId: changed.value.nativeSessionId } });
    expect(changed.value.nativeSessionId).not.toBe("native-0000");
    // A stale view never branches: the previous generation is gone with the retired worker.
    expect(await first.remote.ompSessions.branch({ workerId: opened.value.workerId, generation: opened.value.generation,
      entryId: "entry-0" })).toMatchObject({ ok: false, error: { code: "SESSION_MANUAL_OPEN_REQUIRED" } });
    // Both Sessions stay in the catalog for every browser; only the cut one is supervised.
    const after = await other.remote.ompSessions.catalog({}); if (!after.ok) throw after.error;
    expect(after.value.choices.map(choice => choice.nativeSessionId))
      .toEqual(expect.arrayContaining(["native-0000", "native-0001", changed.value.nativeSessionId]));
    expect((await other.remote.ompSessions.branchPoints(opened.value.workerId)).ok).toBe(false);
    expect(host.supervisor.starts).toBe(2);
  } finally {
    await first.fiber.dispose(); await other.fiber.dispose(); await host.stop(); await discovery.close();
    await rm(home, { recursive: true, force: true });
  }
}, 60_000);
