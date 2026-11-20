import { Context } from "@deepseek-ai/cordis";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { apply as renderer } from "@deepseek-ai/dsh-client-ui-renderer/client";
import { apply as sessions, type SessionReference } from "@deepseek-ai/dsh-api-session-controller/client";
import sessionContribution from "@deepseek-ai/dsh-api-session-controller/remote";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { SessionRequestId } from "@deepseek-ai/dsh-api-session-controller/types";
import { UiConversation } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { registerTrajectoryMessageDefinitions } from "@deepseek-ai/dsh-client-ui-trajectory/src/client/trajectory-message-definitions.ts";
import { registerTrajectoryAssistantDefinition } from "@deepseek-ai/dsh-client-ui-trajectory/src/client/trajectory-assistant-definition.ts";
import { registerTrajectoryConversationView } from "@deepseek-ai/dsh-client-ui-trajectory/src/client/trajectory-snapshot-builder.ts";
import { registerTrajectoryToolDefinition } from "@deepseek-ai/dsh-client-ui-trajectory/src/client/trajectory-tool-definition.ts";
import type { SessionBinding } from "@deepseek-ai/dsh-api-session-controller/client";
import type { PropsRenderSlots, StandardSourceBinding, HostObservable } from "@deepseek-ai/dsh-client-ui-slots";
import { useEffect, useRef, useState } from "react";
import { sessionsContribution, type PublicSessionView, type SessionSelectionId } from "../../../packages/contracts/sessions.ts";
import { chatContribution, type ChatRecovery } from "../../../packages/contracts/chat.ts";
import { chatComponentContribution } from "../../../packages/contracts/chat-component.ts";
import { attachmentContribution } from "../../../packages/contracts/attachments.ts";
import { attachmentsContribution, type AttachmentSelection } from "../../../packages/contracts/attachment-remote.ts";
import { AttachmentPreparationController } from "../../../packages/client-extensions/attachment-preparation.ts";
import { AttachmentPreparationPanel } from "../../../packages/client-extensions/attachment-preparation-panel.tsx";
import { base64Of, bytesOfBase64, decodeImage, draftBudgetFailure, imageLimits, sniffImage, type ImageKind } from "./images.ts";
import { createDraftProvider, type DraftAuthority } from "../../../packages/drafts/provider.ts";
import { DraftSubmissionId, type DraftScope } from "@deepseek-ai/dsh-client-ui-conversation/client";

declare module "@deepseek-ai/dsh-client-ui-slots" { interface SlotMap { "s1.chat": { kind: "single"; scope: "root"; owner: Record<never, never> } } }
declare module "@deepseek-ai/dsh-api-session-controller/client" { interface SessionReferenceSourceMap { supervisedChat: unknown } }

const ctx = new Context();
const tab = (() => { const saved = sessionStorage.getItem("omp-chat-tab"); if (saved) return saved; const created = crypto.randomUUID(); sessionStorage.setItem("omp-chat-tab", created); return created; })();
const owner = { id: (() => { const saved = localStorage.getItem("omp.chat.owner"); if (saved) return saved;
  const created = crypto.randomUUID(); localStorage.setItem("omp.chat.owner", created); return created; })(), active: () => true };
const authorities = new Map<string, DraftAuthority>();
const recoveryAuthorized = new Set<string>();
const provider = createDraftProvider({ owner, storage: localStorage, authority: sessionId => authorities.get(sessionId),
  authorizeRecovery: (_scope, previous) => recoveryAuthorized.has(String(previous.id)) });
