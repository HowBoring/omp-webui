import { Context } from "@deepseek-ai/cordis";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { apply as renderer } from "@deepseek-ai/dsh-client-ui-renderer/client";
import { apply as sessions, type SessionReference } from "@deepseek-ai/dsh-api-session-controller/client";
import sessionContribution from "@deepseek-ai/dsh-api-session-controller/remote";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { SessionProjectionBinding, SessionRequestId } from "@deepseek-ai/dsh-api-session-controller/types";
import { UiConversation } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { registerTrajectoryMessageDefinitions } from "@deepseek-ai/dsh-client-ui-trajectory/src/client/trajectory-message-definitions.ts";
import { registerTrajectoryAssistantDefinition } from "@deepseek-ai/dsh-client-ui-trajectory/src/client/trajectory-assistant-definition.ts";
import { registerTrajectoryConversationView } from "@deepseek-ai/dsh-client-ui-trajectory/src/client/trajectory-snapshot-builder.ts";
import { registerTrajectoryToolDefinition } from "@deepseek-ai/dsh-client-ui-trajectory/src/client/trajectory-tool-definition.ts";
import type { SessionBinding } from "@deepseek-ai/dsh-api-session-controller/client";
import type { PropsRenderSlots, StandardSourceBinding, HostObservable } from "@deepseek-ai/dsh-client-ui-slots";
import { useEffect, useRef, useState } from "react";
import { sessionsContribution, type PublicSessionView, type SessionPreferences, type SessionSelectionId } from "../../../packages/contracts/sessions.ts";
import { preferencesRemoteContribution } from "../../../packages/preferences/remote.ts";
import { chatContribution, type ChatRecovery } from "../../../packages/contracts/chat.ts";
import { chatComponentContribution } from "../../../packages/contracts/chat-component.ts";
import { attachmentContribution } from "../../../packages/contracts/attachments.ts";
import { attachmentsContribution, type AttachmentSelection } from "../../../packages/contracts/attachment-remote.ts";
import { AttachmentPreparationController } from "../../../packages/client-extensions/attachment-preparation.ts";
import { AttachmentPreparationPanel, attachmentFailures } from "../../../packages/client-extensions/attachment-preparation-panel.tsx";
import { base64Of, bytesOfBase64, decodeImage, type ImageKind } from "./images.ts";
import { attachmentLimits, attachmentName, classifyAttachment, draftBudgetFailure } from "./attachments.ts";
import type { OriginalMediaType } from "../../../packages/attachments/media.ts";
import { createDraftProvider, type DraftAuthority } from "../../../packages/drafts/provider.ts";
import { DraftOriginalId, DraftSubmissionId, type DraftScope, type PreparedDraftOriginal,
  type SemanticDraftRecord } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { treeContribution } from "../../../packages/contracts/tree.ts";
import { stopContribution, type ForceOffer, type StopSnapshot } from "../../../packages/contracts/stop.ts";
import { restoredDraft } from "./restore.ts";
import { TreeBrowser } from "../../../packages/tree/browser.ts";
import { TreePanel } from "../../../packages/tree/panel.tsx";
import type { TreeNode } from "../../../packages/contracts/tree.ts";
import { historyNavigationSourceContribution, type ConflictSafeDraftOffer, type HistoryNavigationSourceResult } from "../../../packages/contracts/history-navigation-source.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" { interface SlotMap { "s1.chat": { kind: "single"; scope: "root"; owner: Record<never, never> } } }
declare module "@deepseek-ai/dsh-api-session-controller/client" { interface SessionReferenceSourceMap { supervisedChat: unknown } }

