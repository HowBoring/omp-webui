/** Explicit synthetic native extension; type-only public SDK import does not create a second Session. */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
export default function startup(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    const home = process.env.HOME;
    if (!home) throw new Error("SYNTHETIC_HOME_REQUIRED");
    await Bun.write(home + "/strict-extension-effect.json", JSON.stringify({ nativeSessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd }));
    await ctx.ui.input("Strict owned startup cancellation fixture");
  });
}
