/** Narrow public history client. Callback transport; no Session/configuration/Agent runtime imports. */
import { validHistoryOpen, validHistoryPage, validHistoryPoll, validHistoryContent } from "./history.generated";
import type { RpcWireCommands, HistoryScope, HistoryOpen, HistoryPage, HistoryPoll, HistoryContentPage } from "./omp-wire";
export type HistoryCommand = { [K in "history_snapshot_open" | "history_snapshot_page" | "history_snapshot_close"
  | "history_observation_poll" | "history_content_page"]: { id: string; type: K } & RpcWireCommands[K]["params"]
}["history_snapshot_open" | "history_snapshot_page" | "history_snapshot_close" | "history_observation_poll" | "history_content_page"];
export class HistoryClient {
  readonly #request: (command: HistoryCommand) => Promise<unknown>;
  constructor(request: (command: HistoryCommand) => Promise<unknown>) { this.#request = request; }
  /** Live handoff permits verified append/prefix progress; pages retain the original cut. Default is strict. */
  async open(scope: HistoryScope, handoff?: "current" | "live"): Promise<HistoryOpen> {
    const result = await this.#request({ id: crypto.randomUUID(), type: "history_snapshot_open", scope, ...(handoff ? { handoff } : {}) });
    if (!validHistoryOpen(result)) throw new Error("HISTORY_RESULT_SCHEMA"); return result;
  }
  async page(cursor: string, before?: number): Promise<HistoryPage> {
    const result = await this.#request({ id: crypto.randomUUID(), type: "history_snapshot_page", cursor,
      ...(before === undefined ? {} : { before }) });
    if (!validHistoryPage(result)) throw new Error("HISTORY_RESULT_SCHEMA"); return result;
  }
  async content(cursor: string): Promise<HistoryContentPage> {
    const result = await this.#request({ id: crypto.randomUUID(), type: "history_content_page", cursor });
    if (!validHistoryContent(result)) throw new Error("HISTORY_RESULT_SCHEMA"); return result;
  }
  async poll(workerId: string, after: number): Promise<HistoryPoll> {
    const result = await this.#request({ id: crypto.randomUUID(), type: "history_observation_poll", workerId, after });
    if (!validHistoryPoll(result)) throw new Error("HISTORY_RESULT_SCHEMA"); return result;
  }
  async close(snapshot: string): Promise<void> {
    const result = await this.#request({ id: crypto.randomUUID(), type: "history_snapshot_close", snapshot });
    if (typeof result !== "object" || result === null || !("closed" in result) || typeof result.closed !== "boolean") throw new Error("HISTORY_RESULT_SCHEMA");
  }
}
