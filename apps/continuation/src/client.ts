import { Context } from "@deepseek-ai/cordis";
import { apply as connection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { continuationContribution, type ContinuationSnapshot, type ContinuationAction } from "../../../packages/contracts/continuation.ts";
const ctx = new Context();
const choices = document.querySelector<HTMLElement>("#choices")!;
const outcome = document.querySelector<HTMLElement>("#outcome")!;
let disposed = false;
let issued = 0;
const text = (tag: string, value: string): HTMLElement => { const element = document.createElement(tag); element.textContent = value; return element; };
function render(snapshot: ContinuationSnapshot): void {
  if (disposed) return;
  choices.dataset.status = "ready";
  choices.replaceChildren(...snapshot.choices.map(item => {
    const row = document.createElement("article"); row.dataset.nativeId = item.descriptor.nativeSessionId;
    row.append(text("h2", item.descriptor.title ?? item.descriptor.nativeSessionId),
      text("p", `Native ID ${item.descriptor.nativeSessionId}; source ${item.descriptor.sourceId.slice(0, 12)}; instance ${item.descriptor.instanceId.slice(0, 12)}`),
      text("p", `Ownership ${item.descriptor.ownership.state}; observed ${item.descriptor.ownership.observedAt}`));
    const button = text("button", "Continue");
    button.addEventListener("click", () => void act({ type: "continue", selectionId: item.selectionId })); row.append(button); return row;
  }));
  const records = document.querySelector<HTMLElement>("#registrations")!;
  records.replaceChildren(...snapshot.registrations.map(record => {
    const row = text("p", `${record.intent}: ${record.nativeSessionId ?? "identity not yet verified"}; ${record.attempt}${record.code ? `; ${record.code}` : ""}`);
    row.dataset.registrationId = record.id; row.dataset.attempt = record.attempt;
    if (record.nativeSessionId) row.dataset.nativeId = record.nativeSessionId;
    return row;
  }));
  document.querySelector<HTMLElement>("#worker")!.textContent = `Worker ${snapshot.worker.status}; starts ${snapshot.worker.starts}; ${snapshot.worker.id ?? "none"}`;
  outcome.dataset.phase = snapshot.state?.phase ?? snapshot.registrations.at(-1)?.attempt ?? "waiting";
  outcome.textContent = snapshot.state ? `${snapshot.state.intent}: ${snapshot.state.phase}; verified native identity ${snapshot.state.nativeSessionId ?? "unavailable"}; ${snapshot.state.code ?? ""}`
    : snapshot.registrations.at(-1)?.code ?? "Choose an explicit action.";
}
async function act(action: ContinuationAction): Promise<void> {
  const generation = ++issued;
  try {
    const result = await ctx.remote.ompContinuationFixture.act(action);
    if (generation !== issued || disposed) return;
    if (result.ok) render(result.value); else outcome.textContent = "continuation_request_failed";
  } catch { if (!disposed && generation === issued) outcome.textContent = "continuation_outcome_unavailable; check before another action"; }
}
for (const name of ["discover", "new", "cancel", "recheck", "close"] as const)
  document.querySelector(`#${name}`)!.addEventListener("click", () => void act({ type: name }));
async function boot(): Promise<void> {
  connection(ctx); registry(ctx); gateway(ctx); await ctx.remote.$mount(continuationContribution);
  const refresh = async (): Promise<void> => {
    const generation = ++issued;
    const result = await ctx.remote.ompContinuationFixture.snapshot(); if (result.ok && generation === issued) render(result.value);
    await act({ type: "discover" });
  };
  const unsubscribe = ctx.connection.generation.subscribe(() => {
    if (ctx.connection.generation.getSnapshot() !== undefined) void refresh();
    else choices.dataset.status = "disconnected";
  });
  ctx.effect(() => unsubscribe);
  if (ctx.connection.generation.getSnapshot() !== undefined) await refresh();
}
window.addEventListener("pagehide", () => { disposed = true; void ctx.fiber.dispose(); }, { once: true });
void boot().catch(() => { choices.dataset.status = "blocked"; outcome.textContent = "continuation_boot_failed"; });
