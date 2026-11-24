import { expect, test } from "bun:test";
import { Context } from "@deepseek-ai/cordis";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { attachmentsContribution, attachmentSelectionSchema } from "../../packages/contracts/attachment-remote.ts";

test("public attachment Remote accepts only scoped controlled original identities", async () => {
  const selection = { session: "projection", draftId: "draft", revision: "1", originalIds: ["b", "a", "b"] };
  expect(attachmentSelectionSchema.safeParse({ ...selection, path: "/tmp/file" }).success).toBe(false);
  expect(attachmentSelectionSchema.safeParse({ ...selection, sourceId: "browser-selected" }).success).toBe(false);
  const ctx = new Context();
  installConnection(ctx, { interactions: "none", transport: {
    async fetch(url, init) {
      expect(url).toBe("api/ompAttachments/begin");
      const envelope = zEnvelope(JSON.parse(String(init.body)));
      expect(envelope.payload.args).toEqual({ request: { selection, submissionId: "attempt", requestId: "dsh-request" } });
      return Response.json({ type: "server-response", rpcId: envelope.rpcId, result: { ok: true, value: { registered: true } } });
    }, openStream: async function* () {},
  } });
  registry(ctx); gateway(ctx); await ctx.remote.$mount(attachmentsContribution);
  try { expect(await ctx.remote.ompAttachments.begin({ selection, submissionId: "attempt", requestId: "dsh-request" }))
    .toEqual({ ok: true, value: { registered: true } }); }
  finally { await ctx.fiber.dispose(); }
});
function zEnvelope(value: unknown): { rpcId: string; payload: { args: unknown } } {
  if (!value || typeof value !== "object" || !("rpcId" in value) || typeof value.rpcId !== "string" ||
    !("payload" in value) || !value.payload || typeof value.payload !== "object" || !("args" in value.payload)) throw Error("invalid envelope");
  return { rpcId: value.rpcId, payload: { args: value.payload.args } };
}
