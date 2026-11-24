import { Context } from "@deepseek-ai/cordis";
import { apply as connection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { navigationFixtureContribution, type NavigationFixtureSnapshot, type NavigationFixtureTreeItem } from "../../../packages/contracts/navigation-fixture.ts";
import { historyNavigationSourceContribution } from "../../../packages/contracts/history-navigation-source.ts";
import type { HistoryNavigationSourceResult } from "../../../packages/contracts/history-navigation-source.ts";

const ctx = new Context();
const state = document.querySelector<HTMLElement>("#state")!;
const tree = document.querySelector<HTMLElement>("#tree")!;
const detail = document.querySelector<HTMLElement>("#detail")!;
const summary = document.querySelector<HTMLElement>("#summary")!;
let snapshot: NavigationFixtureSnapshot | undefined;
let selected: NavigationFixtureTreeItem | undefined;
let token: string | undefined;
let navigationId: string | undefined;
let disposed = false;

const text = (tag: string, value: string): HTMLElement => { const node = document.createElement(tag); node.textContent = value; return node; };
const result = (value: unknown): string => JSON.stringify(value);

function renderTree(): void {
  if (!snapshot) return;
  tree.dataset.status = snapshot.phase;
  tree.dataset.active = snapshot.activeId ?? "";
  state.textContent = `phase ${snapshot.phase}; starts ${snapshot.starts}; session ${snapshot.sessionId.slice(0, 8)}; active ${snapshot.activeId?.slice(0, 8) ?? "none"}; hooks ${snapshot.hooks ? `${snapshot.hooks.before}/${snapshot.hooks.tree}` : "unread"}; provider calls ${snapshot.providerCalls ?? "unread"}`;
  tree.replaceChildren(...snapshot.tree.map(item => {
    const row = document.createElement("li");
    row.dataset.id = item.id; row.dataset.kind = item.kind; row.dataset.active = String(item.active);
    if (item.entryId) row.dataset.entry = item.entryId;
    if (item.role) row.dataset.role = item.role;
    const button = document.createElement("button");
    button.textContent = `${item.active ? "● " : ""}${item.kind}${item.role ? `:${item.role}` : ""} ${item.id.slice(0, 8)}`;
    button.disabled = !item.entryId;
    button.addEventListener("click", () => { selected = item; detail.textContent = `selected ${item.id} entry ${item.entryId}`; });
    row.append(button, text("p", item.text?.slice(0, 160) ?? ""));
    return row;
  }));
}

function show(result: HistoryNavigationSourceResult): void {
  if (result.status === "confirmation") {
    token = result.token; navigationId = result.navigationId;
    detail.dataset.status = "confirmation";
    detail.textContent = `confirmation ${result.navigationId.slice(0, 8)} target ${result.entryId.slice(0, 8)} parent ${result.targetParentId?.slice(0, 8) ?? "root"} expires ${result.expiresAt} options ${result.options} notice ${result.notice}`;
    return;
  }
  if (result.status === "cancelled") { detail.textContent = "cancelled"; return; }
  if (result.status === "error") { detail.dataset.status = "error"; detail.textContent = `error ${result.code}`; return; }
  token = undefined; navigationId = result.navigationId;
  detail.dataset.status = "operation";
  detail.dataset.outcome = result.outcome; detail.dataset.persistence = result.persistence;
  detail.dataset.projection = result.projection;
  if (result.commitId) detail.dataset.commitId = result.commitId;
  if (result.actualLeafId) detail.dataset.actualLeafId = result.actualLeafId;
  detail.textContent = `${result.outcome} / ${result.persistence} / projection ${result.projection} / commit ${result.commitId?.slice(0, 8) ?? "none"} / native leaf ${result.actualLeafId?.slice(0, 8) ?? "none"} / draft ${result.draft ? result.draft.originEntryId.slice(0, 8) : result.draftUnavailable ?? "none"}${result.nativeCode ? ` / code ${result.nativeCode}` : ""}`;
}

async function refresh(): Promise<void> {
  const result = await ctx.remote.ompNavigationFixture.snapshot();
  if (!result.ok || disposed) return;
  snapshot = result.value; renderTree(); selected = undefined; token = undefined;
  summary.textContent = `${snapshot.phase}: ${snapshot.tree.length} items; active ${snapshot.activeId ?? "none"}`;
}

async function action(options: Parameters<typeof ctx.remote.ompHistoryNavigationSource.action>[0]): Promise<void> {
  const result = await ctx.remote.ompHistoryNavigationSource.action(options);
  if (!disposed) show(result.ok ? result.value : { status: "error", code: "navigation_unavailable" });
}

async function act(type: "crash" | "reopen"): Promise<void> {
  const result = await ctx.remote.ompNavigationFixture.act({ type });
  if (!result.ok || disposed) return;
  snapshot = result.value; renderTree();
  summary.textContent = `${type}: phase ${snapshot.phase}; starts ${snapshot.starts}`;
  if (type === "reopen") {
    await refresh();
    if (navigationId) await action({ operation: "query", sessionId: snapshot!.sessionId, navigationId });
    summary.textContent = `${snapshot!.phase}: reopened; native active ${snapshot!.activeId ?? "none"} matches ${navigationId?.slice(0, 8) ?? "no prior navigation"}`;
  }
}

document.querySelector("#refresh")!.addEventListener("click", () => void refresh());
document.querySelector("#confirm")!.addEventListener("click", () => { if (token) void action({ operation: "confirm", token }); });
document.querySelector("#query")!.addEventListener("click", () => {
  if (navigationId && snapshot) void action({ operation: "query", sessionId: snapshot.sessionId, navigationId });
});
document.querySelector("#crash")!.addEventListener("click", () => void act("crash"));
document.querySelector("#reopen")!.addEventListener("click", () => void act("reopen"));
document.querySelector("#inspect")!.addEventListener("click", () => {
  if (selected?.entryId && snapshot) void action({ operation: "inspect", sessionId: snapshot.sessionId, entryId: selected.entryId });
});

async function boot(): Promise<void> {
  connection(ctx); registry(ctx); gateway(ctx);
  await ctx.remote.$mount(navigationFixtureContribution);
  await ctx.remote.$mount(historyNavigationSourceContribution);
  const unsubscribe = ctx.connection.generation.subscribe(() => {
    if (ctx.connection.generation.getSnapshot() !== undefined) void refresh();
    else tree.dataset.status = "disconnected";
  });
  ctx.effect(() => unsubscribe);
  if (ctx.connection.generation.getSnapshot() !== undefined) await refresh();
  summary.textContent = "ready: choose a history point";
}
window.addEventListener("pagehide", () => { disposed = true; void ctx.fiber.dispose(); }, { once: true });
void boot().catch(error => { tree.dataset.status = "blocked"; summary.textContent = `navigation_boot_failed ${String(error)}`; });
