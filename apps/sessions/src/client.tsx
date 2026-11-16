import { Context } from "@deepseek-ai/cordis";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { apply as renderer } from "@deepseek-ai/dsh-client-ui-renderer/client";
import { apply as sessions, type SessionReference } from "@deepseek-ai/dsh-api-session-controller/client";
import sessionContribution from "@deepseek-ai/dsh-api-session-controller/remote";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { UiConversation } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { registerTrajectoryMessageDefinitions } from "@deepseek-ai/dsh-client-ui-trajectory/src/client/trajectory-message-definitions.ts";
import { registerTrajectoryAssistantDefinition } from "@deepseek-ai/dsh-client-ui-trajectory/src/client/trajectory-assistant-definition.ts";
import { registerTrajectoryConversationView } from "@deepseek-ai/dsh-client-ui-trajectory/src/client/trajectory-snapshot-builder.ts";
import { useEffect, useState } from "react";
import type { PropsRenderSlots, StandardSourceBinding, HostObservable } from "@deepseek-ai/dsh-client-ui-slots";
import { sessionsContribution, type PublicSessionView, type SessionSelectionId } from "../../../packages/contracts/sessions.ts";
import type { InteractionSnapshot, PendingInteraction, UIAnswer } from "../../../packages/contracts/interactions.ts";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
declare module "@deepseek-ai/dsh-client-ui-slots" { interface SlotMap { "s1.sessions": { kind: "single"; scope: "root"; owner: Record<never, never> } } }
declare module "@deepseek-ai/dsh-api-session-controller/client" { interface SessionReferenceSourceMap { supervisedSession: unknown } }
const ctx = new Context();
let csrf = "", reference: SessionReference | undefined, unsubscribe: (() => void) | undefined;
let viewChanged: (view: PublicSessionView | undefined) => void = () => {}, historyChanged: (rows: string[]) => void = () => {};
let errorChanged: (error: string) => void = () => {};
const resultValue = <T,>(result: RemoteResult<T>): T => { if (!result.ok) throw new Error(result.error.message); return result.value; };
function release() { unsubscribe?.(); unsubscribe = undefined; reference?.release(); reference = undefined; historyChanged([]); }
async function present(view: PublicSessionView) {
  release(); sessionStorage.setItem("omp-supervised-worker", JSON.stringify({ workerId: view.workerId, generation: view.generation }));
  viewChanged(view); await ctx.sessions.refresh(); reference = ctx.sessions.retain(SessionId(view.registration.nativeSessionId), { source: "supervisedSession" });
  const expected = reference, binding = await reference.ready;
  if (reference !== expected) return;
  const target = ctx.uiConversation.binding(binding).target("trajectory");
  const render = () => { if (reference === expected) historyChanged((target.getSnapshot()?.eventNodes ?? []).map(node => JSON.stringify(node))); };
  unsubscribe = target.subscribe(render); render();
}
function Shell({ renderSlot }: PropsRenderSlots<"s1.sessions">) {
  return <main data-session-root-slot="true"><h1>Supervised native Sessions</h1>
    <p>Isolated S1 component · synthetic data only · normal product admission remains blocked.</p>{renderSlot("s1.sessions", {})}</main>;
}
function Ask({ card, answer }: { card: PendingInteraction; answer: (answer: UIAnswer) => Promise<void> }) {
  const [value, setValue] = useState(card.prefill ?? "");
  return <section data-interaction-id={card.id} data-scope={card.scope.kind}><h2>{card.title}</h2>
    <p>{card.scope.kind === "startup" ? "Startup · native identity not confirmed" : `Session ${card.scope.sessionId}`}</p>
    {card.method === "select" ? card.options?.map(option => <button key={option} onClick={() => void answer({ type: "value", value: option })}>{option}</button>)
      : card.method === "confirm" ? <><button onClick={() => void answer({ type: "confirm", confirmed: true })}>Confirm</button><button onClick={() => void answer({ type: "confirm", confirmed: false })}>Deny</button></>
      : card.method === "ask" ? <p>Structured ask is unavailable in this Session component. Cancel to stop startup.</p>
        : <><input aria-label="Explicit answer" type={card.secret ? "password" : "text"} value={value} onChange={event => setValue(event.target.value)} />
          <button onClick={() => void answer({ type: "value", value })}>Submit explicit answer</button></>}
    <button onClick={() => void answer({ type: "cancel" })}>Cancel interaction</button></section>;
}
type Catalog = Awaited<ReturnType<typeof ctx.remote.ompSessions.catalog>> extends RemoteResult<infer T> ? T : never;
type Index = Awaited<ReturnType<typeof ctx.remote.ompSessions.index>> extends RemoteResult<infer T> ? T : never;
function Surface() {
  const [catalog, setCatalog] = useState<Catalog>(), [index, setIndex] = useState<Index>();
  const [view, setView] = useState<PublicSessionView>(), [rows, setRows] = useState<string[]>([]), [error, setError] = useState("");
  const [interaction, setInteraction] = useState<InteractionSnapshot>(), [cwd, setCwd] = useState("");
  const [grants, setGrants] = useState<{ id: string; path: string }[]>([]), [confirmation, setConfirmation] = useState<string>(), [review, setReview] = useState("");
  const [opening, setOpening] = useState(false);
  const perform = async (action: () => Promise<void>) => { try { setError(""); await action(); } catch (failure) { setError(String(failure)); } };
  const load = async () => {
    setCatalog(resultValue(await ctx.remote.ompSessions.catalog({}))); setIndex(resultValue(await ctx.remote.ompSessions.index({})));
    setGrants(resultValue(await ctx.remote.ompSessions.grants()));
  };
  useEffect(() => {
    viewChanged = setView; historyChanged = setRows; errorChanged = setError; let live = true;
    void perform(load);
    const timer = setInterval(() => { void (async () => {
      const result = await ctx.remote.ompSessions.interactions(); if (live && result.ok) setInteraction(result.value);
      if (live) { const latest = await ctx.remote.ompSessions.index({}); if (latest.ok) setIndex(latest.value); }
    })().catch(() => {}); }, 250);
    return () => { live = false; clearInterval(timer); release(); };
  }, []);
  const open = async (selectionId: SessionSelectionId, switching: boolean) => {
    setOpening(true);
    try { const result = await (switching ? ctx.remote.ompSessions.switch(selectionId) : ctx.remote.ompSessions.open(selectionId));
      await present(resultValue(result)); await load(); }
    finally { setOpening(false); }
  };
  return <div><p role="alert">{error}</p><button onClick={() => void perform(load)}>Refresh catalog</button>
    <button onClick={() => void perform(async () => { await fetch("/auth/logout", { method: "POST", headers: { "x-omp-csrf": csrf } }); release(); location.reload(); })}>Log out</button>
    <h2>Directory permissions</h2><input aria-label="Directory to authorize" value={cwd} onChange={event => { setCwd(event.target.value); setConfirmation(undefined); }} />
    <button onClick={() => void perform(async () => { const preview = resultValue(await ctx.remote.ompSessions.preview(cwd)); setConfirmation(preview.confirmation); setReview(preview.path); })}>Review directory</button>
    <p>{review}</p>{confirmation && <button onClick={() => void perform(async () => { resultValue(await ctx.remote.ompSessions.confirm(confirmation)); setConfirmation(undefined); await load(); })}>Grant this directory and descendants</button>}
    {grants.map(grant => <p key={grant.id}>{grant.path} <button onClick={() => void perform(async () => { resultValue(await ctx.remote.ompSessions.revoke(grant.id)); release(); setView(undefined); await load(); })}>Revoke directory</button>
      <button disabled={opening} onClick={() => void perform(async () => { await present(resultValue(await ctx.remote.ompSessions.new(grant.id))); await load(); })}>New Session here</button></p>)}
    <h2>Discovered native Sessions</h2><p>{catalog?.status}</p>{catalog?.choices.map(choice => <article key={choice.selectionId} data-native-id={choice.nativeSessionId}>
      <h3>{choice.title ?? choice.nativeSessionId}</h3><p>{choice.nativeSessionId} · {choice.sourceId} · {choice.cwd}</p><p>{choice.ownership} · directory {choice.directory}</p>
      <button onClick={() => void perform(() => open(choice.selectionId, false))}>Open Session</button>
      <button onClick={() => void perform(() => open(choice.selectionId, true))}>Switch to Session</button></article>)}
    <button onClick={() => void perform(async () => { await present(resultValue(await ctx.remote.ompSessions.recheck())); await load(); })}>Check last open outcome</button>
    <h2>Registered Sessions</h2><ul data-session-index="true">{index?.records.map(record => <li key={record.id}>{record.nativeSessionId}: {record.attempt.state} {record.attempt.code}</li>)}</ul>
    <div data-native-binding={view?.registration.nativeSessionId ?? "unconfirmed"} data-worker-id={view?.workerId ?? ""}>
      <h2>{view ? `Native Session ${view.registration.nativeSessionId}` : "No confirmed native Session"}</h2>
      {view && <p>Source {view.registration.sourceId} · instance {view.registration.instanceId} · actual cwd {view.cwd}</p>}
      <p>History is an observed native cut; durability is not attested. Unsupported retained content is shown explicitly.</p>
      <div id="conversation">{rows.map((row, index) => <pre className="row" key={index}>{row}</pre>)}</div>
    </div>
    {interaction?.pending.map(card => <Ask key={card.id} card={card} answer={async answer => { await perform(async () => { resultValue(await ctx.remote.ompSessions.answer(card.generation, card.id, answer)); }); }} />)}
  </div>;
}
async function boot() {
  const auth = await fetch("/auth/status", { cache: "no-store" });
  if (!auth.ok) { document.getElementById("app")!.textContent = "Browser authorization required. Open a local bootstrap link."; return; }
  csrf = (await auth.json()).csrf;
  installConnection(ctx, { location, transport: { fetch: (input, init) => { const headers = new Headers(init.headers); headers.set("x-omp-csrf", csrf); return fetch(input, { ...init, headers }); } } });
  registry(ctx); gateway(ctx); renderer(ctx); sessions(ctx);
  new UiConversation(ctx, ctx.sessions); registerTrajectoryMessageDefinitions(ctx); registerTrajectoryAssistantDefinition(ctx); registerTrajectoryConversationView(ctx);
  const absent: StandardSourceBinding = { key: undefined, hooks: {}, keyedHooks: {}, props: {} };
  const source: HostObservable<StandardSourceBinding> = { getSnapshot: () => absent, subscribe: () => () => {} };
  ctx.slots.installScope("session", { current: source, bindingSource: target => { if (target !== undefined) throw new Error("Root shell has no Session Slot"); return source; } });
  await ctx.remote.$mount(sessionsContribution); await ctx.remote.$mount(sessionContribution);
  ctx.slots.register({ name: "root", children: { "s1.sessions": { kind: "single", scope: "root" } } }, Shell);
  ctx.slots.register({ name: "s1.sessions" }, Surface);
  const unmount = ctx.uiRenderer.mount(document.getElementById("app")!);
  const previous = sessionStorage.getItem("omp-supervised-worker");
  if (previous) { try { const result = await ctx.remote.ompSessions.view(JSON.parse(previous).workerId); if (result.ok) await present(result.value); else errorChanged("Previous worker unavailable. Manually Open the native Session."); } catch { sessionStorage.removeItem("omp-supervised-worker"); } }
  ctx.effect(() => ctx.connection.generation.subscribe(() => { if (!ctx.connection.generation.getSnapshot()) { release(); viewChanged(undefined); errorChanged("Host connection lost. Manual Open is required after worker loss."); } }));
  window.addEventListener("pagehide", () => { release(); unmount(); void ctx.fiber.dispose(); }, { once: true });
}
window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
void boot().catch(error => { document.getElementById("app")!.textContent = String(error); });