const ctx = new Context();
const tab = (() => { const saved = sessionStorage.getItem("omp-chat-tab"); if (saved) return saved; const created = crypto.randomUUID(); sessionStorage.setItem("omp-chat-tab", created); return created; })();
/** A live Web Lock distinguishes this tab from a copied tab that inherited the same sessionStorage. */
async function acquireOwner(candidate: string): Promise<string> {
  // A reload's old document can still hold its lock for a moment; a copied tab holds it forever.
  for (let attempt = 0; attempt < 20; attempt++) {
    const held = await new Promise<boolean>(resolve => {
      void navigator.locks.request(`omp.chat.owner.${candidate}`, { ifAvailable: true }, lock => {
        if (lock === null) { resolve(false); return; }
        resolve(true);
        return new Promise<void>(() => {});
      });
    });
    if (held) return candidate;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return crypto.randomUUID();
}
let tabOwner = "";
const ownTab = async () => {
  const saved = sessionStorage.getItem("omp-chat-owner"), next = await acquireOwner(saved ?? tab);
  if (saved !== undefined && saved !== next) {
    // A copied tab owns the inherited draft record; start an independent Host draft scope.
    draftId = crypto.randomUUID(); sessionStorage.setItem("omp-chat-draft", draftId);
  }
  sessionStorage.setItem("omp-chat-owner", next); tabOwner = next;
};
const owner = { get id() { if (tabOwner === "") throw new Error("draft_owner_unavailable"); return tabOwner; }, active: () => true };
const authorities = new Map<string, DraftAuthority>();
const recoveryAuthorized = new Set<string>();
let attachedTarget: { sessionId: string; draftId: string } | undefined;
/** Host originals reauthorize exact bytes for this tab's draft; failures stay as ordered invalid items. */
async function prepareOriginals(scope: DraftScope, refs: readonly { id: unknown; name: string; mediaType: string }[],
  signal: AbortSignal) {
  const target = attachedTarget;
  if (!target || target.sessionId !== String(scope.nativeSessionId)) return refs.map(() => ({
    status: "invalid" as const, reason: "original_scope_unavailable" }));
  const prepared: ({ status: "ready"; file: File } | { status: "invalid"; reason: string })[] = [];
  for (const ref of refs) {
    try {
      signal.throwIfAborted();
      const value = resultValue(await ctx.remote.ompOriginals.exchange({ operation: "read-base64", target,
        objectId: String(ref.id) }));
      if (value.status !== "read") throw new Error(value.status === "error" ? value.code : value.status);
      const bytes = bytesOfBase64(value.base64);
      if (String(value.original.objectId) !== String(ref.id)) throw new Error("attachment_scope_mismatch");
      prepared.push({ status: "ready", file: new File([bytes as BlobPart], ref.name, { type: ref.mediaType }) });
    } catch (failure) { prepared.push({ status: "invalid", reason: message(failure).slice(0, 120) }); }
  }
  signal.throwIfAborted();
  return prepared;
}
const provider = createDraftProvider({ owner, storage: sessionStorage, authority: sessionId => authorities.get(sessionId),
  authorizeRecovery: (_scope, previous) => recoveryAuthorized.has(String(previous.id)), prepareOriginals });
let csrf = "", reference: SessionReference | undefined, liveBinding: SessionBinding | undefined, unsubscribe: (() => void) | undefined;
let unsubscribeProjection: (() => void) | undefined, presentationGeneration: string | undefined;
let currentScope: DraftScope | undefined, draftDirty = false;
let viewChanged: (view: PublicSessionView | undefined) => void = () => {}, historyChanged: (rows: unknown[]) => void = () => {};
let errorChanged: (error: string) => void = () => {}, draftChanged: (text: string) => void = () => {};
let draftOriginals: (items: Uploaded[]) => void = () => {}, draftNotice: (notice: string | undefined) => void = () => {};
let draftRestored: () => void = () => {}, draftPending: () => void = () => {};
/** Persisted identity of the frozen submission; hydration is the only source after a reload. */
let protectedSubmission: string | undefined;
let accessRevision = 0, presentationRevision = 0, authorizationWithdrawn = false;
let renewEnrollment: ((projection: SessionProjectionBinding) => Promise<void>) | undefined;
const message = (failure: unknown) => failure instanceof Error ? failure.message : String(failure);
const resultValue = <T,>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
let draftId = (() => {
  const saved = sessionStorage.getItem("omp-chat-draft");
  if (saved) return saved;
  const created = crypto.randomUUID(); sessionStorage.setItem("omp-chat-draft", created); return created;
})();
const ownerReady = ownTab();
function invalidateAccess(text: string) {
  ++accessRevision; release(); viewChanged(undefined); errorChanged(text);
}
function release() {
  ++presentationRevision; unsubscribe?.(); unsubscribe = undefined;
  unsubscribeProjection?.(); unsubscribeProjection = undefined;
  if (reference) { authorities.delete(String(reference.sessionId)); reference.release(); reference = undefined; }
  historyChanged([]); liveBinding = undefined;
}
async function waitProjection(binding: SessionBinding) {
  const current = () => binding.projection.getSnapshot();
  for (let attempt = 0; attempt < 2000; attempt++) {
    const state = current();
    if (state.phase === "ready") return state.binding;
    if (state.phase === "failed") throw new Error(`The Session projection failed: ${String(state.error)}.`);
    if (state.phase === "stock" && attempt >= 200) throw new Error("A projection generation is required for Chat.");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Projection is not ready for an attached Chat draft.");
}
async function waitRebuiltProjection(binding: SessionBinding, generation: string) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const state = binding.projection.getSnapshot();
    if (state.phase === "ready" && state.binding.generation === generation) return;
    if (state.phase === "failed") throw new Error(`The rebuilt Session projection failed: ${String(state.error)}.`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const state = binding.projection.getSnapshot(), session = binding.session.getSnapshot();
  throw new Error(`The rebuilt Session projection stayed ${state.phase} (open ${session.openState ?? "unknown"}, projection ${session.projectionGeneration ?? "none"}, error ${session.openError?.message ?? "none"}).`);
}
async function renewSessionProjection(view: PublicSessionView, progress: (status: string) => void = () => {}) {
  const sessionId = SessionId(view.registration.nativeSessionId);
  progress("Reading the rebuilt Session projection…");
  const current = resultValue(await ctx.remote.session.projections({ sessionId }));
  if (current?.kind !== "sequenced" || !current.projection) throw new Error("The Session projection is not available for rebuild.");
  if (liveBinding) { progress("Waiting for the rebuilt Session projection…"); await waitRebuiltProjection(liveBinding, current.projection.generation); }
  if (renewEnrollment) { progress("Renewing the Chat attachment…"); await renewEnrollment(current.projection); }
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
  presentationGeneration = projection.generation;
  if (reference !== retained) return;
  const attached = resultValue(await ctx.remote.ompChatComponent.attach({ workerId: view.workerId, projection: projection!, draftId }));
  if (reference !== retained) return;
  renewEnrollment = async projection => {
    if (reference !== retained) return;
    resultValue(await ctx.remote.ompChatComponent.attach({ workerId: view.workerId, projection, draftId }));
  };
  sessionStorage.setItem("omp-supervised-worker", JSON.stringify({ workerId: view.workerId, generation: view.generation }));
  // Host-assigned view owner stays authoritative for the Gateway; draft storage uses the stable tab owner.
  authorities.set(view.registration.nativeSessionId, { host: "omp-webui", browser: tab, page: tab, profile: "isolated",
    source: view.registration.sourceId, instance: view.registration.instanceId, session: view.registration.nativeSessionId,
    cwd: view.cwd, draft: draftId, epoch: attached.generation });
  attachedTarget = { sessionId: view.registration.nativeSessionId, draftId };
  draftDirty = false;
  // Input stays closed and empty until this Session's record is authoritative: no other Session's text or files.
  draftPending(); draftChanged(""); draftOriginals([]);
  viewChanged(view);
  let saved: SemanticDraftRecord | undefined;
  try {
    await waitProjection(binding);
    currentScope = provider.scope(binding);
    saved = await provider.read(currentScope, new AbortController().signal);
  } catch (failure) { errorChanged(`Draft storage is not ready for this Session. ${message(failure)}`); saved = undefined; }
  if (reference !== retained) return;
  if (draftDirty) { draftRestored(); return; }
  if (!saved) { protectedSubmission = undefined; draftNotice(undefined); draftChanged(""); draftOriginals([]); draftRestored(); watch(binding, retained); return; }
  // Reauthorize every stable Original through the Host before publishing text and items together.
  let prepared: readonly PreparedDraftOriginal[] | undefined;
  if (!saved.unresolved) {
    try { prepared = await provider.prepare(currentScope!, saved.originals, new AbortController().signal); }
    catch (failure) { errorChanged(`Draft originals could not be revalidated: ${message(failure)}`); }
  }
  if (reference !== retained || draftDirty) return;
  const items = saved.originals.map((ref, index) => {
    const result = prepared?.[index];
    if (result?.status !== "ready") return { objectId: String(ref.id), displayName: ref.name,
      mediaType: ref.mediaType as OriginalMediaType, byteLength: 0, pixels: 0,
      invalid: result?.reason ?? (saved.unresolved ? "An unresolved submission protects this file." : "The Host could not reauthorize this file.") };
    return { objectId: String(ref.id), displayName: ref.name,
      mediaType: (result.file.type || ref.mediaType) as OriginalMediaType, byteLength: result.file.size, pixels: 0 };
  });
  draftOriginals(items);
  draftChanged(saved.unresolved?.draft.text ?? saved.draft.text);
  protectedSubmission = saved.unresolved ? String(saved.unresolved.id) : undefined;
  draftNotice(saved.unresolved ? "An unresolved submission is protected. Check Native recovery before editing or sending." : undefined);
  draftRestored();
  watch(binding, retained);
}
function watch(binding: SessionBinding, retained: SessionReference) {
  const attach = () => {
    const target = ctx.uiConversation.binding(binding).target("trajectory");
    const render = () => {
      if (reference !== retained) return;
      historyChanged([...(target.getSnapshot()?.eventNodes ?? [])]);
    };
    unsubscribe?.(); unsubscribe = target.subscribe(render); render();
  };
  attach();
  unsubscribeProjection?.();
  unsubscribeProjection = binding.projection.subscribe(() => {
    if (reference === retained && binding.projection.getSnapshot().phase === "ready") attach();
  });
}
function SessionSettings({ view }: { view: PublicSessionView }) {
  const [prefs, setPrefs] = useState<SessionPreferences>();
  const [selection, setSelection] = useState(""), [thinking, setThinking] = useState<SessionPreferences["thinking"]["level"]>("off");
  const [status, setStatus] = useState(""), [error, setError] = useState("");
  const adopt = (next: SessionPreferences) => { setPrefs(next); setSelection(JSON.stringify([next.model.provider, next.model.id]));
    setThinking(next.thinking.level); };
  const load = async () => {
    try { adopt(resultValue(await ctx.remote.ompSessions.preferences(view.workerId))); }
    catch (failure) { setPrefs(undefined); setError(message(failure)); }
  };
  useEffect(() => { setPrefs(undefined); setStatus(""); setError(""); void load(); }, [view.workerId, view.generation]);
  const [provider, id] = (() => { try { const value = JSON.parse(selection); return Array.isArray(value) ? value : ["", ""]; }
    catch { return ["", ""]; } })() as [string, string];
  const dirty = prefs !== undefined && (provider !== prefs.model.provider || id !== prefs.model.id || thinking !== prefs.thinking.level);
  const save = async () => {
    if (!prefs || !dirty) return;
    const change: Parameters<typeof ctx.remote.ompSessions.applyPreferences>[0] = {
      workerId: view.workerId, generation: view.generation, revision: prefs.revision };
    if (provider !== prefs.model.provider || id !== prefs.model.id) change.model = { provider, id };
    if (thinking !== prefs.thinking.level) change.thinking = thinking;
    setStatus("Applying native Session settings…"); setError("");
    try { adopt(resultValue(await ctx.remote.ompSessions.applyPreferences(change)));
      await renewSessionProjection(view, setStatus);
      setStatus("The native Session confirmed the new settings."); }
    catch (failure) { setStatus(""); setError(message(failure)); void load(); }
  };
  return <section data-session-settings data-session-busy={prefs?.busy ? "true" : "false"}>
    <h3>Model and thinking</h3>
    {!prefs && !error && <p>Reading native Session settings…</p>}
    {prefs && <>
      <label>Model <select aria-label="Session model" value={selection} disabled={prefs.busy}
        onChange={event => setSelection(event.target.value)}>
        {prefs.models.some(model => model.provider === prefs.model.provider && model.id === prefs.model.id) ? null
          : <option value={JSON.stringify([prefs.model.provider, prefs.model.id])}>{prefs.model.provider} / {prefs.model.name} (current)</option>}
        {prefs.models.map(model => <option key={`${model.provider}\0${model.id}`}
          value={JSON.stringify([model.provider, model.id])}>{model.provider} / {model.name}</option>)}
      </select></label>
      <label>Thinking <select aria-label="Session thinking level" value={thinking} disabled={prefs.busy}
        onChange={event => setThinking(event.target.value as SessionPreferences["thinking"]["level"])}>
        {prefs.thinking.levels.map(level => <option key={level} value={level}>{level}</option>)}
      </select></label>
      <button data-session-settings-save disabled={prefs.busy || !dirty} onClick={() => void save()}>Apply to this Session</button>
      <p data-session-settings-revision={prefs.revision}>Revision {prefs.revision} · {prefs.models.length} native model choices
        {prefs.busy ? " · Session is busy; stop the current turn to edit." : ""}</p>
    </>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

function Appearance() {
  const [theme, setTheme] = useState("system"), [locale, setLocale] = useState(""), [localeDraft, setLocaleDraft] = useState("");
  const [revisions, setRevisions] = useState<Record<string, number>>({}), [status, setStatus] = useState(""), [error, setError] = useState("");
  const valueOf = (view: { value: unknown } | undefined, fallback: string) => {
    if (!view || typeof view.value !== "object" || view.value === null || !("preference" in view.value)
      || typeof view.value.preference !== "string") return fallback;
    return view.value.preference;
  };
  const adopt = (themeValue: string, localeValue: string, nextRevisions: Record<string, number>) => {
    setTheme(themeValue); setLocale(localeValue); setLocaleDraft(localeValue); setRevisions(nextRevisions);
  };
  const load = async () => {
    try {
      const document = resultValue(await ctx.remote.settings.describe());
      const themeView = document.namespaces.find(view => view.ns === "ui-theme");
      const localeView = document.namespaces.find(view => view.ns === "locale");
      adopt(valueOf(themeView, "system"), valueOf(localeView, ""), {
        "ui-theme": themeView?.revision ?? 0, locale: localeView?.revision ?? 0 });
    } catch (failure) { setError(message(failure)); }
  };
  useEffect(() => { void load(); }, []);
  const zh = locale.toLowerCase().startsWith("zh");
  const update = async (ns: "ui-theme" | "locale", value: string) => {
    setStatus(""); setError("");
    try {
      const next = resultValue(await ctx.remote.settings.mutate(ns,
        [{ op: "set" as const, path: ["preference"], value }], revisions[ns] ?? 0));
      const updated = { ...revisions, [ns]: next.revision };
      adopt(ns === "ui-theme" ? value : theme, ns === "locale" ? value : locale, updated);
      setStatus(zh ? "已保存到本 WebUI。" : "Saved to this WebUI.");
    } catch (failure) { setError(message(failure)); void load(); }
  };
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-chat-root-slot]");
    if (!root) return;
    root.dataset.omTheme = theme;
    root.lang = locale || "en";
  }, [theme, locale]);
  return <section data-webui-appearance>
    <legend>{zh ? "外观与语言" : "Appearance and language"}</legend>
    <label>{zh ? "主题" : "Theme"} <select aria-label="WebUI theme" value={theme}
      onChange={event => void update("ui-theme", event.target.value)}>
      <option value="system">{zh ? "跟随系统" : "System"}</option>
      <option value="light">{zh ? "浅色" : "Light"}</option>
      <option value="dark">{zh ? "深色" : "Dark"}</option>
    </select></label>
    <label>{zh ? "语言" : "Language"} <input aria-label="WebUI language" value={localeDraft}
      placeholder="en" onChange={event => setLocaleDraft(event.target.value)} />
      <button disabled={localeDraft.trim() === locale} onClick={() => void update("locale", localeDraft.trim())}>
        {zh ? "应用语言" : "Apply language"}</button></label>
    <p>{zh ? "仅作用于本 WebUI 页面，不修改其他入口。" : "Scoped to this WebUI page; other entry points are unchanged."}</p>
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

function Shell({ renderSlot }: PropsRenderSlots<"s1.chat">) {
  return <main data-chat-root-slot="true"><h1>Human Chat over the native Session</h1>
    <p>Isolated S2 component · synthetic data only · normal product admission remains blocked.</p>{renderSlot("s1.chat", {})}</main>;
}

type Node = Record<string, any>;
const blocks = (value: unknown): Node[] => Array.isArray(value) ? value.filter((part): part is Node => typeof part === "object" && part !== null) : [];
function Arguments({ value }: { value: unknown }) {
  if (value === undefined || value === null) return <span className="native-unavailable">arguments unavailable</span>;
  return <pre className="arguments">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>;
}
function NodeRow({ node }: { node: unknown }) {
  if (typeof node !== "object" || node === null) return <p className="row" data-chat-blocked="unknown-node">Unsupported history record</p>;
  const value = node as Node, kind = String(value.kind ?? "");
  if (kind === "user" || kind === "assistant" || kind === "steering" || kind === "context") {
    return <article className="row" data-chat-node={kind}>
      <h3>{kind === "assistant" ? "Assistant" : kind === "user" ? "User" : "Context"}</h3>
      {kind === "assistant" && value.usage && <p className="usage" data-chat-usage>
        {`input ${value.usage.inputTokens} · output ${value.usage.outputTokens}${value.usage.totalTokens === undefined ? "" : ` · total ${value.usage.totalTokens}`}`}</p>}
      {blocks(value.blocks ?? value.content).map((block, index) => block.kind === "reasoning" || block.type === "reasoning"
        ? <details className="reasoning" key={index}><summary>Native reasoning</summary><pre>{String(block.text ?? "")}</pre></details>
        : block.kind === "tool-call" || block.type === "toolCall"
          ? <section className="tool" data-chat-tool={String(block.name)} key={index}><strong>{String(block.name)}</strong>
              <Arguments value={block.argsParsed ?? block.argsRaw ?? block.arguments} /></section>
          : <p className="text" key={index}>{String(block.text ?? "")}</p>)}
      {value.interrupted && <p className="native-unavailable" data-chat-interrupted>Native turn interrupted</p>}
    </article>;
  }
  if (kind === "tool-call") {
    const root = ((value.data ?? {}) as Node).root as Node | undefined;
    if (!root) return <p className="row" data-chat-blocked="unknown-node">Tool call unavailable</p>;
    return <article className="row tool" data-chat-tool={String(root.name)}>
      <h3>Tool call · {String(root.name)}</h3>
      <Arguments value={root.argsParsed ?? root.argsRaw ?? root.args} />
      {root.thoughtSignature && <p className="meta" data-chat-signature>Thought signature retained</p>}
      {root.phase !== "start" && !root.argsParsed && <p className="native-unavailable">Arguments unavailable; no reconstruction was substituted.</p>}
    </article>;
  }
  if (kind === "tool-result") {
    const call = (value.call ?? {}) as Node;
    return <article className="row tool-result" data-chat-tool={String(value.name ?? value.callId ?? "")} data-chat-tool-result={String(value.name ?? value.callId ?? "")}>
      <h3>Tool result · {String(value.name || value.callId || "unpaired")}</h3>
      <Arguments value={call.argsParsed ?? call.argsRaw ?? value.args} />
      {call.thoughtSignature && <p className="signature" data-chat-signature>{String(call.thoughtSignature)}</p>}
      {blocks(value.content).map((block, index) => <p className="text" key={index}>{String(block.text ?? "Native content unavailable")}</p>)}
      {value.isError && <p className="error" data-chat-tool-error>{String(value.error?.reason ?? value.error?.code ?? "Native tool failure")}</p>}
    </article>;
  }
  if (kind === "turn-error") return <p className="row error" data-chat-turn-error>{String(value.message ?? "Native turn failed")}</p>;
  if (kind === "compaction") return <p className="row native-unavailable" data-chat-native-record="summary">Native compaction summary</p>;
  if (value.type === "omp/native-record") {
    const data = (value.data ?? {}) as Node, files = blocks(data.files);
    return <article className="row native-record" data-chat-native-record={String(data.kind ?? "unknown")}>
      <h3>{String(data.kind ?? "Native record")} · {String(data.role ?? "unknown")}</h3>
      {data.display !== false && <p className="text">{String(data.text ?? "")}</p>}
      {data.customType && <p className="meta">Native custom type {String(data.customType)}</p>}
      {files.length > 0 && <ul>{files.map((file, index) => <li key={index} data-chat-file={String(file.path)}>
        {String(file.path)} · {file.available ? `${String(file.lineCount ?? "?")} lines` : `unavailable: ${String(file.skippedReason ?? "not retained")}`}</li>)}</ul>}
      {data.unavailable && <p className="native-unavailable" data-chat-unavailable>Native payload unavailable; no reconstruction was substituted.</p>}
      {data.truncated && <p className="native-unavailable" data-chat-truncated>Native payload truncated at its source limit.</p>}
      {data.cancelled && <p className="native-unavailable" data-chat-cancelled>Native execution cancelled.</p>}
    </article>;
  }
  return <p className="row" data-chat-blocked="unknown-node">Unsupported history node {kind || String(value.type ?? "unknown")}</p>;
}

type Attempt = { requestId: string; text: string; mode: "queue" | "steer"; state: "sending" | "accepted" | "refused" | "unknown"; error?: string };
type Uploaded = { objectId: string; displayName: string; mediaType: OriginalMediaType; byteLength: number; width?: number; height?: number; pixels: number; invalid?: string };
function Surface() {
  const [view, setView] = useState<PublicSessionView>(), [rows, setRows] = useState<unknown[]>([]), [error, setError] = useState("");
  const [text, setText] = useState(""), [attempt, setAttempt] = useState<Attempt>(), [recovery, setRecovery] = useState<string>();
  const [entry, setEntry] = useState("");
  const [settlement, setSettlement] = useState<{ requestId: string; terminal?: boolean; operationOutcome?: string; settled: boolean }>();
  const [cwd, setCwd] = useState(""), [confirmation, setConfirmation] = useState<string>(), [review, setReview] = useState("");
  const [originals, setOriginals] = useState<Uploaded[]>([]), [base64Draft, setBase64Draft] = useState("");
  const [controller, setController] = useState<AttachmentPreparationController>();
  const [frozen, setFrozen] = useState(false), [retention, setRetention] = useState("");
  const revision = useRef(0), originalsRef = useRef<Uploaded[]>([]), touchTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { originalsRef.current = originals; }, [originals]);
  useEffect(() => {
    draftOriginals = (items) => setOriginals(items);
    draftNotice = (notice) => { setRecovery(notice); setFrozen(notice !== undefined && notice.startsWith("An unresolved submission")); };
    draftRestored = () => setDraftReady(true);
    draftPending = () => setDraftReady(false);
  }, []);
  // One presentation controller per attached worker. Opening or paging it is explicit and read-only.
  useEffect(() => {
    if (!view) { setTree(undefined); return; }
    const browser = new TreeBrowser(view.registration.nativeSessionId,
      request => ctx.remote.ompTree.read(request).then(resultValue));
    setTree(browser);
    return () => browser.dispose();
  }, [view?.workerId, view?.generation, view?.registration?.nativeSessionId]);
  type Choice = Extract<Awaited<ReturnType<typeof ctx.remote.ompSessions.catalog>>, { ok: true }>["value"]["choices"][number];
  const [choices, setChoices] = useState<Choice[]>([]);
  const [opening, setOpening] = useState(false), [busy, setBusy] = useState(false), [draftReady, setDraftReady] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [tree, setTree] = useState<TreeBrowser>();
  const [branchPoints, setBranchPoints] = useState<ReadonlySet<string>>(new Set());
  const [branchTarget, setBranchTarget] = useState<TreeNode>(), [branchNotice, setBranchNotice] = useState("");
  // Native allow-list per worker generation: points never survive an atomic presentation replacement.
  useEffect(() => {
    setBranchPoints(new Set()); setBranchTarget(undefined);
    if (!view) return;
    let active = true;
    void ctx.remote.ompSessions.branchPoints(view.workerId).then(result => {
      if (!active || !result.ok || result.value.generation !== view.generation) return;
      setBranchPoints(new Set(result.value.points.map(point => point.entryId)));
    }).catch(() => {});
    return () => { active = false; };
  }, [view?.workerId, view?.generation]);
  const [returned, setReturned] = useState<ConflictSafeDraftOffer>();
  const [stop, setStop] = useState<StopSnapshot>(), [force, setForce] = useState<ForceOffer>();
  const [stopNote, setStopNote] = useState("");
  const stopPoller = useRef<ReturnType<typeof setInterval>>(), restoredFor = useRef("");
  const binding = useRef<SessionBinding>(), scope = useRef<DraftScope>();
  const perform = async (action: () => Promise<void>) => {
    const current = accessRevision;
    try { setError(""); await action(); }
    catch (failure) { if (current === accessRevision) setError(message(failure)); }
  };
  const catalog = async () => setChoices(resultValue(await ctx.remote.ompSessions.catalog({ pageSize: 32 })).choices);
  const open = async (selectionId: SessionSelectionId) => {
    setOpening(true);
    try { await present(resultValue(await (view ? ctx.remote.ompSessions.switch(selectionId) : ctx.remote.ompSessions.open(selectionId)))); }
    finally { setOpening(false); }
  };
  /** Stable Original references; invalid items stay in the record so a missing file remains visible. */
  const draftRefs = () => originalsRef.current.map(item => ({ id: DraftOriginalId(item.objectId), name: item.displayName, mediaType: item.mediaType }));
  const persist = async (record: Parameters<typeof provider.write>[1], reason: Parameters<typeof provider.write>[2]) => {
    const current = binding.current;
    if (!current) return;
    try {
      await waitProjection(current);
      scope.current = provider.scope(current);
      // Ordinary edits persist whatever the draft owns; authoritative recovery decisions carry their own cleared set.
      const complete = reason === "edit" || reason === "submission" ? { ...record, originals: record.originals.length > 0 ? record.originals : draftRefs() } : record;
      await provider.write(scope.current, complete, reason);
      setDraftReady(true);
    } catch (failure) { setError(message(failure)); }
  };
  /** Explicit edits and active recovery renew the staged Originals; background hydration never does. */
  const touch = (activity: "explicit-edit" | "active-recovery") => {
    const objectIds = originalsRef.current.filter(item => item.invalid === undefined).map(item => item.objectId);
    if (!view || objectIds.length === 0) return;
    clearTimeout(touchTimer.current);
    touchTimer.current = setTimeout(() => {
      if (!view) return;
      void ctx.remote.ompOriginals.exchange({ operation: "touch", target: { sessionId: view.registration.nativeSessionId, draftId },
        activity, objectIds }).then(resultValue).then(value => {
        if (value.status === "touched") setRetention(`${activity}: ${value.renewed.length} renewed${value.unavailable.length > 0 ? `, ${value.unavailable.length} unavailable` : ""}`);
      }).catch(failure => setRetention(`${activity} not confirmed: ${message(failure)}`));
    }, 250);
  };
  const edit = (value: string) => {
    draftDirty = true; setText(value); draftChanged(value); touch("explicit-edit");
    void persist({ draft: { text: value, references: [] }, originals: draftRefs() }, "edit");
  };
  /** Every branch refusal is a stable notice: the draft, the Session and its generation stay as they were. */
  const branchMessage = (code: string) => code === "SESSION_WORKER_BUSY_STOP_REQUIRED"
    ? "Stop the current reply, wait until this Session is idle, then branch again."
    : code === "SESSION_BRANCH_TARGET_UNAVAILABLE" ? "Native does not allow a branch at this entry."
    : code === "SESSION_MANUAL_OPEN_REQUIRED" ? "This view is stale. Reopen the current Session, then branch again."
    : code === "SESSION_BRANCH_OUTCOME_UNKNOWN" ? "The native branch outcome is unknown. Open the Session list and choose a Session; nothing is replayed."
    : code === "SESSION_BRANCH_IDENTITY_UNCONFIRMED" ? "Native did not report a new Session, so no branch is shown."
    : code === "SESSION_BRANCH_LINEAGE_UNCONFIRMED" ? "The new Session's native source relation is unconfirmed, so it is not shown as created here."
    : code === "SESSION_BRANCH_RETAINED_MISMATCH" ? "The new Session did not retain exactly the selected history, so it is not shown here."
    : code;
  const branch = async (target: TreeNode) => {
    if (!view) return;
    const workerId = view.workerId, generation = view.generation;
    setBusy(true); setBranchNotice("");
    try {
      const result = await ctx.remote.ompSessions.branch({ workerId, generation, entryId: target.id });
      if (!result.ok) { setBranchNotice(branchMessage(result.error.code)); return; }
      const value = result.value;
      if (value.status === "cancelled") { setBranchNotice("Native refused the branch. This Session and its input are unchanged."); return; }
      // Atomic presentation replacement: the old worker, rows, attempt and generation are gone before the new view.
      setAttempt(undefined); setSettlement(undefined); setEntry(""); setRecovery(undefined);
      if (value.view) {
        await present(value.view);
        setBranchNotice(`Native Session ${value.nativeSessionId} created at ${value.targetEntryId}. This message and everything after it stay in the previous Session; files and external effects are not rolled back. The returned text is an unsent draft.`);
        await catalog();
      } else {
        await catalog();
        setBranchNotice(`Native Session ${value.nativeSessionId} was created but is not attached here. Open it from the Session list. Files and external effects are not rolled back.`);
      }
      if (value.text) edit(value.text);
    } finally { setBusy(false); setBranchTarget(undefined); }
  };
  /** Restored input is only ever an unsent draft: a nonempty composer wins and is never overwritten. */
  const restore = (snapshot: StopSnapshot) => {
    if (restoredFor.current === snapshot.generation) return;
    const draft = restoredDraft(snapshot, text);
    if (!draft) return;
    restoredFor.current = snapshot.generation;
    if (draft.text !== "") edit(draft.text);
    setStopNote(draft.note);
  };
  const applyStop = (snapshot: StopSnapshot) => {
    setStop(snapshot); restore(snapshot);
    if (snapshot.status === "stopping" || snapshot.status === "terminating") {
      if (!stopPoller.current) stopPoller.current = setInterval(() => {
        void ctx.remote.ompStop.state().then(resultValue).then(applyStop).catch(() => {});
      }, 250);
    } else {
      clearInterval(stopPoller.current); stopPoller.current = undefined; setForce(undefined);
    }
  };
  useEffect(() => () => clearInterval(stopPoller.current), []);
  useEffect(() => {
    if (!view) { setStop(undefined); return; }
    void ctx.remote.ompStop.state().then(resultValue).then(applyStop).catch(() => {});
  }, [view?.workerId, view?.generation]);
  const selection = (): AttachmentSelection => ({ session: view!.registration.nativeSessionId, draftId,
    revision: String(revision.current), originalIds: originals.filter(item => item.invalid === undefined).map(item => item.objectId) });
  const stage = async (bytes: Uint8Array, displayName: string, declaredType: string, current: Uploaded[]): Promise<Uploaded> => {
    if (bytes.byteLength === 0) throw new Error("The file is empty.");
    const mediaType = classifyAttachment(bytes, { name: displayName, type: declaredType });
    const image = mediaType.startsWith("image/");
    const ceiling = image ? attachmentLimits.imageBytes : attachmentLimits.documentBytes;
    const refusal = draftBudgetFailure(current, { mediaType, byteLength: bytes.byteLength });
    if (refusal === "objects") throw new Error(`A draft can hold at most ${attachmentLimits.objects} files.`);
    if (refusal === "bytes" && bytes.byteLength > ceiling)
      throw new Error(`Each ${image ? "image" : "text or document"} must be at most ${ceiling / 1024 ** 2} MiB.`);
    if (refusal === "bytes") throw new Error(`The draft's files must total at most ${attachmentLimits.draftBytes / 1024 ** 2} MiB.`);
    const decoded = image ? await decodeImage(bytes, mediaType as ImageKind) : undefined;
    if (draftBudgetFailure(current, { mediaType, byteLength: 0, pixels: decoded?.pixels }) === "pixels")
      throw new Error("The draft exceeds its independent image decode budget.");
    const name = attachmentName(displayName);
    const staged = resultValue(await ctx.remote.ompOriginals.exchange({ operation: "stage-base64",
      target: { sessionId: view!.registration.nativeSessionId, draftId },
      descriptor: { displayName: name, mediaType, byteLength: bytes.byteLength }, base64: base64Of(bytes) }));
    if (staged.status === "error") throw new Error(`The Host refused this file: ${staged.code}`);
    if (staged.status !== "staged") throw new Error("The Host returned an unexpected attachment receipt.");
    return { objectId: staged.original.objectId, displayName: name, mediaType, byteLength: bytes.byteLength,
      pixels: decoded?.pixels ?? 0, ...(decoded ? { width: decoded.width, height: decoded.height } : {}) };
  };
  const addFiles = async (files: FileList | File[]) => {
    if (!view) return;
    setUploading(true);
    let next = originals;
    try {
      for (const file of Array.from(files)) {
        const uploaded = await stage(new Uint8Array(await file.arrayBuffer()), file.name, file.type, next);
        next = [...next, uploaded]; ++revision.current; originalsRef.current = next; setOriginals(next);
        void persist({ draft: { text, references: [] }, originals: draftRefs() }, "edit");
      }
    } catch (failure) { setError(message(failure)); }
    finally { setUploading(false); }
  };
  const addBase64 = async () => {
    if (!view || base64Draft.trim() === "") return;
    setUploading(true);
    try {
      const bytes = bytesOfBase64(base64Draft);
      if (bytes.length === 0) throw new Error("The pasted value has no file bytes.");
      const uploaded = await stage(bytes, "pasted-file", "", originals);
      const next = [...originals, uploaded]; originalsRef.current = next; setOriginals(next); ++revision.current; setBase64Draft(""); setError("");
      void persist({ draft: { text, references: [] }, originals: draftRefs() }, "edit");
    } catch (failure) { setError(message(failure)); }
    finally { setUploading(false); }
  };
  const removeOriginal = async (objectId: string) => {
    try {
      const released = resultValue(await ctx.remote.ompOriginals.exchange({ operation: "release",
        target: { sessionId: view!.registration.nativeSessionId, draftId }, objectId }));
      if (released.status !== "released") throw new Error(`The Host refused removal: ${released.status === "error" ? released.code : released.status}`);
      const next = originalsRef.current.filter(item => item.objectId !== objectId);
      originalsRef.current = next; setOriginals(next); ++revision.current;
      void persist({ draft: { text, references: [] }, originals: draftRefs() }, "edit");
    } catch (failure) { setError(message(failure)); }
  };
  const recover = async (requestId: string) => {
    const result = resultValue(await ctx.remote.ompChat.lookup(view!.registration.nativeSessionId, requestId));
    applyRecovery(result, requestId);
  };
  const applyRecovery = (result: ChatRecovery, requestId: string) => {
    if (result.outcome === "accepted" || result.outcome === "not-submitted") {
      recoveryAuthorized.add(requestId); protectedSubmission = undefined;
    }
    if (result.outcome === "accepted") {
      setRecovery(undefined); setFrozen(false); setText(""); draftChanged(""); void persist({ draft: { text: "", references: [] }, originals: [] }, "recovery");
    } else if (result.outcome === "not-submitted") {
      setRecovery(undefined); setFrozen(false); touch("active-recovery");
      void persist({ draft: { text, references: [] }, originals: draftRefs() }, "recovery");
    } else if (result.outcome === "unknown" || result.outcome === "completed-without-input") {
      setRecovery("Native outcome is still unresolved. Check again after the worker settles.");
    }
  };
  const settle = async (sessionId: string) => {
    for (let i = 0; i < 60; ++i) {
      try { const state = resultValue(await ctx.remote.ompChat.state(sessionId)); if (!state) continue;
        setSettlement({ requestId: state.requestId, terminal: state.terminal ?? false, operationOutcome: state.operationOutcome ?? "pending", settled: state.settled });
        if (state.settled) {
          // A settled turn may have moved the native cut. Re-enroll against the rebuilt journal before
          // the next prompt so the Host never authorizes a stale Chat view.
          if (view) await renewSessionProjection(view).catch(() => {});
          return;
        } } catch { return; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  };
  const sending = useRef(false), attemptAbort = useRef<AbortController>();
  const finishAccepted = async (sessionId: string, requestId: string) => {
    recoveryAuthorized.add(requestId);
    await persist({ draft: { text: "", references: [] }, originals: [] }, "recovery");
    try {
      const recovered = resultValue(await ctx.remote.ompChat.lookup(sessionId, requestId));
      applyRecovery(recovered, requestId); setEntry(recovered.outcome);
      // The accepted turn may create a new native cut. Reattach once the response has landed so the
      // rebuilt journal includes the completed turn before the next prompt.
      void settle(sessionId);
    } catch (failure) { setError(message(failure)); }
  };
  const send = async (mode: "queue" | "steer") => {
    if (!view || !binding.current || !scope.current || text.trim() === "" || frozen) return;
    if (originals.some(item => item.invalid !== undefined)) { setError("Revalidate or remove the unavailable file before sending. Your draft is retained."); return; }
    const current = binding.current;
    if (originals.length > 0 && mode !== "queue") {
      setError("Files are sent with Send; Steer does not accept attachments. Your draft is retained."); return;
    }
    if (sending.current) {
      const sessionId = current.sessionId;
      const settlement = resultValue(await ctx.remote.ompChat.state(sessionId));
      if (!settlement || settlement.settled) { setError("The previous prompt is still settling. Your draft is retained."); return; }
      const projection = await waitProjection(current).catch(() => undefined);
      if (!projection) { setError("Projection is synchronizing. Your draft is retained."); return; }
      const reply = await ctx.remote.session.prompt({ requestId: brandString<SessionRequestId>(crypto.randomUUID()), sessionId: SessionId(view.registration.nativeSessionId),
        mode, content: [{ type: "text", text }], projection });
      const error = reply.ok ? "Unexpected prompt acceptance." : reply.error.message || reply.error.code;
      setError(error); setAttempt({ requestId: crypto.randomUUID(), text, mode, state: reply.ok ? "unknown" : "refused", error });
      return;
    }
    const content = text, hasAttachments = originals.length > 0;
    sending.current = true;
    setError(""); setRecovery(undefined);
    try { await waitProjection(current); await renewSessionProjection(view); } catch (failure) { setError(message(failure)); sending.current = false; return; }
    setBusy(true);
    const handle = current.session.beginSubmission({ mode, text: content, attachments: [] });
    const requestId = String(handle.requestId);
    setAttempt({ requestId, text: content, mode, state: "sending" });
    await persist({ draft: { text: content, references: [] }, originals: draftRefs(),
      unresolved: { id: DraftSubmissionId(requestId), ownsDraft: true, draft: { text: content, references: [] }, originals: draftRefs() } }, "submission");
    const abort = new AbortController(); attemptAbort.current = abort;
    let preparation: AttachmentPreparationController | undefined;
    const resolvePreparation = async (): Promise<string | undefined> => {
      if (!preparation) return;
      await preparation.refresh().catch(() => {});
      let snapshot = preparation.getSnapshot();
      if (snapshot.phase === "registered" || snapshot.phase === "preparing") {
        await preparation.cancel().catch(() => {});
        await preparation.refresh().catch(() => {});
        snapshot = preparation.getSnapshot();
      }
      const failed = snapshot.phase === "idle" ? undefined : snapshot.receipt?.items.find(item => item.status === "failed");
      const failure = failed ? `Could not prepare this attachment: ${attachmentFailures[failed.code] ?? failed.code}` : undefined;
      if (("recovery" in snapshot && snapshot.recovery === "not-submitted") || snapshot.phase === "cancelled") {
        await preparation.finishAfterRecovery("not-submitted").catch(() => {});
        setController(undefined);
      }
      return failure;
    };
    try {
      if (hasAttachments) {
        preparation = new AttachmentPreparationController(ctx.remote.ompAttachments, { current: selection });
        setController(preparation);
        await preparation.registerAttempt({ selection: selection(), submissionId: requestId, requestId }, abort.signal);
      }
      const result = await current.session.prompt([{ type: "text", text: content }], mode, undefined, handle.requestId);
      if (result.ok) {
        if (preparation) {
          await preparation.refresh().catch(() => {});
          const snapshot = preparation.getSnapshot();
          const recovery = "recovery" in snapshot ? snapshot.recovery : undefined;
          if (recovery === "accepted" || recovery === "completed-without-input") {
            await preparation.finishAfterRecovery(recovery).catch(() => {});
            setController(undefined); setOriginals([]); ++revision.current;
          }
        }
        setAttempt({ requestId, text: content, mode, state: "accepted" });
        setText(""); draftChanged("");
        void finishAccepted(current.sessionId, requestId);
      } else {
        handle.abandon();
        const failure = await resolvePreparation();
        if (failure) {
          recoveryAuthorized.add(requestId);
          setAttempt({ requestId, text: content, mode, state: "refused", error: failure });
          setError(failure);
          await persist({ draft: { text: content, references: [] }, originals: draftRefs() }, "recovery");
        } else {
          const unresolved = result.error.message.includes("unresolved");
          setAttempt({ requestId, text: content, mode, state: unresolved ? "unknown" : "refused", error: result.error.message || result.error.code });
          setError(result.error.message || result.error.code);
          if (unresolved) setRecovery("Outcome unknown. Check Native recovery before sending again.");
          else { recoveryAuthorized.add(requestId); await persist({ draft: { text: content, references: [] }, originals: draftRefs() }, "recovery"); }
        }
      }
    } catch (failure) {
      handle.abandon();
      await resolvePreparation();
      const phase = preparation?.getSnapshot().phase;
      const notSubmitted = phase === "registered" || phase === "preparing" || phase === "failed" || phase === "cancelled";
      if (notSubmitted) {
        recoveryAuthorized.add(requestId);
        const reason = await resolvePreparation() ?? message(failure);
        setAttempt({ requestId, text: content, mode, state: "refused", error: reason });
        setError(reason);
        await persist({ draft: { text: content, references: [] }, originals: draftRefs() }, "recovery");
      } else {
        setAttempt({ requestId, text: content, mode, state: "unknown", error: message(failure) });
        setError(message(failure)); setRecovery("Outcome unknown. Check Native recovery before sending again.");
      }
    } finally { attemptAbort.current = undefined; setBusy(false); sending.current = false; }
  };
  useEffect(() => {
    viewChanged = setView; historyChanged = setRows; errorChanged = setError; draftChanged = setText;
    if (binding.current) scope.current = provider.scope(binding.current);
    void perform(catalog);
    return () => { release(); };
  }, []);
  useEffect(() => { if (view && liveBinding) { binding.current = liveBinding; scope.current = provider.scope(liveBinding); } }, [view?.workerId]);
  return <div><Appearance />
    <p role="alert">{error}</p>
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
      <button disabled={opening || choice.directory !== "authorized"} onClick={() => void perform(() => open(choice.selectionId))}>{view ? "Switch Chat Session" : "Open Chat Session"}</button>
    </li>)}</ul>
    <section data-chat-worker-id={view?.workerId ?? ""} data-chat-generation={view?.generation ?? ""} data-chat-native-session={view?.registration.nativeSessionId ?? ""}
      data-chat-file-count={originals.length} onDragOver={event => event.preventDefault()}
      onDrop={event => { event.preventDefault(); if (!busy) void addFiles(event.dataTransfer.files); }}>
      <h2>{view ? `Native Session ${view.registration.nativeSessionId}` : "No attached Chat Session"}</h2>
      {view && <p>Source {view.registration.sourceId} · instance {view.registration.instanceId} · actual cwd {view.cwd}</p>}
      {view && <SessionSettings key={`${view.workerId}:${view.generation}`} view={view} />}
      <div id="conversation">{rows.map((row, index) => <NodeRow node={row} key={index} />)}</div>
      {view && tree && <div data-chat-tree><TreePanel key={`${view.workerId}:${view.generation}`} browser={tree}
        affordance={{ points: branchPoints, branch: target => { setBranchTarget(target); setBranchNotice(""); } }}
        navigation={{ sessionId: view.registration.nativeSessionId,
          action: request => ctx.remote.ompHistoryNavigationSource.action(request).then(resultValue),
          ready: (result: Extract<HistoryNavigationSourceResult, { status: "operation" }>) => {
            setReturned(result.draft);
            void perform(() => renewSessionProjection(view));
          } }}/></div>}
      {branchTarget && <section aria-label="Branch confirmation" data-chat-branch>
        <h3>Branch into a new Session?</h3>
        <p>Target {branchTarget.id}. Only the history before this message is kept; this message and everything after it stay in the current Session.</p>
        <p>Files and external effects are not rolled back. The text of this message returns as an unsent draft.</p>
        <button data-chat-branch-confirm disabled={busy || !view || view.generation === ""}
          onClick={() => void perform(() => branch(branchTarget))}>Branch at {branchTarget.id}</button>
        <button data-chat-branch-cancel onClick={() => setBranchTarget(undefined)}>Cancel</button></section>}
      {branchNotice && <p role="status" data-chat-branch-notice>{branchNotice}</p>}
      {returned && <section data-chat-returned-draft data-returned-conflict={text.trim() === "" ? "false" : "true"}>
        <h3>Returned text from {returned.originEntryId}</h3>
        <p>It was not sent. Files and external effects were not rolled back.</p>
        <pre>{returned.text}</pre>
        {text.trim() === "" ? <button data-returned-use
          onClick={() => { edit(returned.text); setReturned(undefined); }}>Put returned text in the composer</button>
          : <><p role="alert">The composer already has unsubmitted text; it is never overwritten.</p>
            <button data-returned-replace onClick={() => { edit(returned.text); setReturned(undefined); }}>Replace the current draft</button>
            <button data-returned-keep onClick={() => setReturned(undefined)}>Keep the current draft</button></>}
      </section>}
      {attempt && <p role="status" data-chat-attempt={attempt.state}>
        {attempt.state} · {attempt.mode} · {attempt.requestId}{attempt.error ? ` · ${attempt.error}` : ""}</p>}
      {entry && <span data-chat-native-entry={entry}>{entry}</span>}
      {settlement && <p data-chat-settlement={settlement.settled ? "settled" : "running"}>{`result: ${settlement.terminal ? settlement.operationOutcome : "pending"} · settled: ${settlement.settled}`}</p>}
      <span data-chat-draft-ready={draftReady ? "true" : "false"} hidden />
      <span data-chat-retention={retention} hidden />
      <span data-chat-frozen={frozen ? "true" : "false"} hidden />
      {recovery && <p role="alert">{recovery} <button onClick={() => void perform(async () => {
        const requestId = protectedSubmission ?? attempt?.requestId;
        if (!requestId) { setError("This protected submission has no recoverable request identity; reopen the Session."); return; }
        await recover(requestId);
      })}>Check Native recovery</button></p>}
      <textarea aria-label="Message" data-chat-draft value={text} disabled={!view || !draftReady}
        onChange={event => edit(event.target.value)}
        onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length > 0) { event.preventDefault(); if (!busy) void addFiles(files); } }} />
      <fieldset data-chat-attachments>
        <legend>Files for this Send</legend>
        <input aria-label="Add files" data-chat-file-input type="file" multiple disabled={!view || !draftReady || busy || uploading || frozen}
          onChange={event => { const files = event.target.files; if (files) void addFiles(files).finally(() => { event.target.value = ""; }); }} />
        <textarea aria-label="Base64 file" data-chat-base64 value={base64Draft} disabled={!view || !draftReady || busy || uploading}
          placeholder="Paste base64 or a data:…;base64 URL" onChange={event => setBase64Draft(event.target.value)} />
        <button data-chat-base64-add disabled={!view || !draftReady || busy || uploading || frozen || base64Draft.trim() === ""}
          onClick={() => void addBase64()}>Add pasted file</button>
        {uploading && <p role="status">Inspecting and staging the file…</p>}
        <ul>{originals.map(item => <li key={item.objectId} data-chat-original-id={item.objectId} data-chat-original-type={item.mediaType}
          data-chat-original-invalid={item.invalid === undefined ? undefined : "true"}>
          {item.displayName} · {item.mediaType}{item.width === undefined ? "" : ` · ${item.width}×${item.height}`} · {item.byteLength} bytes
          {item.invalid === undefined ? <button disabled={busy} onClick={() => void removeOriginal(item.objectId)}>Remove</button>
            : <span data-chat-original-invalid-reason> · {item.invalid}</span>}
        </li>)}</ul>
        <p>PNG, JPEG, WebP, GIF, UTF-8 text, PDF, DOCX, PPTX, XLSX, or EPUB · up to {attachmentLimits.objects} files · {attachmentLimits.imageBytes / 1024 ** 2} MiB image, {attachmentLimits.documentBytes / 1024 ** 2} MiB text or document · {attachmentLimits.draftBytes / 1024 ** 2} MiB draft.</p>
      </fieldset>
      {controller && <AttachmentPreparationPanel controller={controller} />}
      <button data-chat-send disabled={!view || !draftReady || busy || uploading || frozen || originals.some(item => item.invalid !== undefined) || text.trim() === ""} onClick={() => void send("queue")}>Send</button>
      <button data-chat-steer disabled={!view || !draftReady || busy || uploading || frozen || text.trim() === "" || originals.length > 0} onClick={() => void send("steer")}>Steer</button>
      <button data-chat-stop disabled={!view || stop?.status === "terminating"} onClick={() => void perform(async () => {
        setStopNote(""); applyStop(resultValue(await ctx.remote.ompStop.stop()));
      })}>Stop</button>
      {stop && stop.status !== "idle" && <div data-chat-stop-status={stop.status} data-chat-stop-interactions={stop.pending.interactions}>
        <p role="status">{`stop ${stop.status} · native ${stop.nativeSettled ? "settled" : "running"} · answers ${stop.pending.interactions} · summary ${stop.pending.history} · queue ${stop.pending.queued} · other ${stop.pending.other}`}
          {stop.failures.length > 0 ? ` · ${stop.failures.join(", ")}` : ""}</p>
        {stop.forceAvailable && !force && <button data-chat-stop-offer onClick={() => void perform(async () => {
          setForce(resultValue(await ctx.remote.ompStop.offerForce()));
        })}>Offer force termination</button>}
        {force?.status === "offered" && force.token && <button data-chat-stop-confirm onClick={() => void perform(async () => {
          const token = force.token;
          if (!token) throw new Error("The force offer has no token.");
          const result = resultValue(await ctx.remote.ompStop.confirmForce(token));
          setForce(undefined);
          if (result.status === "stale") setError("That force confirmation is stale; request a new offer.");
          else applyStop(resultValue(await ctx.remote.ompStop.state()));
        })}>Confirm force termination</button>}
      </div>}
      {stopNote && <p role="status" data-chat-stop-restored>{stopNote}</p>}
      <button data-chat-refresh disabled={!view} onClick={() => void perform(async () => {
        const latest = resultValue(await ctx.remote.ompSessions.view(view!.workerId)); await present(latest);
      })}>Refresh worker</button>
    </section>
  </div>;
}
async function boot() {
  await ownerReady;
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
  new UiConversation(ctx, ctx.sessions); registerTrajectoryMessageDefinitions(ctx); registerTrajectoryToolDefinition(ctx); registerTrajectoryAssistantDefinition(ctx); registerTrajectoryConversationView(ctx);
  const absent: StandardSourceBinding = { key: undefined, hooks: {}, keyedHooks: {}, props: {} };
  const source: HostObservable<StandardSourceBinding> = { getSnapshot: () => absent, subscribe: () => () => {} };
  ctx.slots.installScope("session", { current: source, bindingSource: target => { if (target !== undefined) throw new Error("Root shell has no Session Slot"); return source; } });
  await ctx.remote.$mount(sessionsContribution);
  await ctx.remote.$mount(sessionContribution);
  await ctx.remote.$mount(preferencesRemoteContribution);
  await ctx.remote.$mount(chatContribution);
  await ctx.remote.$mount(chatComponentContribution);
  await ctx.remote.$mount(treeContribution);
  await ctx.remote.$mount(historyNavigationSourceContribution);
  await ctx.remote.$mount(stopContribution);
  await ctx.remote.$mount(attachmentContribution);
  await ctx.remote.$mount(attachmentsContribution);
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
    } catch (error) { sessionStorage.removeItem("omp-supervised-worker"); errorChanged(message(error)); }
  }
}
window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
void boot().catch(error => { document.getElementById("app")!.textContent = message(error); });
