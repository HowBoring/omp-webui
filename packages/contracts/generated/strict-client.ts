/** Narrow public client for deferred rpc-ui identity and ownership startup; no arbitrary command tunnel. */
import type { RpcWireCommands, StrictStartState } from "./omp-wire";
export type StrictCommandName = "strict_start" | "get_strict_state" | "cancel_strict_start";
export type StrictClientCommand = { [K in StrictCommandName]: { id: string; type: K }
  & (RpcWireCommands[K]["params"] extends undefined ? object : RpcWireCommands[K]["params"]) }[StrictCommandName];
export class StrictStartClient {
  constructor(private readonly send: (command: StrictClientCommand) => Promise<unknown>,
    private readonly validate: (value: unknown) => value is StrictStartState) {}
  async #request(command: StrictClientCommand): Promise<StrictStartState> {
    const value = await this.send(command);
    if (!this.validate(value)) throw new Error("STRICT_STATE_SCHEMA");
    if (value.phase === "open" && (!value.binding || !value.nativeSessionId || !value.cwd || !value.intent
      || value.binding.nativeSessionId !== value.nativeSessionId || value.binding.cwd.status !== "known"
      || value.binding.cwd.canonical !== value.cwd)) throw new Error("STRICT_STATE_IDENTITY");
    return value;
  }
  start(options: RpcWireCommands["strict_start"]["params"]): Promise<StrictStartState> {
    return this.#request({ id: crypto.randomUUID(), type: "strict_start", ...options });
  }
  state(): Promise<StrictStartState> { return this.#request({ id: crypto.randomUUID(), type: "get_strict_state" }); }
  cancel(): Promise<StrictStartState> { return this.#request({ id: crypto.randomUUID(), type: "cancel_strict_start" }); }
}
