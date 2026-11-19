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
import type { SessionBinding } from "@deepseek-ai/dsh-api-session-controller/client";
import type { PropsRenderSlots, StandardSourceBinding, HostObservable } from "@deepseek-ai/dsh-client-ui-slots";
import { useEffect, useRef, useState } from "react";
import { sessionsContribution, type PublicSessionView, type SessionSelectionId } from "../../../packages/contracts/sessions.ts";
import { chatContribution, type ChatRecovery } from "../../../packages/contracts/chat.ts";
import { chatComponentContribution } from "../../../packages/contracts/chat-component.ts";
import { createDraftProvider, type DraftAuthority } from "../../../packages/drafts/provider.ts";
import { DraftSubmissionId, type DraftScope } from "@deepseek-ai/dsh-client-ui-conversation/client";

declare module "@deepseek-ai/dsh-client-ui-slots" { interface SlotMap { "s1.chat": { kind: "single"; scope: "root"; owner: Record<never, never> } } }
declare module "@deepseek-ai/dsh-api-session-controller/client" { interface SessionReferenceSourceMap { supervisedChat: unknown } }

const ctx = new Context();
const tab = crypto.randomUUID();
const owner = { id: "", active: () => true };
const authorities = new Map<string, DraftAuthority>();
const recoveryAuthorized = new Set<string>();
const provider = createDraftProvider({ owner, storage: localStorage, authority: sessionId => authorities.get(sessionId),
  authorizeRecovery: (_scope, previous) => recoveryAuthorized.has(String(previous.id)) });
