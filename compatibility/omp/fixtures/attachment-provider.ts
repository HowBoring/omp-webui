/** Isolated actual OMP extension/provider seam. No network or real inference is permitted. */
import * as fs from "node:fs";
import * as path from "node:path";
import { createAssistantMessageEventStream, type as schemaType } from "@oh-my-pi/pi-ai";
import type { AssistantMessage, Context } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

interface Capture {
  images: { mimeType: string; sha256: string; bytes: number }[];
  text: { role: string; sha256: string }[];
}
interface Effects {
  inputCalls: number; modelAttempts: number; modelDispatches: number; toolCalls: number; blockedPayloads: number;
  scenario: string; additionalSent: boolean; requests: Capture[];
}
function capture(context: Context): Capture {
  const images: Capture["images"] = [], text: Capture["text"] = [];
  for (const message of context.messages) {
    if (typeof message.content === "string") text.push({ role: message.role, sha256: Bun.SHA256.hash(message.content, "hex") });
    else for (const part of message.content) {
      if (part.type === "image") images.push({ mimeType: part.mimeType,
        sha256: Bun.SHA256.hash(Buffer.from(part.data, "base64"), "hex"), bytes: Buffer.byteLength(part.data, "base64") });
      if (part.type === "text") text.push({ role: message.role, sha256: Bun.SHA256.hash(part.text, "hex") });
    }
  }
  return { images, text };
}
function write(home: string, state: Effects): void {
  const { scenario: _scenario, additionalSent: _additionalSent, ...effects } = state;
  fs.writeFileSync(path.join(home, "attachment-effects.json"), JSON.stringify(effects));
}
function inputs(pi: ExtensionAPI, home: string, state: Effects): void {
  pi.on("input", event => {
    state.inputCalls++; state.scenario = event.text; write(home, state);
    if (event.text === "handled") {
      pi.sendMessage({ customType: "attachment-extra", content: "Controlled handled input effect", display: true });
      return { handled: true };
    }
    if (event.text === "transform") return { text: "transformed native prose" };
    if (event.text === "clone-images") return { images: event.images?.map(image => ({ ...image })) };
    if (event.text === "drop-images") return { images: [] };
  });
  pi.on("context", event => {
    if (state.scenario === "context-drop") return { messages: event.messages.filter(message => message.role !== "fileMention") };
    return undefined;
  });
  pi.on("before_agent_start", event => {
    if (event.prompt !== "additional-user" || state.additionalSent) return;
    state.additionalSent = true;
    void pi.sendUserMessage("Controlled additional user", { deliverAs: "followUp" });
  });
  pi.on("before_provider_request", event => state.scenario === "payload-rewrite" ? { replaced: event.payload } : undefined);
}
function provider(pi: ExtensionAPI, home: string, state: Effects): void {
  pi.registerProvider("attachment-controlled", {
    baseUrl: "https://forbidden.invalid", apiKey: "synthetic-unused", api: "attachment-controlled",
    models: [{ id: "literal", name: "Controlled attachment fixture", reasoning: false, input: ["text", "image"],
      contextWindow: 128000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context, options) {
      state.modelAttempts++; write(home, state);
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = { role: "assistant", api: "attachment-controlled", provider: "attachment-controlled",
        model: "literal", timestamp: Date.now(), stopReason: "stop", content: [{ type: "text", text: "Controlled attachment response" }],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      void (async () => {
        try {
          if (model.provider !== "attachment-controlled" || model.id !== "literal") throw new Error("UNEXPECTED_FIXTURE_MODEL");
          if (options?.onPayload) await options.onPayload({ model: model.id, messages: context.messages }, model);
          options?.signal?.throwIfAborted();
          state.modelDispatches++; state.requests.push(capture(context)); write(home, state);
          stream.push({ type: "start", partial: message });
          await Bun.sleep(50);
          if (state.scenario === "tool" && context.messages.at(-1)?.role !== "toolResult") {
            const toolCall = { type: "toolCall" as const, id: "attachment-tool", name: "attachment_fixture_tool", arguments: {} };
            message.content = [toolCall]; message.stopReason = "toolUse";
            stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
            stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
            stream.push({ type: "done", reason: "toolUse", message });
          } else stream.push({ type: "done", reason: "stop", message });
        } catch {
          state.blockedPayloads++; write(home, state);
          message.content = []; message.stopReason = "error"; message.errorMessage = "Controlled provider payload refused";
          stream.push({ type: "error", reason: "error", error: message });
        } finally { stream.end(); }
      })();
      return stream;
    },
  });
}
export default function attachmentFixture(pi: ExtensionAPI): void {
  const home = process.env.HOME;
  if (!home?.includes("attachment-") || process.env.PI_CODING_AGENT_DIR !== path.join(home, ".omp/agent")) {
    throw new Error("SYNTHETIC_ATTACHMENT_PROFILE_REQUIRED");
  }
  if (!Reflect.get(globalThis, Symbol.for("omp.s0.network-guard"))) throw new Error("PREIMPORT_EGRESS_GUARD_REQUIRED");
  const state: Effects = { inputCalls: 0, modelAttempts: 0, modelDispatches: 0, toolCalls: 0, blockedPayloads: 0,
    scenario: "", additionalSent: false, requests: [] };
  write(home, state); inputs(pi, home, state); provider(pi, home, state);
  pi.registerTool({ name: "attachment_fixture_tool", label: "Controlled attachment tool", description: "Isolated literal tool effect",
    parameters: schemaType({}), async execute() {
      state.toolCalls++; write(home, state);
      return { content: [{ type: "text", text: "Controlled tool result" }] };
    } });
}
