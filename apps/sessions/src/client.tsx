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
import { NativeInteractionCard } from "./interaction-card.tsx";
import { useEffect, useRef, useState } from "react";
import type { PropsRenderSlots, StandardSourceBinding, HostObservable } from "@deepseek-ai/dsh-client-ui-slots";
import { sessionsContribution, type PublicSessionView, type SessionSelectionId } from "../../../packages/contracts/sessions.ts";
import type { InteractionSnapshot } from "../../../packages/contracts/interactions.ts";
import { workspaceContribution, type Grant } from "../../../packages/contracts/workspaces.ts";
import { DiscoveredSessions, RegisteredSessions, resultValue, useSessionLists } from "./session-lists.tsx";
declare module "@deepseek-ai/dsh-client-ui-slots" { interface SlotMap { "s1.sessions": { kind: "single"; scope: "root"; owner: Record<never, never> } } }
declare module "@deepseek-ai/dsh-api-session-controller/client" { interface SessionReferenceSourceMap { supervisedSession: unknown } }
const ctx = new Context();
let csrf = "", reference: SessionReference | undefined, unsubscribe: (() => void) | undefined;
let viewChanged: (view: PublicSessionView | undefined) => void = () => {}, historyChanged: (rows: string[]) => void = () => {};
let errorChanged: (error: string) => void = () => {};
let listsInvalidated: () => void = () => {};
let accessRevision = 0, presentationRevision = 0, authorizationWithdrawn = false;
function invalidateAccess(message: string) {
  ++accessRevision;
  listsInvalidated();
  release();
  viewChanged(undefined);
  errorChanged(message);
}
function release() {
  ++presentationRevision;
  unsubscribe?.(); unsubscribe = undefined; reference?.release(); reference = undefined; historyChanged([]);
}
async function present(view: PublicSessionView) {
  release(); sessionStorage.setItem("omp-supervised-worker", JSON.stringify({ workerId: view.workerId, generation: view.generation }));
  const current = presentationRevision, access = accessRevision;
  viewChanged(view);
  await ctx.sessions.refresh();
  if (current !== presentationRevision || access !== accessRevision) return;
  reference = ctx.sessions.retain(SessionId(view.registration.nativeSessionId), { source: "supervisedSession" });
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
function Surface() {
  const lists = useSessionLists(ctx.remote), grantRequest = useRef(0);
  const [view, setView] = useState<PublicSessionView>(), [rows, setRows] = useState<string[]>([]), [error, setError] = useState("");
  const [interaction, setInteraction] = useState<InteractionSnapshot>(), [cwd, setCwd] = useState("");
  const [grants, setGrants] = useState<Grant[]>([]), [confirmation, setConfirmation] = useState<string>();
  const [review, setReview] = useState(""), [grantsError, setGrantsError] = useState("");
  const [opening, setOpening] = useState(false);
  const [changingPermissions, setChangingPermissions] = useState(false), [denied, setDenied] = useState(false);
  const perform = async (action: () => Promise<void>) => {
    const current = accessRevision;
    try { setError(""); await action(); }
    catch (failure) { if (current === accessRevision) setError(String(failure)); }
  };
  const loadGrants = async () => {
    const current = accessRevision, request = ++grantRequest.current;
    const latest = () => current === accessRevision && request === grantRequest.current;
    setGrants([]);
    setGrantsError("");
    try {
      const grants = resultValue(await ctx.remote.ompSessions.grants());
      if (latest()) setGrants(grants);
    } catch (failure) {
      if (latest()) setGrantsError(String(failure));
    }
  };
  const load = async () => {
    if (authorizationWithdrawn) return;
    await Promise.all([lists.discovered.load(), lists.registered.load(), loadGrants()]);
  };
  useEffect(() => {
    viewChanged = setView; historyChanged = setRows; errorChanged = setError;
    listsInvalidated = () => {
      lists.clear(); setGrants([]); setGrantsError(""); setInteraction(undefined);
      setConfirmation(undefined); setReview(""); setDenied(authorizationWithdrawn);
    };
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pollInteractions = async () => {
      const current = accessRevision;
      try {
        const result = await ctx.remote.ompSessions.interactions();
        if (live && current === accessRevision) setInteraction(result.ok ? result.value : undefined);
      } catch { if (live && current === accessRevision) setInteraction(undefined); }
      if (live && !authorizationWithdrawn) timer = setTimeout(() => void pollInteractions(), 250);
    };
    void perform(load);
    timer = setTimeout(() => void pollInteractions(), 250);
    return () => { live = false; clearTimeout(timer); listsInvalidated = () => {}; release(); };
  }, []);
  const changePermissions = async (action: () => Promise<void>) => {
    setChangingPermissions(true);
    const current = ++accessRevision;
    lists.clear();
    setGrants([]);
    try {
      await perform(async () => {
        try { await action(); }
        finally { if (current === accessRevision) await load(); }
      });
    } finally { setChangingPermissions(false); }
  };
  const open = async (action: () => ReturnType<typeof ctx.remote.ompSessions.open>) => {
    const current = accessRevision;
    setOpening(true);
    try {
      const result = await action();
      if (current === accessRevision) await present(resultValue(result));
    } finally {
      setOpening(false);
      if (current === accessRevision) await lists.registered.load();
    }
  };
  const permissionsDisabled = changingPermissions || denied;
  return <div><p role="alert">{error}</p>
    <button disabled={permissionsDisabled} onClick={() => void perform(load)}>Refresh catalog</button>
    <button disabled={denied} onClick={() => void perform(async () => {
      await fetch("/auth/logout", { method: "POST", headers: { "x-omp-csrf": csrf } }); release(); location.reload();
    })}>Log out</button>
    <h2>Directory permissions</h2>
    {grantsError && <p role="status">{grantsError}</p>}
    <input aria-label="Directory to authorize" value={cwd}
      onChange={event => { setCwd(event.target.value); setConfirmation(undefined); }} />
    <button disabled={permissionsDisabled} onClick={() => void perform(async () => {
      const current = accessRevision;
      const preview = resultValue(await ctx.remote.ompSessions.preview(cwd));
      if (current === accessRevision) { setConfirmation(preview.confirmation); setReview(preview.path); }
    })}>Review directory</button>
    <p>{review}</p>{confirmation && <button disabled={permissionsDisabled}
      onClick={() => void changePermissions(async () => {
        resultValue(await ctx.remote.ompSessions.confirm(confirmation)); setConfirmation(undefined);
      })}>Grant this directory and descendants</button>}
    {grants.map(grant => <p key={grant.id}>{grant.path} · {grant.status}
      <button disabled={permissionsDisabled} onClick={() => void changePermissions(async () => {
        resultValue(await ctx.remote.ompSessions.revoke(grant.id)); release(); setView(undefined);
      })}>Revoke directory</button>
      <button disabled={permissionsDisabled || opening || grant.status !== "valid"}
        onClick={() => void perform(() => open(() => ctx.remote.ompSessions.new(grant.id)))}>New Session here</button></p>)}
    <DiscoveredSessions list={lists.discovered} disabled={permissionsDisabled || opening}
      open={(selectionId: SessionSelectionId, switching: boolean) => void perform(() => open(() =>
        switching ? ctx.remote.ompSessions.switch(selectionId) : ctx.remote.ompSessions.open(selectionId)))} />
    <button disabled={permissionsDisabled || opening}
      onClick={() => void perform(() => open(() => ctx.remote.ompSessions.recheck()))}>Check last open outcome</button>
    <RegisteredSessions list={lists.registered} disabled={permissionsDisabled} />
    <div data-native-binding={view?.registration.nativeSessionId ?? "unconfirmed"} data-worker-id={view?.workerId ?? ""}>
      <h2>{view ? `Native Session ${view.registration.nativeSessionId}` : "No confirmed native Session"}</h2>
      {view && <p>Source {view.registration.sourceId} · instance {view.registration.instanceId} · actual cwd {view.cwd}</p>}
      <p>History is an observed native cut; durability is not attested. Unsupported retained content is shown explicitly.</p>
      <div id="conversation">{rows.map((row, index) => <pre className="row" key={index}>{row}</pre>)}</div>
    </div>
    {interaction?.pending.map(card => <NativeInteractionCard key={card.id} card={card} onAnswer={async answer => { await perform(async () => { resultValue(await ctx.remote.ompSessions.answer(card.generation, card.id, answer)); }); }} />)}
    {interaction && interaction.outcomes.length > 0 && <section data-interaction-outcomes="true">
      <h2>Interaction results and Stop requests</h2>
      <ol>{interaction.outcomes.slice(-8).map((outcome, index) => <li key={`${outcome.id}-${index}`}
        data-interaction-outcome={outcome.id} data-status={outcome.status} data-reason={outcome.reason} data-stop={outcome.stop}>
        {outcome.id === "worker-stop" ? `Worker Stop ${outcome.stop}` : `${outcome.status}: ${outcome.reason}`}
      </li>)}</ol>
    </section>}
  </div>;
}
async function boot() {
  const auth = await fetch("/auth/status", { cache: "no-store" });
  if (!auth.ok) { document.getElementById("app")!.textContent = "Browser authorization required. Open a local bootstrap link."; return; }
  csrf = (await auth.json()).csrf;
  installConnection(ctx, { location, transport: { async fetch(input, init) {
    const headers = new Headers(init.headers);
    headers.set("x-omp-csrf", csrf);
    const response = await fetch(input, { ...init, headers });
    if (response.status === 401 && !authorizationWithdrawn) {
      authorizationWithdrawn = true;
      invalidateAccess("Browser authorization required. Open a local bootstrap link.");
    }
    return response;
  } } });
  registry(ctx); gateway(ctx); renderer(ctx); sessions(ctx);
  new UiConversation(ctx, ctx.sessions); registerTrajectoryMessageDefinitions(ctx); registerTrajectoryAssistantDefinition(ctx); registerTrajectoryConversationView(ctx);
  const absent: StandardSourceBinding = { key: undefined, hooks: {}, keyedHooks: {}, props: {} };
  const source: HostObservable<StandardSourceBinding> = { getSnapshot: () => absent, subscribe: () => () => {} };
  ctx.slots.installScope("session", { current: source, bindingSource: target => { if (target !== undefined) throw new Error("Root shell has no Session Slot"); return source; } });
  await ctx.remote.$mount(sessionsContribution);
  await ctx.remote.$mount(workspaceContribution);
  await ctx.remote.$mount(sessionContribution);
  ctx.slots.register({ name: "root", children: { "s1.sessions": { kind: "single", scope: "root" } } }, Shell);
  ctx.slots.register({ name: "s1.sessions" }, Surface);
  const unmount = ctx.uiRenderer.mount(document.getElementById("app")!);
  ctx.effect(() => ctx.connection.generation.subscribe(() => {
    if (!ctx.connection.generation.getSnapshot() && !authorizationWithdrawn) {
      invalidateAccess("Host connection lost. Manual Open is required after worker loss.");
    }
  }));
  window.addEventListener("pagehide", () => { release(); unmount(); void ctx.fiber.dispose(); }, { once: true });
  const previous = sessionStorage.getItem("omp-supervised-worker");
  if (previous) {
    const current = accessRevision;
    try {
      const result = await ctx.remote.ompSessions.view(JSON.parse(previous).workerId);
      if (current !== accessRevision) return;
      if (result.ok) await present(result.value);
      else errorChanged("Previous worker unavailable. Manually Open the native Session.");
    } catch { sessionStorage.removeItem("omp-supervised-worker"); }
  }
}
window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
void boot().catch(error => { document.getElementById("app")!.textContent = String(error); });
