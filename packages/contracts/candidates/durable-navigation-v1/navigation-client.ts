/** Public callback client: no native runtime, filesystem, provider, or generic RPC exposure. */
import type { NavigationResult, NavigationPreview, RpcWireCommands } from "./omp-wire";
export type NavigationClientCommand = { [K in "navigate_tree_committed" | "navigation_query" | "navigation_inspect"]:
  { id: string; type: K } & RpcWireCommands[K]["params"] }["navigate_tree_committed" | "navigation_query" | "navigation_inspect"];
export class NavigationClient {
  constructor(readonly request: (command: NavigationClientCommand) => Promise<unknown>,
    readonly validate: (value: unknown) => value is NavigationResult,
    readonly validatePreview: (value: unknown) => value is NavigationPreview) {}
  async inspect(entryId: string): Promise<NavigationPreview> {
    const value = await this.request({ id: crypto.randomUUID(), type: "navigation_inspect", entryId });
    if (!this.validatePreview(value) || value.entryId !== entryId) throw new Error("NAVIGATION_PREVIEW_SCHEMA");
    return value;
  }
  async navigate(params: RpcWireCommands["navigate_tree_committed"]["params"]): Promise<NavigationResult> {
    const value = await this.request({ id: crypto.randomUUID(), type: "navigate_tree_committed", ...params });
    if (!this.validate(value) || value.navigationId !== params.navigationId) throw new Error("NAVIGATION_RESULT_SCHEMA");
    return value;
  }
  async query(navigationId: string): Promise<NavigationResult> {
    const value = await this.request({ id: crypto.randomUUID(), type: "navigation_query", navigationId });
    if (!this.validate(value) || value.navigationId !== navigationId) throw new Error("NAVIGATION_RESULT_SCHEMA");
    return value;
  }
}