let csrf = "", reference: SessionReference | undefined, liveBinding: SessionBinding | undefined, unsubscribe: (() => void) | undefined;
let currentScope: DraftScope | undefined, draftDirty = false;
let viewChanged: (view: PublicSessionView | undefined) => void = () => {}, historyChanged: (rows: unknown[]) => void = () => {};
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
    if (state.phase === "stock" && attempt >= 200) throw new Error("A projection generation is required for Chat.");
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
  sessionStorage.setItem("omp-supervised-worker", JSON.stringify({ workerId: view.workerId, generation: view.generation }));
  // Host-assigned view owner stays authoritative for the Gateway; draft storage uses the stable tab owner.
  authorities.set(view.registration.nativeSessionId, { host: "omp-webui", browser: tab, page: tab, profile: "isolated",
    source: view.registration.sourceId, instance: view.registration.instanceId, session: view.registration.nativeSessionId,
    cwd: view.cwd, draft: draftId, epoch: attached.generation });
  draftDirty = false;
  viewChanged(view);
  let saved: Awaited<ReturnType<typeof provider.read>>;
  try {
    await waitProjection(binding);
    currentScope = provider.scope(binding);
    saved = await provider.read(currentScope, new AbortController().signal);
  } catch (failure) { errorChanged(`Draft storage is not ready for this Session. ${message(failure)}`); saved = undefined; }
  if (reference !== retained || draftDirty) return;
  draftChanged(saved?.unresolved?.draft.text ?? saved?.draft.text ?? "");
  watch(binding, retained);
}
function watch(binding: SessionBinding, retained: SessionReference) {
  const target = ctx.uiConversation.binding(binding).target("trajectory");
  const render = () => {
    if (reference !== retained) return;
    const next = target.getSnapshot()?.eventNodes ?? [];
    historyChanged([...next]);
  };
  unsubscribe?.(); unsubscribe = target.subscribe(render); render();
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
type Uploaded = { objectId: string; displayName: string; mediaType: ImageKind; byteLength: number; width: number; height: number; pixels: number };
function Surface() {
  const [view, setView] = useState<PublicSessionView>(), [rows, setRows] = useState<unknown[]>([]), [error, setError] = useState("");
  const [text, setText] = useState(""), [attempt, setAttempt] = useState<Attempt>(), [recovery, setRecovery] = useState<string>();
  const [entry, setEntry] = useState("");
  const [settlement, setSettlement] = useState<{ requestId: string; terminal?: boolean; operationOutcome?: string; settled: boolean }>();
  const [cwd, setCwd] = useState(""), [confirmation, setConfirmation] = useState<string>(), [review, setReview] = useState("");
  const [originals, setOriginals] = useState<Uploaded[]>([]), [base64Draft, setBase64Draft] = useState("");
  const [controller, setController] = useState<AttachmentPreparationController>();
  const revision = useRef(0);
  type Choice = Extract<Awaited<ReturnType<typeof ctx.remote.ompSessions.catalog>>, { ok: true }>["value"]["choices"][number];
  const [choices, setChoices] = useState<Choice[]>([]);
  const [opening, setOpening] = useState(false), [busy, setBusy] = useState(false), [draftReady, setDraftReady] = useState(false);
  const [uploading, setUploading] = useState(false);
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
  const persist = async (record: Parameters<typeof provider.write>[1], reason: Parameters<typeof provider.write>[2]) => {
    const current = binding.current;
    if (!current) return;
    try {
      await waitProjection(current);
      scope.current = provider.scope(current);
      await provider.write(scope.current, record, reason);
      setDraftReady(true);
    } catch (failure) { setError(message(failure)); }
  };
  const edit = (value: string) => {
    draftDirty = true; setText(value); draftChanged(value);
    void persist({ draft: { text: value, references: [] }, originals: [] }, "edit");
  };
  const selection = (): AttachmentSelection => ({ session: view!.registration.nativeSessionId, draftId,
    revision: String(revision.current), originalIds: originals.map(item => item.objectId) });
  const stage = async (bytes: Uint8Array, displayName: string, current: Uploaded[]): Promise<Uploaded> => {
    const mediaType = sniffImage(bytes);
    if (!mediaType) throw new Error("Unsupported image. Use PNG, JPEG, WebP, or GIF whose bytes match the format.");
    const refusal = draftBudgetFailure(current, { byteLength: bytes.byteLength });
    if (refusal === "objects") throw new Error(`A draft can hold at most ${imageLimits.objects} images.`);
    if (refusal === "bytes" && bytes.byteLength > imageLimits.bytes)
      throw new Error(`Each image must be at most ${imageLimits.bytes / 1024 ** 2} MiB.`);
    if (refusal === "bytes") throw new Error(`The draft's images must total at most ${imageLimits.draftBytes / 1024 ** 2} MiB.`);
    if (refusal === "pixels") throw new Error("The draft exceeds its independent image decode budget.");
    const decoded = await decodeImage(bytes, mediaType);
    if (draftBudgetFailure(current, { byteLength: 0, pixels: decoded.pixels }) === "pixels")
      throw new Error("The draft exceeds its independent image decode budget.");
    const staged = resultValue(await ctx.remote.ompOriginals.exchange({ operation: "stage-base64",
      target: { sessionId: view!.registration.nativeSessionId, draftId },
      descriptor: { displayName, mediaType, byteLength: bytes.byteLength }, base64: base64Of(bytes) }));
    if (staged.status === "error") throw new Error(`The Host refused this image: ${staged.code}`);
    if (staged.status !== "staged") throw new Error("The Host returned an unexpected image receipt.");
    return { objectId: staged.original.objectId, displayName, mediaType, byteLength: bytes.byteLength, ...decoded };
  };
  const addFiles = async (files: FileList | File[]) => {
    if (!view) return;
    setUploading(true);
    let next = originals;
    try {
      for (const file of Array.from(files)) {
        const uploaded = await stage(new Uint8Array(await file.arrayBuffer()), file.name, next);
        next = [...next, uploaded]; ++revision.current; setOriginals(next);
      }
    } catch (failure) { setError(message(failure)); }
    finally { setUploading(false); }
  };
  const addBase64 = async () => {
    if (!view || base64Draft.trim() === "") return;
    setUploading(true);
    try {
      const bytes = bytesOfBase64(base64Draft);
      if (bytes.length === 0) throw new Error("The pasted value has no image bytes.");
      const uploaded = await stage(bytes, "pasted-image", originals);
      setOriginals([...originals, uploaded]); ++revision.current; setBase64Draft(""); setError("");
    } catch (failure) { setError(message(failure)); }
    finally { setUploading(false); }
  };
  const removeOriginal = (objectId: string) => {
    setOriginals(current => current.filter(item => item.objectId !== objectId)); ++revision.current;
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
      try { const state = resultValue(await ctx.remote.ompChat.state(sessionId)); if (!state) continue;
        setSettlement({ requestId: state.requestId, terminal: state.terminal ?? false, operationOutcome: state.operationOutcome ?? "pending", settled: state.settled });
        if (state.settled) return; } catch { return; }
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
      void settle(sessionId);
    } catch (failure) { setError(message(failure)); }
  };
  const send = async (mode: "queue" | "steer") => {
    if (!view || !binding.current || !scope.current || text.trim() === "") return;
    const current = binding.current;
    if (originals.length > 0 && mode !== "queue") {
      setError("Images are sent with Send; Steer does not accept attachments. Your draft is retained."); return;
    }
    if (sending.current) {
      const sessionId = current.sessionId;
      const settlement = resultValue(await ctx.remote.ompChat.state(sessionId));
      if (!settlement || settlement.settled) { setError("The previous prompt is still settling. Your draft is retained."); return; }
      const projection = await waitProjection(current).catch(() => undefined);
      if (!projection) { setError("Projection is synchronizing. Your draft is retained."); return; }
      const reply = await ctx.remote.session.prompt({ requestId: brandString<SessionRequestId>(crypto.randomUUID()), sessionId: SessionId(view.registration.nativeSessionId),
        mode, content: [{ type: "text", text }], projection });
      const error = reply.ok ? "Unexpected prompt acceptance." : reply.error.message;
      setError(error); setAttempt({ requestId: crypto.randomUUID(), text, mode, state: reply.ok ? "unknown" : "refused", error });
      return;
    }
    const content = text, hasImages = originals.length > 0;
    sending.current = true;
    setError(""); setRecovery(undefined);
    try { await waitProjection(current); } catch (failure) { setError(message(failure)); sending.current = false; return; }
    setBusy(true);
    const handle = current.session.beginSubmission({ mode, text: content, attachments: [] });
    const requestId = String(handle.requestId);
    setAttempt({ requestId, text: content, mode, state: "sending" });
    await persist({ draft: { text: content, references: [] }, originals: [],
      unresolved: { id: DraftSubmissionId(requestId), ownsDraft: true, draft: { text: content, references: [] }, originals: [] } }, "submission");
    const abort = new AbortController(); attemptAbort.current = abort;
    let preparation: AttachmentPreparationController | undefined;
    const resolvePreparation = async () => {
      if (!preparation) return;
      await preparation.refresh().catch(() => {});
      let snapshot = preparation.getSnapshot();
      if (snapshot.phase === "registered" || snapshot.phase === "preparing") {
        await preparation.cancel().catch(() => {});
        await preparation.refresh().catch(() => {});
        snapshot = preparation.getSnapshot();
      }
      if (("recovery" in snapshot && snapshot.recovery === "not-submitted") || snapshot.phase === "cancelled") {
        await preparation.finishAfterRecovery("not-submitted").catch(() => {});
        setController(undefined);
      }
    };
    try {
      if (hasImages) {
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
        await resolvePreparation();
        const unresolved = result.error.message.includes("unresolved");
        setAttempt({ requestId, text: content, mode, state: unresolved ? "unknown" : "refused", error: result.error.message });
        setError(result.error.message);
        if (unresolved) setRecovery("Outcome unknown. Check Native recovery before sending again.");
        else { recoveryAuthorized.add(requestId); await persist({ draft: { text: content, references: [] }, originals: [] }, "recovery"); }
      }
    } catch (failure) {
      handle.abandon();
      await resolvePreparation();
      const phase = preparation?.getSnapshot().phase;
      const notSubmitted = phase === "registered" || phase === "preparing" || phase === "failed" || phase === "cancelled";
      if (notSubmitted) {
        recoveryAuthorized.add(requestId);
        setAttempt({ requestId, text: content, mode, state: "refused", error: message(failure) });
        setError(message(failure));
        await persist({ draft: { text: content, references: [] }, originals: [] }, "recovery");
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
      <button disabled={opening || choice.directory !== "authorized"} onClick={() => void perform(() => open(choice.selectionId))}>{view ? "Switch Chat Session" : "Open Chat Session"}</button>
    </li>)}</ul>
    <section data-chat-worker-id={view?.workerId ?? ""} data-chat-native-session={view?.registration.nativeSessionId ?? ""}
      data-chat-image-count={originals.length} onDragOver={event => event.preventDefault()}
      onDrop={event => { event.preventDefault(); if (!busy) void addFiles(event.dataTransfer.files); }}>
      <h2>{view ? `Native Session ${view.registration.nativeSessionId}` : "No attached Chat Session"}</h2>
      {view && <p>Source {view.registration.sourceId} · instance {view.registration.instanceId} · actual cwd {view.cwd}</p>}
      <div id="conversation">{rows.map((row, index) => <NodeRow node={row} key={index} />)}</div>
      {attempt && <p role="status" data-chat-attempt={attempt.state}>
        {attempt.state} · {attempt.mode} · {attempt.requestId}{attempt.error ? ` · ${attempt.error}` : ""}</p>}
      {entry && <span data-chat-native-entry={entry}>{entry}</span>}
      {settlement && <p data-chat-settlement={settlement.settled ? "settled" : "running"}>{`result: ${settlement.terminal ? settlement.operationOutcome : "pending"} · settled: ${settlement.settled}`}</p>}
      <span data-chat-draft-ready={draftReady ? "true" : "false"} hidden />
      {recovery && <p role="alert">{recovery} <button onClick={() => void perform(() => recover(attempt!.requestId))}>Check Native recovery</button></p>}
      <textarea aria-label="Message" data-chat-draft value={text} disabled={!view}
        onChange={event => edit(event.target.value)}
        onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length > 0) { event.preventDefault(); if (!busy) void addFiles(files); } }} />
      <fieldset data-chat-images>
        <legend>Images for this Send</legend>
        <input aria-label="Add image files" data-chat-image-input type="file" multiple disabled={!view || busy || uploading}
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={event => { if (event.target.files) void addFiles(event.target.files); event.target.value = ""; }} />
        <textarea aria-label="Base64 image" data-chat-base64 value={base64Draft} disabled={!view || busy || uploading}
          placeholder="Paste base64 or a data:image/…;base64 URL" onChange={event => setBase64Draft(event.target.value)} />
        <button data-chat-base64-add disabled={!view || busy || uploading || base64Draft.trim() === ""}
          onClick={() => void addBase64()}>Add pasted image</button>
        {uploading && <p role="status">Decoding and staging the image…</p>}
        <ul>{originals.map(item => <li key={item.objectId} data-chat-original-id={item.objectId} data-chat-original-type={item.mediaType}>
          {item.displayName} · {item.mediaType} · {item.width}×{item.height} · {item.byteLength} bytes
          <button disabled={busy} onClick={() => removeOriginal(item.objectId)}>Remove</button>
        </li>)}</ul>
        <p>PNG, JPEG, WebP, or GIF · up to {imageLimits.objects} images · {imageLimits.bytes / 1024 ** 2} MiB each · {imageLimits.draftBytes / 1024 ** 2} MiB draft.</p>
      </fieldset>
      {controller && <AttachmentPreparationPanel controller={controller} />}
      <button data-chat-send disabled={!view || busy || uploading || text.trim() === ""} onClick={() => void send("queue")}>Send</button>
      <button data-chat-steer disabled={!view || busy || uploading || text.trim() === "" || originals.length > 0} onClick={() => void send("steer")}>Steer</button>
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
  new UiConversation(ctx, ctx.sessions); registerTrajectoryMessageDefinitions(ctx); registerTrajectoryToolDefinition(ctx); registerTrajectoryAssistantDefinition(ctx); registerTrajectoryConversationView(ctx);
  const absent: StandardSourceBinding = { key: undefined, hooks: {}, keyedHooks: {}, props: {} };
  const source: HostObservable<StandardSourceBinding> = { getSnapshot: () => absent, subscribe: () => () => {} };
  ctx.slots.installScope("session", { current: source, bindingSource: target => { if (target !== undefined) throw new Error("Root shell has no Session Slot"); return source; } });
  await ctx.remote.$mount(sessionsContribution);
  await ctx.remote.$mount(sessionContribution);
  await ctx.remote.$mount(chatContribution);
  await ctx.remote.$mount(chatComponentContribution);
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
