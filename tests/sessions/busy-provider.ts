/** Explicit deterministic native-system fixture; no real inference, network, tools, subprocesses or user data. */
import { createAssistantMessageEventStream, type as schemaType } from "@oh-my-pi/pi-ai";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import * as fs from "node:fs";
import * as path from "node:path";
export default function busy(pi: ExtensionAPI): void {
  const home = process.env.HOME!;
  if (!home.startsWith("/tmp/session-supervisor-") || !process.env.OMP_SESSION_BUSY) throw new Error("SYNTHETIC_BUSY_PROFILE_REQUIRED");
  const mode = process.env.OMP_SESSION_BUSY;
  const facts = { calls: 0, toolStarted: false, abortObserved: false, termObserved: false, termAt: 0, actualNetworkDispatches: 0 };
  const guard = Reflect.get(globalThis, Symbol.for("omp.s0.network-guard"));
  const record = () => {
    facts.actualNetworkDispatches = guard.dispatched();
    fs.writeFileSync(path.join(home, "busy-fixture-audit.json"), JSON.stringify(facts));
  };
  process.on("exit", record);
  if (mode === "stubborn") process.on("SIGTERM", () => { facts.termObserved = true; facts.termAt = Date.now(); record(); });
  pi.registerTool({ name: "s1_noncooperative", label: "Synthetic uncooperative tool", description: "Synthetic no-effects busy proof",
    parameters: schemaType({}), async execute(_id, _parameters, signal) {
      facts.toolStarted = true; record();
      signal?.addEventListener("abort", () => { facts.abortObserved = true; record(); }, { once: true });
      setInterval(() => {}, 1000);
      await new Promise<never>(() => {}); return { content: [] };
    } });
  pi.registerProvider("s1-controlled", { baseUrl: "https://forbidden.invalid", apiKey: "synthetic-in-process-only", api: "s1-controlled",
    models: [{ id: "busy", name: "Synthetic busy worker", reasoning: false, input: ["text"],
      contextWindow: 32768, maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, _context, options) {
      facts.calls++; record();
      const stream = createAssistantMessageEventStream();
      const partial: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
        content: [{ type: "text", text: "Synthetic busy native stream" }], timestamp: 1, stopReason: "stop",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      if (mode === "stubborn") {
        const toolCall = { type: "toolCall" as const, id: "synthetic-busy-tool", name: "s1_noncooperative", arguments: {} };
        partial.content = [toolCall]; partial.stopReason = "toolUse";
        stream.push({ type: "start", partial }); stream.push({ type: "toolcall_start", contentIndex: 0, partial });
        stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial });
        stream.push({ type: "done", reason: "toolUse", message: partial }); stream.end(); return stream;
      }
      stream.push({ type: "start", partial }); stream.push({ type: "text_start", contentIndex: 0, partial });
      const interval = setInterval(() => {}, 1000);
      options?.signal?.addEventListener("abort", () => {
        facts.abortObserved = true; record();
        if (mode === "stubborn") return;
        clearInterval(interval); partial.stopReason = "aborted";
        stream.push({ type: "error", reason: "aborted", error: partial }); stream.end();
      }, { once: true });
      return stream;
    },
  });
  // Fixture-only literal input is scheduled by a deliberately installed native extension, after final startup binding.
  pi.on("session_start", () => {
    const ready = setInterval(() => {
      if (!fs.existsSync(path.join(home, "start-busy-fixture"))) return;
      clearInterval(ready); void pi.sendUserMessage("Synthetic native busy proof").catch(() => {});
    }, 25);
  });
}
