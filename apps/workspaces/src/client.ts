import { Context } from "@deepseek-ai/cordis";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { workspaceContribution } from "../../../packages/contracts/workspaces.ts";
import type { WorkspacePage } from "../../../packages/contracts/workspaces.ts";
const ctx = new Context();
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const root = element("catalog"), status = element("status"), next = element<HTMLButtonElement>("next");
const confirm = element<HTMLButtonElement>("confirm"), review = element("confirmation");
const text = (tag: string, value: string) => { const node = document.createElement(tag); node.textContent = value; return node; };
let csrf = "", confirmation: string | undefined, cursor: string | undefined, generation = 0, connectionEpoch = 0, disposed = false;
function blocked(reason: string): void { root.dataset.status = "blocked"; root.replaceChildren(text("p", reason)); next.disabled = true; }
function render(result: Extract<WorkspacePage, { status: "ok" }>): void {
  const { page, access } = result;
  root.dataset.status = page.status;
  root.replaceChildren(text("p", `${page.status}; examined ${page.examined}; metadata only; no Session registered`));
  for (const failure of page.failures) root.append(text("p", `Partial source failure: ${failure.code}`));
  let cwd: string | undefined;
  page.items.forEach((item, index) => {
    const location = item.cwd.canonical ?? item.cwd.recorded ?? "Unknown working directory";
    if (cwd !== location) { root.append(text("h2", location)); cwd = location; }
    const policy = access[index]!;
    const row = document.createElement("article"); row.dataset.nativeId = item.nativeSessionId;
    row.dataset.directory = policy.directory.status;
    row.append(text("h3", item.title ?? item.nativeSessionId), text("p", `cwd ${item.cwd.status}; directory ${policy.directory.status}`),
      text("p", `Registration ${policy.registration}; ownership ${item.ownership.state} at ${item.ownership.observedAt}`),
      text("p", `Source ${item.sourceId}; native identity ${item.nativeSessionId}`),
      text("p", "History, open and execution blocked pending #41 and #44"));
    root.append(row);
  });
  cursor = page.nextCursor; next.disabled = !cursor;
}
async function load(restart = false): Promise<void> {
  const current = ++generation;
  if (restart) cursor = undefined;
  next.disabled = true; root.dataset.status = "loading";
  do {
    const result = await ctx.remote.ompWorkspaces.page({ pageSize: 32, ...(cursor ? { cursor } : {}) });
    if (disposed || current !== generation) return;
    if (!result.ok) { blocked("catalog_request_failed"); return; }
    if (result.value.status === "error") { blocked(result.value.code); return; }
    render(result.value);
    if (result.value.page.status !== "scanning") break;
  } while (cursor);
}
let registeredGeneration = 0, grantsGeneration = 0;
let registeredCursor: string | undefined;
async function registered(restart = true): Promise<void> {
  const epoch = connectionEpoch, current = ++registeredGeneration;
  if (restart) registeredCursor = undefined;
  const result = await ctx.remote.ompWorkspaces.registered({ pageSize: 32,
    ...(registeredCursor ? { cursor: registeredCursor } : {}) });
  if (disposed || epoch !== connectionEpoch || current !== registeredGeneration) return;
  if (!result.ok) { element("registered").replaceChildren(text("p", "index_unavailable")); return; }
  const view = element("registered"); view.replaceChildren();
  for (const item of result.value.items) {
    const row = text("article", `${item.title}; registered reference ${item.id}; native ${item.nativeStatus}; `
      + `Workspace metadata ${item.workspace}; directory ${item.directory.status}; ownership ${item.ownership.state}; history/open/execution blocked`);
    row.dataset.nativeStatus = item.nativeStatus; view.append(row);
  }
  registeredCursor = result.value.nextCursor;
  element<HTMLButtonElement>("registered-next").disabled = !registeredCursor;
}
element("registered-next").addEventListener("click", () => void perform(() => registered(false)));
async function grants(): Promise<void> {
  const epoch = connectionEpoch, current = ++grantsGeneration;
  await registered();
  if (disposed || epoch !== connectionEpoch || current !== grantsGeneration) return;
  const result = await ctx.remote.ompWorkspaces.grants();
  if (disposed || epoch !== connectionEpoch || current !== grantsGeneration) return;
  if (!result.ok) throw new Error("grants_unavailable");
  const list = element("grants"); list.replaceChildren();
  for (const grant of result.value) {
    const row = document.createElement("p"); row.append(text("span", `${grant.path}: ${grant.status}`));
    const revoke = text("button", "Revoke directory"); revoke.addEventListener("click", () => void perform(async () => {
      const revoked = await ctx.remote.ompWorkspaces.revoke(grant.id);
      if (!revoked.ok) throw new Error("revoke_failed");
      status.textContent = "Grant revoked. Worker cleanup awaits #44; this component runs no Session workers.";
      await grants(); await load(true);
    })); row.append(revoke); list.append(row);
  }
}
async function perform(action: () => Promise<void>): Promise<void> {
  try { await action(); } catch { status.textContent = "Operation failed; refresh and review current permissions."; }
}
element("preview").addEventListener("click", () => void perform(async () => {
  confirmation = undefined; confirm.hidden = true;
  const result = await ctx.remote.ompWorkspaces.preview(element<HTMLInputElement>("path").value);
  if (!result.ok) throw new Error("preview_failed");
  confirmation = result.value.confirmation; review.textContent = `Canonical target: ${result.value.path}; includes descendants; expires ${result.value.expiresAt}`;
  confirm.hidden = false;
}));
element("path").addEventListener("input", () => { confirmation = undefined; confirm.hidden = true; review.textContent = ""; });
confirm.addEventListener("click", () => void perform(async () => {
  const token = confirmation; confirmation = undefined; confirm.hidden = true;
  if (!token) return;
  const result = await ctx.remote.ompWorkspaces.confirm(token);
  if (!result.ok) throw new Error("grant_failed");
  review.textContent = `Granted ${result.value.path} and descendants.`; await grants(); await load(true);
}));
element("refresh").addEventListener("click", () => void perform(async () => { await grants(); await load(true); }));
next.addEventListener("click", () => void perform(() => load()));
element("logout").addEventListener("click", () => void perform(async () => {
  await fetch("/auth/logout", { method: "POST", headers: { "x-omp-csrf": csrf } }); location.reload();
}));
async function boot(): Promise<void> {
  const response = await fetch("/auth/status", { cache: "no-store" });
  if (!response.ok) { blocked("authorization_required"); return; }
  const auth: unknown = await response.json();
  if (!auth || typeof auth !== "object" || !("csrf" in auth) || typeof auth.csrf !== "string") throw new Error("auth_schema");
  csrf = auth.csrf; status.textContent = "Browser authorized. Directory permissions are checked on every catalog page.";
  // Public Connection fetch hook preserves stock envelopes/correlation and sockets; adds only Host CSRF admission.
  installConnection(ctx, { location, transport: { fetch: (input, init) => {
    const headers = new Headers(init.headers); headers.set("x-omp-csrf", csrf); return fetch(input, { ...init, headers });
  } } });
  registry(ctx); gateway(ctx); await ctx.remote.$mount(workspaceContribution);
  const sources = await ctx.remote.ompWorkspaces.sources();
  if (!sources.ok) throw new Error("sources_failed");
  const view = element("sources"); view.append(text("h2", `Selected native profile: ${sources.value.profile}`));
  for (const source of sources.value.sources) view.append(text("p", `${source.kind} source ${source.sourceId}: ${source.status}`));
  ctx.effect(() => ctx.connection.generation.subscribe(() => {
    ++connectionEpoch;
    if (!ctx.connection.generation.getSnapshot()) {
      ++generation; blocked("connection_unavailable"); element("grants").replaceChildren(); element("registered").replaceChildren();
    }
    else void perform(async () => { await grants(); await load(true); });
  }));
  await grants(); if (ctx.connection.generation.getSnapshot()) await load(true);
}
window.addEventListener("pagehide", () => { disposed = true; ++connectionEpoch; ++generation; void ctx.fiber.dispose(); }, { once: true });
window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
void boot().catch(() => blocked("workspace_boot_failed"));
