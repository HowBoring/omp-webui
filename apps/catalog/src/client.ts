import { Context } from "@deepseek-ai/cordis";
import { apply as connection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { catalogContribution, type CatalogPage, type CatalogDescriptor } from "../../../packages/contracts/catalog.ts";
const ctx = new Context();
const root = document.querySelector<HTMLElement>("#catalog")!;
const next = document.querySelector<HTMLButtonElement>("#next")!;
const refresh = document.querySelector<HTMLButtonElement>("#refresh")!;
const detail = document.querySelector<HTMLElement>("#detail")!;
let cursor:string|undefined, disposed = false, busy = false, generation = 0;
const text = (tag:string,value:string) => { const element = document.createElement(tag); element.textContent = value; return element; };
function blocked(code:string):void { root.dataset.status="blocked"; root.replaceChildren(text("p",code)); next.disabled=true; }
async function describe(item:CatalogDescriptor):Promise<void> {
  const current = generation;
  const result = await ctx.remote.ompCatalogFixture.describe(item.reference);
  if (disposed || current !== generation) return;
  detail.replaceChildren(text("h2","Current native description"),text("p",result.ok ? result.value.status:"description_failed"));
  if (result.ok && result.value.item) detail.append(text("p",`Ownership ${result.value.item.ownership.state}; observed ${result.value.item.ownership.observedAt}`));
}
function render(page:CatalogPage):void {
  root.dataset.status=page.status;
  const summary = text("p",`${page.status}; examined ${page.examined}; observed ${page.observedAt}; expires ${page.expiresAt}`);
  summary.id="summary";
  const rows:HTMLElement[] = [summary];
  for (const issue of page.failures) rows.push(text("p",`Partial source failure: ${issue.code}`));
  for (const item of page.items) {
    const row = document.createElement("article"); row.dataset.nativeId=item.nativeSessionId;
    row.append(text("h2",item.title ?? item.nativeSessionId),text("p",`cwd: ${item.cwd.canonical ?? item.cwd.recorded ?? "unknown"} (${item.cwd.status})`),
      text("p",`Ownership ${item.ownership.state}; observed ${item.ownership.observedAt}`),
      text("p",`Native ID ${item.nativeSessionId}; instance ${item.instanceId.slice(0,12)}; aliases ${item.aliases.length}`));
    const button = text("button","Recheck description"); button.addEventListener("click",()=>void describe(item)); row.append(button); rows.push(row);
  }
  root.replaceChildren(...rows); cursor=page.nextCursor; next.disabled=!cursor;
}
async function load(restart=false):Promise<void> {
  if (busy || disposed) return;
  busy=true; root.dataset.status="loading"; next.disabled=true; refresh.disabled=true;
  const current=++generation;
  if (restart) { cursor=undefined; detail.replaceChildren(); }
  try {
    do {
      const result = await ctx.remote.ompCatalogFixture.page({pageSize:32,...(cursor ? {cursor}:{})});
      if (disposed || current !== generation) return;
      if (!result.ok) { blocked("catalog_request_failed; restart discovery"); return; }
      if (result.value.status === "error") {blocked(result.value.code);return;}
      render(result.value.page);
      if (result.value.page.status !== "scanning") break;
    } while(cursor);
  } catch { if (!disposed && current===generation) blocked("catalog_unavailable"); }
  finally {busy=false; refresh.disabled=false;}
}
next.addEventListener("click",()=>void load()); refresh.addEventListener("click",()=>void load(true));
async function boot():Promise<void> {
  connection(ctx); registry(ctx); gateway(ctx); await ctx.remote.$mount(catalogContribution);
  const unsubscribe=ctx.connection.generation.subscribe(()=>{
    if (ctx.connection.generation.getSnapshot() === undefined) {++generation; blocked("connection_unavailable");}
    else void load(true);
  });
  ctx.effect(()=>unsubscribe);
  if(ctx.connection.generation.getSnapshot() !== undefined) await load(true);
}
window.addEventListener("pagehide",()=>{disposed=true;++generation;blocked("fixture_suspended");void ctx.fiber.dispose();},{once:true});
window.addEventListener("pageshow",event=>{if(event.persisted && disposed)window.location.reload();});
void boot().catch(()=>blocked("catalog_boot_failed"));
