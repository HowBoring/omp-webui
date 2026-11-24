/** Explicit synthetic native extension; type-only public SDK import does not create a second Session. */
import { appendFile } from "node:fs/promises";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
type Step = { title?: string; placeholder?: string; timeoutMs?: number; afterMs?: number };
const defaultStep: Step = { title: "Strict owned startup cancellation fixture" };
export default function startup(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    const home = process.env.HOME;
    if (!home) throw new Error("SYNTHETIC_HOME_REQUIRED");
    await Bun.write(home + "/strict-extension-effect.json", JSON.stringify({ nativeSessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd }));
    const record = (entry: Record<string, unknown>) => appendFile(home + "/interaction-record.jsonl", JSON.stringify(entry) + "\n");
    const run = async (step: Step, index: number) => {
      const title = step.title ?? defaultStep.title!;
      try {
        let timedOut = false;
        const value = await ctx.ui.input(title, step.placeholder, step.timeoutMs === undefined
          ? undefined : { timeout: step.timeoutMs, onTimeout: () => { timedOut = true; } });
        await record(value === undefined
          ? { step: index, title, outcome: timedOut ? "expired" : "cancelled" }
          : { step: index, title, outcome: "value", value });
      } catch (error) {
        await record({ step: index, title, outcome: "error", error: error instanceof Error ? error.message : String(error) });
        if (index === 0) throw error;
      }
    };
    const loaded = await Bun.file(home + "/interaction-script.json").json().catch(() => null);
    const script: Step[] = Array.isArray(loaded) ? loaded as Step[] : [defaultStep];
    const steps = script.length > 0 ? script : [defaultStep];
    // The first prompt is root/startup scope; later prompts run after the Session binds so they
    // exercise the session-scoped public contract and their own native timeouts.
    // Each later prompt starts only after the previous one settles, so a scenario never stacks cards.
    const proceed = async (index: number) => {
      await run(steps[index]!, index);
      const next = index + 1;
      if (next < steps.length) setTimeout(() => void proceed(next), steps[next]!.afterMs ?? 1_000);
    };
    await run(steps[0] ?? defaultStep, 0);
    if (steps.length > 1) setTimeout(() => void proceed(1), steps[1]!.afterMs ?? 1_000);
  });
}
