import { Context } from "@deepseek-ai/cordis";
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import { apply as connection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { historyContribution } from "../../../packages/contracts/history.ts";
import type { HistoryRequest, HistoryResult } from "../../../packages/contracts/history.ts";
import type { HistoryOpen, HistoryScope, HistoryItem, HistoryContent } from "../../../packages/contracts/generated/omp-wire.ts";
declare module "@deepseek-ai/cordis" { interface Context { connection: ConnectionHandle } }
const ctx = new Context();
function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector); if (!found) throw new Error("missing_fixture_mount"); return found;
}
const state = element("#state"), list = element("#history");
const more = element<HTMLButtonElement>("#more"), scope = element<HTMLSelectElement>("#scope");
let opened: HistoryOpen | undefined, cursor: string | undefined, revision = 0, disposed = false, busyRevision: number | undefined;
const rows = new Map<string, HTMLElement>();
const urls = new Set<string>();
function status(value: string): void { state.textContent = value; state.dataset.status = value.startsWith("history_") ? "error" : "ready"; }
async function read(options: HistoryRequest): Promise<HistoryResult> {
  const result = await ctx.remote.ompHistoryFixture.read(options);
  if (!result.ok) throw new Error("history_remote_failed"); return result.value;
}
function fail(): void { cursor = undefined; more.disabled = true; status("history_read_failed: request a new observation"); }
function clear(): void {
  list.replaceChildren(); rows.clear(); for (const url of urls) URL.revokeObjectURL(url); urls.clear();
}
async function preview(content: HistoryContent, mount: HTMLElement, current: number): Promise<void> {
  if (content.bytes > 64 * 1024 * 1024) throw new Error("history_preview_bytes");
  let next: string | undefined = content.cursor;
  const chunks: string[] = [];
  while (next) {
    const result = await read({ operation: "content", cursor: next });
    if (current !== revision || disposed) return;
    if (result.status !== "content" || result.value.cut.contentRevision !== opened?.cut.contentRevision) throw new Error("history_content_changed");
    chunks.push(result.value.data); next = result.value.nextCursor;
  }
  const binary = atob(chunks.join(""));
  if (binary.length !== content.bytes) throw new Error("history_content_size");
  const url = URL.createObjectURL(new Blob([Uint8Array.from(binary, value => value.charCodeAt(0))], {type:content.mimeType}));
  urls.add(url); const image = document.createElement("img"); image.src = url; image.alt = "Retained native representation; original association unproven";
  image.style.maxWidth = "100%"; mount.append(image);
}
function render(item: HistoryItem): void {
  const id = item.entryId ?? item.id;
  let row = rows.get(id);
  if (!row) {
    row = document.createElement("li"); row.dataset.entry = id; row.dataset.parent = item.parentId ?? "root";
    row.dataset.active = String(item.active); row.className = item.boundary ? "boundary" : "entry";
    if (item.boundary && scope.value === "active" && list.childNodes.length > 0) {
      const fold = document.createElement("details"), summary = document.createElement("summary"), retained = document.createElement("ol");
      summary.textContent = `Expand retained history before native ${item.boundary} boundary`;
      while (list.firstChild) retained.append(list.firstChild);
      fold.append(summary, retained); list.append(fold);
    }
    rows.set(id, row); list.append(row);
    for (const content of item.contents ?? []) {
      const button = document.createElement("button"); button.textContent = `Preview retained ${content.mimeType} (${content.bytes} bytes)`;
      button.onclick = () => { button.disabled = true; const current = revision;
        void preview(content, row!, current).catch(() => { if (current === revision) fail(); }); };
      row.append(button);
    }
  }
  row.append(document.createTextNode(item.text));
}
async function page(current: number): Promise<void> {
  if (!cursor || busyRevision === current) return; busyRevision = current; more.disabled = true;
  try {
    const result = await read({operation:"page", cursor});
    if (disposed || current !== revision) return;
    if (result.status !== "page") { cursor = undefined; status(result.status === "error" ? result.code : "history_invalid_result"); return; }
    if (result.value.cut.contentRevision !== opened?.cut.contentRevision) throw new Error("history_changed");
    for (const item of result.value.items) render(item);
    cursor = result.value.nextCursor;
    status(`Snapshot ${opened.cut.contentRevision.slice(0,12)} · ${rows.size} readable records · ${cursor ? "more pages" : "complete"}`);
  } catch { if (current === revision) fail(); }
  finally { if (current === revision) { busyRevision = undefined; more.disabled = cursor === undefined; } }
}
async function refresh(): Promise<void> {
  const current = ++revision; busyRevision = undefined; clear(); more.disabled = true; cursor = undefined;
  const prior = opened; opened = undefined;
  try {
    if (prior) await read({operation:"close", snapshot:prior.snapshot});
    const result = await read({operation:"open", scope:scope.value as HistoryScope});
    if (disposed || current !== revision) return;
    if (result.status !== "opened") { status(result.status === "error" ? result.code : "history_invalid_open"); return; }
    opened = result.value; cursor = opened.cursor; await page(current);
  } catch { if (current === revision) fail(); }
}
more.onclick = () => { void page(revision); };
element<HTMLButtonElement>("#refresh").onclick = () => { void refresh(); };
scope.onchange = () => {
  if (!opened) return; ++revision; busyRevision = undefined; clear(); cursor = opened.cursors[scope.value as HistoryScope]; void page(revision);
};
async function boot(): Promise<void> {
  connection(ctx); registry(ctx); gateway(ctx); await ctx.remote.$mount(historyContribution);
  ctx.connection.generation.subscribe(() => {
    if (ctx.connection.generation.getSnapshot() === undefined) { ++revision; cursor=undefined; more.disabled=true; status("history_connection_unavailable"); }
    else void refresh();
  });
  if (ctx.connection.generation.getSnapshot() !== undefined) await refresh();
}
window.addEventListener("pagehide", () => { disposed=true; ++revision; clear(); void ctx.fiber.dispose(); }, {once:true});
void boot().catch(fail);
