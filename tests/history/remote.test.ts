/** Explicit DSH public Remote fault fixture; actual native browser proof is history-browser.py. */
import { test, expect } from "bun:test";
import { Context } from "@deepseek-ai/cordis";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { historyContribution } from "../../packages/contracts/history.ts";

test("public typed history Remote rejects malformed private payloads and refuses disposed calls", async () => {
  const ctx = new Context();
  installConnection(ctx, { interactions: "none", transport: {
    async fetch(_url, init) {
      const call: { rpcId: string } = JSON.parse(String(init.body)) as { rpcId: string };
      return Response.json({ type: "server-response", rpcId: call.rpcId, result: { ok: true, value: {
        status: "error", code: "history_stale_cursor", internalConfig: "SYNTHETIC_PRIVATE_STATE",
      } } });
    }, openStream: async function* () {},
  } });
  registry(ctx); gateway(ctx);
  const dispose = await ctx.remote.$mount(historyContribution);
  try {
    expect((await ctx.remote.ompHistoryFixture.read({ operation: "page", cursor: "opaque" })).ok).toBe(false);
    const captured = ctx.remote.ompHistoryFixture.read;
    await dispose();
    expect((await captured({ operation: "open", scope: "tree" })).ok).toBe(false);
  } finally { await ctx.fiber.dispose(); }
});
