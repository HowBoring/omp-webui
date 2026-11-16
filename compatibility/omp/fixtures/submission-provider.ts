/** Explicit controlled model and extension boundary, never a real provider. */
import { createAssistantMessageEventStream } from "@oh-my-pi/pi-ai";
import * as fs from "node:fs";
import * as path from "node:path";
export default function(pi) {
  const home = process.env.HOME;
  if (!home?.includes("submission-") || process.env.PI_CODING_AGENT_DIR !== path.join(home, ".omp/agent"))
    throw Error("synthetic_submission_profile_required");
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
  pi.registerProvider("submission-controlled", {
    baseUrl: "https://forbidden.invalid", apiKey: "synthetic-unused", api: "submission-controlled",
    models: [{ id: "literal", name: "Literal controlled fixture", reasoning: false, input: ["text"],
      contextWindow: 128000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      if (model.provider !== "submission-controlled" || model.id !== "literal") throw Error("unexpected_fixture_provider");
      fs.writeFileSync(path.join(home, "submission-provider-effects.json"), JSON.stringify({ calls: ++calls, realInference: false }));
      const stream = createAssistantMessageEventStream();
      const message = { role: "assistant", api: "submission-controlled", provider: "submission-controlled", model: "literal",
        timestamp: Date.now(), stopReason: "stop", content: [{ type: "text", text: "literal fixture response" }],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      void (async () => {
        stream.push({ type: "start", partial: message });
        await Bun.sleep(100);
        stream.push({ type: "text_start", contentIndex: 0, partial: message });
        stream.push({ type: "text_delta", contentIndex: 0, delta: "literal fixture response", partial: message });
        stream.push({ type: "text_end", contentIndex: 0, content: "literal fixture response", partial: message });
        stream.push({ type: "done", reason: "stop", message }); stream.end();
      })();
      return stream;
    },
  });
}
