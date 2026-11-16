/** Explicit controlled model and extension boundary, never a real provider. */
import { createAssistantMessageEventStream, type as schemaType } from "@oh-my-pi/pi-ai";
import * as fs from "node:fs";
import * as path from "node:path";
export default function(pi) {
  const home = process.env.HOME;
  if (!home?.includes("submission-") || process.env.PI_CODING_AGENT_DIR !== path.join(home, ".omp/agent"))
    throw Error("synthetic_submission_profile_required");
  const guard = globalThis[Symbol.for("omp.s0.network-guard")];
  if (!guard) throw Error("preimport_network_guard_required");
  process.on("exit", () => fs.writeFileSync(path.join(home, "submission-network-audit.json"), JSON.stringify({
    denied: guard.denied(), actualNetworkDispatches: guard.dispatched(), guard: "preimport-no-provider-v1" })));
  let calls = 0;
  pi.on("input", event => {
    if (event.text === "handled") {
      pi.sendMessage({ customType: "submission-extra", content: "literal handled extra", display: true });
      return { handled: true };
    }
    if (event.text === "transform") {
      pi.sendMessage({ customType: "submission-extra", content: "equal transformed input", display: true });
      return { text: "equal transformed input" };
    }
  });
  let tools = 0;
  pi.registerTool({name:"submission_fixture_tool", label:"Synthetic submission tool", description:"Controlled literal fixture effect",
    parameters:schemaType({}), async execute() {
      fs.writeFileSync(path.join(home, "submission-tool-effects.json"), JSON.stringify({executions:++tools}));
      return {content:[{type:"text", text:"literal controlled tool result"}]};
    }});
  pi.registerProvider("submission-controlled", {
    baseUrl: "https://forbidden.invalid", apiKey: "synthetic-unused", api: "submission-controlled",
    models: [{ id: "literal", name: "Literal controlled fixture", reasoning: false, input: ["text"],
      contextWindow: 128000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      if (model.provider !== "submission-controlled" || model.id !== "literal") throw Error("unexpected_fixture_provider");
      fs.writeFileSync(path.join(home, "submission-provider-effects.json"), JSON.stringify({ calls: ++calls, realInference: false }));
      const user = context.messages.findLast(item => item.role === "user");
      const userText = typeof user?.content === "string" ? user.content : user?.content?.filter(item => item.type === "text").map(item => item.text).join("\n");
      const stream = createAssistantMessageEventStream();
      const message = { role: "assistant", api: "submission-controlled", provider: "submission-controlled", model: "literal",
        timestamp: Date.now(), stopReason: "stop", content: [{ type: "text", text: "literal fixture response" }],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      void (async () => {
        stream.push({ type: "start", partial: message });
        await Bun.sleep(100);
        if (userText === "tool" && context.messages.at(-1)?.role !== "toolResult") {
          const toolCall = {type:"toolCall", id:"literal-tool-id", name:"submission_fixture_tool", arguments:{}};
          message.content = [toolCall]; message.stopReason = "toolUse";
          stream.push({type:"toolcall_start", contentIndex:0, partial:message});
          stream.push({type:"toolcall_end", contentIndex:0, toolCall, partial:message});
          stream.push({type:"done", reason:"toolUse", message}); stream.end(); return;
        }
        if (userText === "empty-error" || userText === "refusal") {
          message.content = userText === "empty-error" ? [] : [{type:"text", text:"literal refusal"}];
          message.stopReason = "error";
          message.errorMessage = "literal non-retryable fixture error";
          if (userText === "refusal") message.stopDetails = {type:"refusal"};
          stream.push({type:"error", reason:"error", error:message}); stream.end(); return;
        }
        stream.push({ type: "text_start", contentIndex: 0, partial: message });
        stream.push({ type: "text_delta", contentIndex: 0, delta: "literal fixture response", partial: message });
        stream.push({ type: "text_end", contentIndex: 0, content: "literal fixture response", partial: message });
        stream.push({ type: "done", reason: "stop", message }); stream.end();
      })();
      return stream;
    },
  });
}
