/** The product attach endpoint must reach the decorated enrollment; a declined view is a typed failure, not an absent value. */
import { expect, test } from "bun:test";
import { z } from "zod";
import { Context } from "@deepseek-ai/cordis";
import TypertRegistry from "@deepseek-ai/dsh-typert-registry";
import RemoteAccessService from "@deepseek-ai/dsh-api-remote-access";
import { TypertGatewayService } from "@deepseek-ai/dsh-api-gateway";
import { Peer, clientRequestSchema } from "@deepseek-ai/dsh-client-connection";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { chatComponentContribution, chatComponentHostContribution,
  type ChatAttachment, type ChatAttachmentResult } from "../../packages/contracts/chat-component.ts";
import { ChatAttachService } from "../../packages/chat/service.ts";

const input: ChatAttachment = { workerId: "worker", projection: { source: "live-journal", generation: "g1" }, draftId: "draft" };
const attached: ChatAttachmentResult = { owner: "owner", workerId: "worker", sessionId: "native", generation: "g1", draftId: "draft" };

async function fixture(attachView: (input: ChatAttachment) => ChatAttachmentResult | undefined) {
  const host = new Context(), client = new Context();
  await host.plugin(TypertRegistry); await host.plugin(RemoteAccessService); await host.plugin(TypertGatewayService, {});
  host.typert.register(chatComponentHostContribution);
  const service = new ChatAttachService(host, attachView);
  const peer = new Peer(host, { principal: { kind: "owner" }, interactions: "none" });
  installConnection(client, { interactions: "none", transport: {
    async fetch(_url, init) {
      const call = clientRequestSchema.parse(JSON.parse(String(init.body)));
      const method = Object.values(chatComponentContribution.methods)
        .find(value => `${value.namespace}/${value.method}` === call.method);
      if (!method) throw Error("unexpected endpoint");
      const payload = z.strictObject({ args: z.record(z.string(), z.unknown()) }).parse(call.payload);
      try {
        const value = await host.typertGateway.invoke({ namespace: method.namespace, method: method.method,
          args: payload.args, peer });
        return Response.json({ type: "server-response", rpcId: call.rpcId, result: { ok: true, value } });
      } catch (error) {
        return Response.json({ type: "server-response", rpcId: call.rpcId,
          result: { ok: false, error: { code: "gateway/bad-request",
            message: error instanceof Error ? error.message : "attach failed", details: {} } } });
      }
    }, openStream: async function* () {},
  } });
  registry(client); gateway(client); await client.remote.$mount(chatComponentContribution);
  return { service, remote: client.remote.ompChatComponent,
    dispose: async () => { await client.fiber.dispose(); await peer.dispose(); await host.fiber.dispose(); } };
}

test("attach invokes the enrollment behind the exported endpoint", async () => {
  const f = await fixture(() => attached);
  try {
    expect(chatComponentHostContribution.invocations.find(value => value.method === "attach")?.implementation).toBe("enroll");
    expect(Reflect.get(f.service, "attach")).toBeUndefined();
    expect(await f.remote.attach(input)).toEqual({ ok: true, value: attached });
  } finally { await f.dispose(); }
});

test("a declined view fails the call instead of answering with an absent value", async () => {
  const f = await fixture(() => undefined);
  try {
    const result = await f.remote.attach(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("No live Session worker is available to attach.");
  } finally { await f.dispose(); }
});
