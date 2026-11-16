/** Copied inside the owned OMP package: public self exports resolve to the candidate source. */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import type { AgentToolContext } from "@oh-my-pi/pi-agent-core";
import { AskTool } from "@oh-my-pi/pi-coding-agent/tools/ask";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";

const questions = [{ id: "decision", question: "Synthetic decision?", options: [{ label: "Allow" }, { label: "Deny" }] }];
export default function interactions(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    const answer = await ctx.ui.input("S0 isolated startup interaction");
    ctx.ui.notify(`startup:${answer ?? "cancelled"}`);
  });
  pi.registerCommand("s0-ask", { handler: async (args, ctx) => {
    const result = await ctx.ui.askDialog?.(questions, Number(args) > 0 ? { timeout: Number(args) } : {});
    ctx.ui.notify(`ask:${result === undefined ? "cancelled" : JSON.stringify(result)}`);
  } });
  pi.registerCommand("s0-select", { handler: async (_args, ctx) => {
    const result = await ctx.ui.select("S0 exact approval labels", ["Allow", "Deny"]);
    ctx.ui.notify(`select:${result ?? "cancelled"}`);
  } });
  pi.registerCommand("s0-tool", { handler: async (args, ctx) => runTool(Number(args) || 0, ctx) });
}

async function runTool(timeout: number, ctx: ExtensionContext): Promise<void> {
  // Native tool contract fixture: in-memory settings only, no Agent/provider invocation.
  const settings = Settings.isolated({ "ask.timeout": timeout, "ask.notify": "off", "speech.enabled": false });
  const tool = new AskTool({ cwd: ctx.cwd, hasUI: true, getSessionFile: () => null, getSessionSpawns: () => "*", settings });
  let aborted = false;
  try {
    const result = await tool.execute("synthetic-tool-1", {html:
      '<form><label>Pick<select name="pick"><option selected>default</option><option>chosen</option></select></label>' +
      '<label>Reason<input name="reason" value="default reason"></label></form>'}, undefined, undefined,
      { hasUI: true, ui: ctx.ui, abort: () => { aborted = true; } } as unknown as AgentToolContext);
    ctx.ui.notify(`tool:submitted:${JSON.stringify(result.details)}`);
  } catch {
    ctx.ui.notify(`tool:cancelled:abort=${aborted}`);
  }
}
