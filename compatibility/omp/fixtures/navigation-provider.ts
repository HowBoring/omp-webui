/** Explicit controlled model/hook boundary for durable navigation fixtures, never a real provider. */
import { createAssistantMessageEventStream } from "@oh-my-pi/pi-ai";
import * as fs from "node:fs";
import * as path from "node:path";

export default function (pi) {
  const home = process.env.HOME;
  if (!home?.includes("navigation-") || process.env.PI_CODING_AGENT_DIR !== path.join(home, ".omp/agent")) {
    throw Error("synthetic_navigation_profile_required");
  }
  const guard = globalThis[Symbol.for("omp.s0.network-guard")];
  if (!guard) throw Error("preimport_network_guard_required");
  const hooks = { before: 0, tree: 0 };
  process.on("exit", () => fs.writeFileSync(path.join(home, "navigation-network-audit.json"), JSON.stringify({
    denied: guard.denied(), actualNetworkDispatches: guard.dispatched(), guard: "preimport-no-provider-v1" })));

  pi.on("session_before_tree", async () => {
    fs.writeFileSync(path.join(home, "navigation-hooks.json"), JSON.stringify(hooks));
    const mode = process.env.OMP_NAVIGATION_HOOK ?? "";
    if (mode === "hold") {
      fs.writeFileSync(path.join(home, "navigation-hook-held.json"), JSON.stringify({ entered: true }));
      const deadline = Date.now() + 30_000;
      while (!fs.existsSync(path.join(home, "navigation-hook-release"))) {
        if (Date.now() > deadline) throw Error("NAVIGATION_HOOK_FIXTURE_RELEASE_TIMEOUT");
        await Bun.sleep(10);
      }
      return undefined;
    }
    if (mode === "cancel") return { cancel: true };
    if (mode === "summary") return { summary: "Hook-derived fixture summary" };
    return undefined;
  });
  pi.on("session_tree", async () => {
    hooks.tree++;
    fs.writeFileSync(path.join(home, "navigation-hooks.json"), JSON.stringify(hooks));
  });

  let calls = 0;
  pi.registerProvider("navigation-controlled", {
    baseUrl: "https://forbidden.invalid", apiKey: "synthetic-unused", api: "navigation-controlled",
    models: [{ id: "literal", name: "Literal navigation fixture", reasoning: false, input: ["text"],
      contextWindow: 128000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      if (model.provider !== "navigation-controlled" || model.id !== "literal") throw Error("unexpected_fixture_provider");
      fs.writeFileSync(path.join(home, "navigation-provider-effects.json"), JSON.stringify({ calls: ++calls, realInference: false }));
      const last = context.messages.at(-1);
      const text = typeof last?.content === "string" ? last.content
        : last?.content?.filter(item => item.type === "text").map(item => item.text).join("\n") ?? "";
      const stream = createAssistantMessageEventStream();
      const message = { role: "assistant", api: "navigation-controlled", provider: "navigation-controlled", model: "literal",
        timestamp: Date.now(), stopReason: "stop", content: [{ type: "text", text: `literal fixture response ${text.length}` }],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      void (async () => {
        stream.push({ type: "start", partial: message });
        await Bun.sleep(20);
        stream.push({ type: "text_start", contentIndex: 0, partial: message });
        stream.push({ type: "text_delta", contentIndex: 0, delta: message.content[0].text, partial: message });
        stream.push({ type: "text_end", contentIndex: 0, content: message.content[0].text, partial: message });
        stream.push({ type: "done", reason: "stop", message });
        stream.end();
      })();
      return stream;
    },
  });
}
