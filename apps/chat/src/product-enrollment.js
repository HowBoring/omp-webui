/**
 * Product client bridge: enroll the stock Session View in the OMP Chat Host.
 *
 * The stock Session Controller can open and render a native Session without knowing about OMP Chat
 * admission, so `session/prompt` reaches the Host without a Chat View and is refused. This module is a
 * public client plugin: it observes the stock selected Session, retains that exact binding, and calls
 * the public `ompChatComponent/attach` Remote for the ready projection generation. It owns no runtime,
 * no transcript and no second Session store.
 */

import { sessionsContribution } from "../../../packages/contracts/sessions.ts";
import { chatComponentContribution } from "../../../packages/contracts/chat-component.ts";

const DEBUG = () => globalThis.__OMP_PRODUCT_DEBUG__ === true;
const debug = (event, details = {}) => { if (DEBUG()) console.info("OMP_PRODUCT", JSON.stringify({ event, ...details })); };
const failureText = error => error instanceof Error ? error.message : String(error);
const unwrap = result => {
  if (result && result.ok === true) return result.value;
  const error = result && result.ok === false ? result.error : undefined;
  throw new Error(error && typeof error.message === "string" ? error.message : "Remote call failed");
};

function apply(ctx) {
  let remote;
  let sessions;
  const draftId = (() => {
    const key = "omp-product-draft";
    const saved = sessionStorage.getItem(key);
    if (saved !== null && saved.length > 0) return saved;
    const created = crypto.randomUUID();
    sessionStorage.setItem(key, created);
    return created;
  })();
  let disposed = false;
  let selected;
  let attached;
  let generation;
  let reference;
  let unsubscribeProjection;
  let queue = Promise.resolve();

  const clearAttachment = () => {
    unsubscribeProjection?.();
    unsubscribeProjection = undefined;
    reference?.release();
    reference = undefined;
    attached = undefined;
    generation = undefined;
  };

  const waitReady = async binding => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const state = binding.projection.getSnapshot();
      if (state.phase === "ready") return state.binding;
      if (state.phase === "failed") throw new Error(`Session projection failed: ${String(state.error)}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error("Session projection is not ready");
  };

  const attach = async binding => {
    const projection = await waitReady(binding);
    if (!projection) throw new Error("Session projection is not ready");
    const result = unwrap(await remote.ompChatComponent.attach({
      workerId: attachedWorker, projection: { source: projection.source, generation: projection.generation }, draftId,
    }));
    generation = result.generation;
    debug("attached", { sessionId: result.sessionId, generation: result.generation });
  };

  let attachedWorker;
  const sync = async sessionId => {
    if (disposed) return;
    const current = await remote.ompSessions.current();
    const value = unwrap(current);
    const view = value?.view;
    if (!view || view.state !== "open" || view.registration.nativeSessionId !== sessionId) {
      debug("not-open", { sessionId, state: view?.state, native: view?.registration?.nativeSessionId });
      return;
    }
    if (attached !== undefined && attachedWorker === view.workerId && generation === view.generation) return;
    clearAttachment();
    if (reference === undefined) {
      const retained = sessions.retain(sessionId, { source: "ompProductChat" });
      reference = retained;
      const binding = await retained.ready;
      if (disposed || reference !== retained) return;
      attached = binding;
    }
    attachedWorker = view.workerId;
    await attach(attached);
    const binding = attached;
    unsubscribeProjection = binding.projection.subscribe(() => {
      const state = binding.projection.getSnapshot();
      if (state.phase !== "ready" || state.binding.generation === generation) return;
      const nextState = state.binding;
      void remote.ompChatComponent.attach({
        workerId: attachedWorker, projection: { source: nextState.source, generation: nextState.generation }, draftId,
      }).then(result => { generation = unwrap(result).generation; debug("renewed", { generation }); },
        error => debug("renew-failed", { error: failureText(error) }));
    });
  };

  let observe = () => {};
  const schedule = sessionId => {
    if (disposed || sessionId === undefined || String(sessionId).length === 0) return;
    selected = String(sessionId);
    queue = queue.then(() => sync(selected)).catch(error => debug("sync-failed", { sessionId: selected, error: failureText(error) }));
  };

  remote = ctx.remote;
  sessions = ctx.sessions;
  void Promise.all([remote.$mount(sessionsContribution), remote.$mount(chatComponentContribution)])
    .then(() => debug("mounted"))
    .catch(error => debug("mount-failed", { error: failureText(error) }));
  // A mounted Remote namespace is the sibling service `remote.<namespace>`; a plugin fiber may only
  // read that name from its inject, and the namespaces do not exist until `$mount` above. This child
  // scope is the public seam that waits for both and gives every namespace call the right lifetime.
  ctx.inject(["remote", "remote.ompSessions", "remote.ompChatComponent"], scoped => {
    remote = scoped.remote;
    observe = () => schedule(scoped.uiSession.adapter.current.getSnapshot()?.key);
    observe();
  });
  const off = ctx.uiSession.adapter.current.subscribe(() => observe());
  // A stock restore can publish the selection before the Host worker reports open; one bounded poll
  // closes that race without observing private Session internals.
  const timer = setInterval(() => observe(), 1000);
  ctx.effect(() => () => {
    disposed = true;
    clearInterval(timer);
    off();
    clearAttachment();
  });
}

globalThis.__ModuleLoader__.load({ id: "@omp-webui/product-enrollment", factory: () => ({ inject: ["sessions", "remote", "uiSession"], apply }) });