let csrf = "", reference: SessionReference | undefined, liveBinding: SessionBinding | undefined, unsubscribe: (() => void) | undefined;
let viewChanged: (view: PublicSessionView | undefined) => void = () => {}, historyChanged: (rows: string[]) => void = () => {};
let errorChanged: (error: string) => void = () => {}, draftChanged: (text: string) => void = () => {};
let accessRevision = 0, presentationRevision = 0, authorizationWithdrawn = false;
const message = (failure: unknown) => failure instanceof Error ? failure.message : String(failure);
const resultValue = <T,>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const draftId = (() => {
  const saved = sessionStorage.getItem("omp-chat-draft");
  if (saved) return saved;
  const created = crypto.randomUUID(); sessionStorage.setItem("omp-chat-draft", created); return created;
})();
function invalidateAccess(text: string) {
  ++accessRevision; release(); viewChanged(undefined); errorChanged(text);
}
function release() {
  ++presentationRevision; unsubscribe?.(); unsubscribe = undefined;
  if (reference) { authorities.delete(String(reference.sessionId)); reference.release(); reference = undefined; }
  historyChanged([]); liveBinding = undefined;
}
async function waitProjection(binding: SessionBinding) {
  const current = () => binding.projection.getSnapshot();
  for (let attempt = 0; attempt < 2000; attempt++) {
    const state = current();
    if (state.phase === "ready") return state.binding;
    if (state.phase === "stock") throw new Error("A projection generation is required for Chat.");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Projection is not ready for an attached Chat draft.");
}
async function present(view: PublicSessionView) {
  release();
  const current = presentationRevision, access = accessRevision;
  await ctx.sessions.refresh();
  if (current !== presentationRevision || access !== accessRevision) return;
  const retained = ctx.sessions.retain(SessionId(view.registration.nativeSessionId), { source: "supervisedChat" });
  reference = retained;
  const binding = await retained.ready;
  if (reference !== retained) return;
  liveBinding = binding;
  const projection = await waitProjection(binding);
  if (reference !== retained) return;
  const attached = resultValue(await ctx.remote.ompChatComponent.attach({ workerId: view.workerId, projection: projection!, draftId }));
  if (reference !== retained) return;
  owner.id = attached.owner;
  authorities.set(view.registration.nativeSessionId, { host: "omp-webui", browser: tab, page: tab, profile: "isolated",
    source: view.registration.sourceId, instance: view.registration.instanceId, session: view.registration.nativeSessionId,
    cwd: view.cwd, draft: draftId, epoch: attached.generation });
  viewChanged(view);
  const scope = provider.scope(binding);
  const saved = await provider.read(scope, new AbortController().signal);
  draftChanged(saved?.unresolved?.draft.text ?? saved?.draft.text ?? "");
  const target = ctx.uiConversation.binding(binding).target("trajectory");
  const render = () => { if (reference === retained) historyChanged((target.getSnapshot()?.eventNodes ?? []).map(node => JSON.stringify(node))); };
  unsubscribe = target.subscribe(render); render();
}
function Shell({ renderSlot }: PropsRenderSlots<"s1.chat">) {
  return <main data-chat-root-slot="true"><h1>Human Chat over the native Session</h1>
    <p>Isolated S2 component · synthetic data only · normal product admission remains blocked.</p>{renderSlot("s1.chat", {})}</main>;
}
type Attempt = { requestId: string; text: string; mode: "queue" | "steer"; state: "sending" | "accepted" | "refused" | "unknown"; error?: string };
function Surface() {
  const [view, setView] = useState<PublicSessionView>(), [rows, setRows] = useState<string[]>([]), [error, setError] = useState("");
  const [text, setText] = useState(""), [attempt, setAttempt] = useState<Attempt>(), [recovery, setRecovery] = useState<string>();
  const [entry, setEntry] = useState("");
  const [cwd, setCwd] = useState(""), [confirmation, setConfirmation] = useState<string>(), [review, setReview] = useState("");
  type Choice = Extract<Awaited<ReturnType<typeof ctx.remote.ompSessions.catalog>>, { ok: true }>["value"]["choices"][number];
  const [choices, setChoices] = useState<Choice[]>([]);
  const [opening, setOpening] = useState(false), [busy, setBusy] = useState(false);
  const binding = useRef<SessionBinding>(), scope = useRef<DraftScope>();
  const perform = async (action: () => Promise<void>) => {
    const current = accessRevision;
    try { setError(""); await action(); }
    catch (failure) { if (current === accessRevision) setError(message(failure)); }
  };
  const catalog = async () => setChoices(resultValue(await ctx.remote.ompSessions.catalog({ pageSize: 32 })).choices);
  const open = async (selectionId: SessionSelectionId) => {
    setOpening(true);
    try { await present(resultValue(await ctx.remote.ompSessions.open(selectionId))); }
    finally { setOpening(false); }
  };
  const persist = async (record: Parameters<typeof provider.write>[1], reason: Parameters<typeof provider.write>[2]) => {
    const current = binding.current;
    if (!current) return;
    try {
      await waitProjection(current);
      scope.current = provider.scope(current);
      await provider.write(scope.current, record, reason);
    } catch (failure) { setError(message(failure)); }
  };
  const edit = (value: string) => {
    setText(value); draftChanged(value);
    void persist({ draft: { text: value, references: [] }, originals: [] }, "edit");
  };
  const recover = async (requestId: string) => {
    const result = resultValue(await ctx.remote.ompChat.lookup(view!.registration.nativeSessionId, requestId));
    applyRecovery(result, requestId);
  };
  const applyRecovery = (result: ChatRecovery, requestId: string) => {
    if (result.outcome === "accepted" || result.outcome === "not-submitted") recoveryAuthorized.add(requestId);
    if (result.outcome === "accepted") {
      setRecovery(undefined); setText(""); draftChanged(""); void persist({ draft: { text: "", references: [] }, originals: [] }, "recovery");
    } else if (result.outcome === "not-submitted") {
      setRecovery(undefined); void persist({ draft: { text, references: [] }, originals: [] }, "recovery");
    } else if (result.outcome === "unknown" || result.outcome === "completed-without-input") {
      setRecovery("Native outcome is still unresolved. Check again after the worker settles.");
    }
  };
  const settle = async (sessionId: string) => {
    for (let i = 0; i < 60; ++i) {
      try { const state = resultValue(await ctx.remote.ompChat.state(sessionId)); if (!state) continue; if (state.settled) return; } catch { return; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  };
  const sending = useRef(false);
  const finishAccepted = async (sessionId: string, requestId: string) => {
    recoveryAuthorized.add(requestId);
    await persist({ draft: { text: "", references: [] }, originals: [] }, "recovery");
    try {
      const recovered = resultValue(await ctx.remote.ompChat.lookup(sessionId, requestId));
      applyRecovery(recovered, requestId); setEntry(recovered.outcome);
      void settle(sessionId);
    } catch (failure) { setError(message(failure)); }
  };
  const send = async (mode: "queue" | "steer") => {
    if (!view || !binding.current || !scope.current || text.trim() === "") return;
    if (sending.current) { setError("Projection is synchronizing. Your draft is retained."); return; }
    const content = text, current = binding.current;
    sending.current = true;
    setError(""); setRecovery(undefined);
    try { await waitProjection(current); } catch (failure) { setError(message(failure)); return; }
    setBusy(true);
    const handle = current.session.beginSubmission({ mode, text: content, attachments: [] });
    const requestId = String(handle.requestId);
    setAttempt({ requestId, text: content, mode, state: "sending" });
    await persist({ draft: { text: content, references: [] }, originals: [],
      unresolved: { id: DraftSubmissionId(requestId), ownsDraft: true, draft: { text: content, references: [] }, originals: [] } }, "submission");
    try {
      const result = await current.session.prompt([{ type: "text", text: content }], mode, undefined, handle.requestId);
      if (result.ok) {
        setAttempt({ requestId, text: content, mode, state: "accepted" });
        setText(""); draftChanged("");
        void finishAccepted(current.sessionId, requestId);
      } else {
        handle.abandon();
        const unresolved = result.error.message.includes("unresolved");
        setAttempt({ requestId, text: content, mode, state: unresolved ? "unknown" : "refused", error: result.error.message });
        setError(result.error.message);
        if (unresolved) setRecovery("Outcome unknown. Check Native recovery before sending again.");
        else { recoveryAuthorized.add(requestId); await persist({ draft: { text: content, references: [] }, originals: [] }, "recovery"); }
      }
    } catch (failure) {
      handle.abandon();
      setAttempt({ requestId, text: content, mode, state: "unknown", error: message(failure) });
      setError(message(failure)); setRecovery("Outcome unknown. Check Native recovery before sending again.");
    } finally { setBusy(false); sending.current = false; }
  };
  useEffect(() => {
    viewChanged = setView; historyChanged = setRows; errorChanged = setError; draftChanged = setText;
    if (binding.current) scope.current = provider.scope(binding.current);
    void perform(catalog);
    return () => { release(); };
  }, []);
  useEffect(() => { if (view && liveBinding) { binding.current = liveBinding; scope.current = provider.scope(liveBinding); } }, [view?.workerId]);
  return <div><p role="alert">{error}</p>
    <input aria-label="Directory to authorize" value={cwd} onChange={event => { setCwd(event.target.value); setConfirmation(undefined); }} />
    <button disabled={!cwd} onClick={() => void perform(async () => {
      const preview = resultValue(await ctx.remote.ompSessions.preview(cwd));
      setReview(preview.path); setConfirmation(preview.confirmation);
    })}>Review directory</button>
    {confirmation && <button onClick={() => void perform(async () => {
      resultValue(await ctx.remote.ompSessions.confirm(confirmation)); setConfirmation(undefined); await catalog();
    })}>Grant this directory and descendants</button>}
    <p role="status">{review}</p>
    <button onClick={() => void perform(catalog)}>Refresh catalog</button>
    <ul>{choices.map(choice => <li key={choice.selectionId} data-native-id={choice.nativeSessionId}>
      <span>{choice.title ?? choice.nativeSessionId} · {choice.cwd ?? "unknown cwd"} · {choice.directory}</span>
      <button disabled={opening || choice.directory !== "authorized"} onClick={() => void perform(() => open(choice.selectionId))}>Open Chat Session</button>
    </li>)}</ul>
    <section data-chat-worker-id={view?.workerId ?? ""} data-chat-native-session={view?.registration.nativeSessionId ?? ""}>
      <h2>{view ? `Native Session ${view.registration.nativeSessionId}` : "No attached Chat Session"}</h2>
      {view && <p>Source {view.registration.sourceId} · instance {view.registration.instanceId} · actual cwd {view.cwd}</p>}
      <div id="conversation">{rows.map((row, index) => <pre className="row" key={index}>{row}</pre>)}</div>
      {attempt && <p role="status" data-chat-attempt={attempt.state}>
        {attempt.state} · {attempt.mode} · {attempt.requestId}{attempt.error ? ` · ${attempt.error}` : ""}</p>}
      {entry && <span data-chat-native-entry={entry}>{entry}</span>}
      {recovery && <p role="alert">{recovery} <button onClick={() => void perform(() => recover(attempt!.requestId))}>Check Native recovery</button></p>}
      <textarea aria-label="Message" data-chat-draft value={text} disabled={!view}
        onChange={event => edit(event.target.value)} />
      <button data-chat-send disabled={!view || busy || text.trim() === ""} onClick={() => void send("queue")}>Send</button>
      <button data-chat-steer disabled={!view || busy || text.trim() === ""} onClick={() => void send("steer")}>Steer</button>
      <button data-chat-cancel disabled={!view} onClick={() => void perform(async () => { resultValue(await binding.current!.session.cancel()); })}>Cancel</button>
      <button data-chat-refresh disabled={!view} onClick={() => void perform(async () => {
        const latest = resultValue(await ctx.remote.ompSessions.view(view!.workerId)); await present(latest);
      })}>Refresh worker</button>
    </section>
  </div>;
}
async function boot() {
  const auth = await fetch("/auth/status", { cache: "no-store" });
  if (!auth.ok) { document.getElementById("app")!.textContent = "Browser authorization required. Open a local bootstrap link."; return; }
  csrf = (await auth.json()).csrf;
  installConnection(ctx, { location, transport: { async fetch(input, init) {
    const headers = new Headers(init.headers); headers.set("x-omp-csrf", csrf);
    const response = await fetch(input, { ...init, headers });
    if (response.status === 401 && !authorizationWithdrawn) {
      authorizationWithdrawn = true;
      invalidateAccess("Browser authorization required. Open a local bootstrap link.");
    }
    return response;
  } } });
  registry(ctx); gateway(ctx); renderer(ctx); sessions(ctx, { projectionRebuild: true });
  new UiConversation(ctx, ctx.sessions); registerTrajectoryMessageDefinitions(ctx); registerTrajectoryAssistantDefinition(ctx); registerTrajectoryConversationView(ctx);
  const absent: StandardSourceBinding = { key: undefined, hooks: {}, keyedHooks: {}, props: {} };
  const source: HostObservable<StandardSourceBinding> = { getSnapshot: () => absent, subscribe: () => () => {} };
  ctx.slots.installScope("session", { current: source, bindingSource: target => { if (target !== undefined) throw new Error("Root shell has no Session Slot"); return source; } });
  await ctx.remote.$mount(sessionsContribution);
  await ctx.remote.$mount(sessionContribution);
  await ctx.remote.$mount(chatContribution);
  await ctx.remote.$mount(chatComponentContribution);
  ctx.slots.register({ name: "root", children: { "s1.chat": { kind: "single", scope: "root" } } }, Shell);
  ctx.slots.register({ name: "s1.chat" }, Surface);
  const unmount = ctx.uiRenderer.mount(document.getElementById("app")!);
  window.addEventListener("pagehide", () => { release(); provider.dispose(); unmount(); void ctx.fiber.dispose(); }, { once: true });
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
void boot().catch(error => { document.getElementById("app")!.textContent = message(error); });
