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

function apply(ctx, require) {
  const React = require("react");
  const h = React.createElement;
  const { useEffect, useRef, useState } = React;
  let remote;
  let sessions;
  let openDirectories = () => {};
  const brandStyle = size => ({ display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: size, height: size, borderRadius: 6, background: "#1f6feb", color: "#fff",
    fontWeight: 700, fontSize: Math.max(10, Math.round(size * 0.55)), lineHeight: 1 });

  function BrandMark({ size }) { return h("span", { style: brandStyle(size), "data-product-brand": "mark", "aria-hidden": "true" }, "O"); }
  function BrandName() { return h("span", { "data-product-brand": "name" }, "OMP WebUI"); }
  function DirectoriesToggle() {
    return h("button", {
      type: "button", title: "Directories", "aria-label": "Directories", "data-product-directories-toggle": "",
      style: { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: 0,
        color: "inherit", cursor: "pointer", font: "inherit", padding: "6px 8px" },
      onClick: () => openDirectories(),
    }, h("span", { "aria-hidden": "true" }, "\u{1F4C1}"), h("span", {}, "Directories"));
  }
  function Directories() {
    const [open, setOpen] = useState(false);
    const [path, setPath] = useState("");
    const [review, setReview] = useState(undefined);
    const [rows, setRows] = useState([]);
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const alive = useRef(true);
    useEffect(() => () => { alive.current = false; }, []);
    useEffect(() => { openDirectories = () => setOpen(true); return () => { openDirectories = () => {}; }; }, []);
    const run = async operation => {
      setBusy(true); setNote("");
      try { await operation(); } catch (error) { if (alive.current) setNote(failureText(error)); }
      finally { if (alive.current) setBusy(false); }
    };
    const refresh = async () => {
      const list = unwrap(await remote.ompSessions.grants());
      if (!alive.current) return;
      setRows(list);
      await sessions.refresh().catch(() => {});
    };
    useEffect(() => { if (open) void run(refresh); }, [open]);
    const reviewPath = () => run(async () => {
      const preview = unwrap(await remote.ompSessions.preview(path));
      if (!alive.current) return;
      setReview(preview); setNote(`Review ${preview.path}; grant expires ${new Date(preview.expiresAt).toLocaleTimeString()}.`);
    });
    const grant = () => run(async () => {
      if (!review) return;
      unwrap(await remote.ompSessions.confirm(review.confirmation));
      if (!alive.current) return;
      setReview(undefined); await refresh(); setNote("Directory granted.");
    });
    const openGrant = grantId => run(async () => {
      const row = rows.find(candidate => candidate.id === grantId);
      if (!row) throw new Error("That directory is no longer listed.");
      const workspace = await ctx.workspaces.create({ path: row.path });
      await ctx.uiWorkspace.openWorkspace(workspace.workspaceId);
      if (alive.current) setOpen(false);
    });
    const revoke = grantId => run(async () => {
      unwrap(await remote.ompSessions.revoke(grantId));
      await refresh();
    });
    return h("div", { "data-product-directories-open": open ? "true" : "false", hidden: !open,
      style: { position: "fixed", inset: 0, zIndex: 1000, display: open ? "flex" : "none",
        alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.45)" } },
      h("aside", { role: "dialog", "aria-modal": "true", "aria-label": "Authorized directories", "data-product-directories": "",
        style: { width: "min(560px, 92vw)", maxHeight: "86vh", overflow: "auto", background: "Canvas", color: "CanvasText",
          borderRadius: 12, padding: 20, boxShadow: "0 18px 60px rgba(0,0,0,.35)" } },
        h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } },
          h("h2", { style: { margin: 0, fontSize: 18 } }, "Authorized directories"),
          h("button", { type: "button", "aria-label": "Close directories", onClick: () => setOpen(false) }, "Close")),
        h("p", {}, "Review one directory, then grant it and its descendants before creating a Session there."),
        h("div", { style: { display: "flex", gap: 8 } },
          h("input", { "aria-label": "Directory to authorize", value: path, disabled: busy,
            placeholder: "/absolute/path", style: { flex: 1, minWidth: 0, padding: "8px 10px" },
            onChange: event => { setPath(event.target.value); setReview(undefined); } }),
          h("button", { type: "button", disabled: busy || path.trim() === "", onClick: reviewPath }, "Review directory")),
        review && h("button", { type: "button", disabled: busy, onClick: grant }, "Grant this directory and descendants"),
        h("p", { role: "status", "data-product-directory-note": "" }, note),
        h("section", { "data-product-grants": "", "aria-label": "Granted directories" },
          h("button", { type: "button", disabled: busy, onClick: () => run(refresh) }, "Refresh grants and catalog"),
          rows.length === 0
            ? h("p", { "data-product-no-grants": "" }, "No directory is authorized yet.")
            : h("ul", { style: { listStyle: "none", padding: 0 } }, rows.map(row => h("li", {
              key: row.id, "data-product-grant": row.id, "data-product-grant-status": row.status,
              style: { display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid rgba(128,128,128,.3)" } },
            h("span", { style: { flex: 1, overflowWrap: "anywhere" } }, `${row.path} · ${row.status}`),
            h("button", { type: "button", "data-product-new-session": row.id, disabled: busy || row.status !== "valid",
              onClick: () => openGrant(row.id) }, "New Session here"),
            h("button", { type: "button", "data-product-revoke": row.id, disabled: busy,
              onClick: () => revoke(row.id) }, "Revoke directory")))))));
  }
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

  ctx.slots.inject("sidebar.brand.mark", () => ctx.slots.register({ name: "sidebar.brand.mark", id: "omp.brand.mark" }, BrandMark));
  ctx.slots.inject("sidebar.brand.name", () => ctx.slots.register({ name: "sidebar.brand.name", id: "omp.brand.name" }, BrandName));
  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register(
    { name: "sidebar.footer.action", id: "omp.directories.toggle", order: 10 }, DirectoriesToggle));
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "omp.directories" }, Directories));

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

globalThis.__ModuleLoader__.load({
  id: "@omp-webui/product-enrollment",
  factory: require => ({ inject: ["sessions", "remote", "uiSession", "slots", "workspaces", "uiWorkspace"], apply: ctx => apply(ctx, require) }),
});
