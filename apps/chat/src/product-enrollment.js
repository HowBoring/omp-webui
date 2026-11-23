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
import { treeContribution } from "../../../packages/contracts/tree.ts";
import { historyNavigationSourceContribution } from "../../../packages/contracts/history-navigation-source.ts";
import { TreeBrowser } from "../../../packages/tree/browser.ts";

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
  const { useEffect, useRef, useState, useSyncExternalStore } = React;
  let remote;
  let sessions;
  let conversation;
  let uiWorkspace;
  let openDirectories = () => {};
  let openHistory = () => {};
  let openSessions = () => {};
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
  function HistoryToggle() {
    return h("button", {
      type: "button", title: "History", "aria-label": "History", "data-product-history-toggle": "",
      style: { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: 0,
        color: "inherit", cursor: "pointer", font: "inherit", padding: "6px 8px" },
      onClick: () => openHistory(),
    }, h("span", { "aria-hidden": "true" }, "\u{1F333}"), h("span", {}, "History"));
  }
  const modal = (label, children, onClose) => h("div", {
    style: { position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center",
      justifyContent: "center", background: "rgba(0,0,0,.45)" } },
    h("aside", { role: "dialog", "aria-modal": "true", "aria-label": label,
      "data-product-history": "", style: { width: "min(760px, 94vw)", maxHeight: "88vh", overflow: "auto",
        background: "Canvas", color: "CanvasText", borderRadius: 12, padding: 20,
        boxShadow: "0 18px 60px rgba(0,0,0,.35)" } },
      h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } },
        h("h2", { style: { margin: 0, fontSize: 18 } }, label),
        h("button", { type: "button", "aria-label": `Close ${label}`, onClick: onClose }, "Close")),
      children));
  const originalFiles = (sessionId, preview, items) => h("section", { "aria-label": "Original files",
    "data-product-originals": preview.node.id },
    h("h4", {}, "Original files"),
    h("p", {}, "These are the files that were attached, not the model input. Each open rechecks this browser, the directory grant and this exact Session."),
    items?.error !== undefined ? h("p", { role: "alert" }, `Originals unavailable (${items.error}). Native history is unchanged.`)
      : items === undefined ? h("p", { role: "status" }, "Checking retained Originals…")
      : items.length === 0 ? h("p", {}, "No original is associated with this retained entry.")
      : h("ul", {}, items.map(item => h("li", { key: item.objectId, "data-original-object": item.objectId,
        "data-original-availability": item.availability },
        h("span", {}, `${item.displayName} · ${item.mediaType} · ${item.byteLength} bytes`),
        item.availability === "available" ? " " : h("span", {}, " The stored original file is missing; the Native history and its causal association are preserved."),
        item.availability === "available" && h("a", { href: `/api/ompOriginals/original?${new URLSearchParams({ sessionId,
          entryId: preview.node.id, objectId: item.objectId, disposition: "inline" })}`, target: "_blank", rel: "noreferrer" }, "Open original"),
        item.availability === "available" && " ",
        item.availability === "available" && h("a", { download: item.displayName,
          href: `/api/ompOriginals/original?${new URLSearchParams({ sessionId, entryId: preview.node.id,
            objectId: item.objectId, disposition: "attachment" })}` }, "Download original")))));
  const branchFailure = code => code === "SESSION_WORKER_BUSY_STOP_REQUIRED"
    ? "Stop the current reply, wait until this Session is idle, then branch again."
    : code === "SESSION_BRANCH_TARGET_UNAVAILABLE" ? "Native does not allow a branch at this entry."
    : code === "SESSION_MANUAL_OPEN_REQUIRED" ? "This view is stale. Reopen the current Session, then branch again."
    : code === "SESSION_BRANCH_OUTCOME_UNKNOWN" ? "The native branch outcome is unknown. Open the Session list and choose a Session; nothing is replayed."
    : code === "SESSION_BRANCH_IDENTITY_UNCONFIRMED" ? "Native did not report a new Session, so no branch is shown."
    : code === "SESSION_BRANCH_LINEAGE_UNCONFIRMED" ? "The new Session's native source relation is unconfirmed, so it is not shown as created here."
    : code === "SESSION_BRANCH_RETAINED_MISMATCH" ? "The new Session did not retain exactly the selected history, so it is not shown here."
    : code;
  /** Returned text is always an unsent draft: keep an existing composer draft instead of overwriting it. */
  const initializeDraft = async (sessionId, text) => {
    if (text === undefined || text === "") return "empty";
    const retained = sessions.retain(sessionId, { source: "ompProductHistory" });
    try {
      await retained.ready;
      return conversation.input.requestDraftInitialization(retained.binding,
        { prompt: text, whenDraftExists: "keep" });
    } finally { retained.release(); }
  };
  function TreeSurface({ view, onClose }) {
    const [browser] = useState(() => new TreeBrowser(view.registration.nativeSessionId,
      request => remote.ompTree.read(request).then(unwrap)));
    const state = useSyncExternalStore(browser.subscribe, browser.getSnapshot, browser.getSnapshot);
    const [points, setPoints] = useState(() => new Set());
    const [note, setNote] = useState("");
    const [navigation, setNavigation] = useState();
    const [branchTarget, setBranchTarget] = useState();
    const [originals, setOriginals] = useState();
    const [busy, setBusy] = useState(false);
    useEffect(() => {
      let live = true;
      void browser.open();
      void remote.ompSessions.branchPoints(view.workerId).then(result => {
        const value = unwrap(result);
        if (live && value.generation === view.generation) setPoints(new Set(value.points.map(point => point.entryId)));
      }).catch(() => {});
      return () => { live = false; browser.dispose(); };
    }, [browser]);
    useEffect(() => {
      if (state.expiresAt === undefined) return;
      const timer = setTimeout(() => browser.invalidate("tree_snapshot_expired"), Math.max(0, state.expiresAt - Date.now()));
      return () => clearTimeout(timer);
    }, [browser, state.expiresAt]);
    useEffect(() => {
      const entryId = state.preview?.node.id;
      if (entryId === undefined) { setOriginals(undefined); return; }
      let live = true;
      const query = new URLSearchParams({ sessionId: view.registration.nativeSessionId, entryId });
      void fetch(`/api/ompOriginals/history?${query}`, { credentials: "same-origin", headers: { accept: "application/json" } })
        .then(response => response.ok ? response.json() : Promise.reject(new Error(`originals_http_${response.status}`)))
        .then(body => { if (live) setOriginals(Array.isArray(body.items) ? body.items : []); },
          error => { if (live) setOriginals({ error: failureText(error) }); });
      return () => { live = false; };
    }, [state.preview?.node.id]);
    const act = async request => {
      setBusy(true); setNote("");
      try {
        await browser.suspend();
        const result = unwrap(await remote.ompHistoryNavigationSource.action(request));
        setNavigation(result);
        if (result.status !== "operation" || result.outcome !== "committed") return;
        browser.invalidate("navigation_pending");
        await browser.open();
        if (result.draft !== undefined) {
          const applied = await initializeDraft(view.registration.nativeSessionId, result.draft.text);
          setNote(applied === "applied" || applied === "empty"
            ? "Returned text is an unsent draft in the composer."
            : "The composer kept its draft; the returned text was not forced over it.");
        } else if (result.draftUnavailable !== undefined) {
          setNote(`Returned text unavailable: ${result.draftUnavailable}`);
        }
      } catch (error) { setNote(failureText(error)); }
      finally { setBusy(false); }
    };
    const branch = async target => {
      setBusy(true); setNote("");
      try {
        await browser.suspend();
        const outcome = unwrap(await remote.ompSessions.branch(
          { workerId: view.workerId, generation: view.generation, entryId: target.id }));
        if (outcome.status === "cancelled") {
          setNote("Native refused the branch. This Session and its input are unchanged.");
          return;
        }
        await sessions.refresh().catch(() => {});
        uiWorkspace.openSession(outcome.nativeSessionId);
        let applied = "unavailable", draftError = "";
        try { applied = await initializeDraft(outcome.nativeSessionId, outcome.text); }
        catch (error) { draftError = ` The returned draft was unavailable: ${failureText(error)}`; }
        setNote(`Native Session ${outcome.nativeSessionId} created at ${outcome.targetEntryId}. `
          + (applied === "applied" || applied === "empty" ? "The returned text is an unsent draft. " : `The returned text is not in the composer.${draftError} `)
          + "Files and external effects are not rolled back.");
        onClose();
      } catch (error) { setNote(branchFailure(failureText(error))); await browser.open().catch(() => {}); }
      finally { setBusy(false); setBranchTarget(undefined); }
    };
    const nodes = state.pages[state.visiblePage] ?? [];
    return h("div", { "data-product-tree-session": view.registration.nativeSessionId },
      h("p", { role: "status", "data-product-tree-phase": state.phase },
        state.phase === "partial" ? "Partial native tree; load remaining pages before preview." : state.phase),
      h("p", {}, `Session: ${view.registration.nativeSessionId}`),
      h("p", {}, `Current native leaf: ${state.position?.leafId ?? "unavailable"}`),
      h("p", {}, `Selected preview: ${state.selectedId ?? "none"}`),
      h("p", {}, "Displayed retained history is not an exact model-input audit. Native-pruned content cannot be reconstructed."),
      state.error !== undefined && h("p", { role: "alert", "data-product-tree-error": state.error },
        state.error === "tree_preview_budget" ? "This entry exceeds the preview limit. Choose another entry."
          : `${state.error}. Open the current tree again.`),
      h("button", { type: "button", "data-product-tree-open": "", disabled: state.pending,
        onClick: () => void browser.open() }, "Open current tree"),
      h("ol", { "data-product-tree-page": String(state.visiblePage) }, nodes.map(node => h("li", { key: node.id },
        h("button", { type: "button", "data-product-tree-node": node.id, "aria-pressed": state.selectedId === node.id,
          disabled: state.pending || state.phase !== "complete", onClick: () => void browser.select(node.id) },
        `${node.id} · ${node.boundary ?? node.role ?? node.kind} · ${node.active ? "active path" : "other branch"}`),
        points.has(node.id) && h("button", { type: "button", "data-product-tree-branch": node.id, disabled: busy || state.pending,
          onClick: () => { setBranchTarget(node); setNote(""); } }, "Branch here"),
        h("button", { type: "button", "data-product-tree-inspect": node.id,
          disabled: busy || state.pending || state.phase !== "complete", onClick: () => void act(
            { operation: "inspect", sessionId: view.registration.nativeSessionId, entryId: node.id }) },
        "Return to before this entry…")))),
      h("button", { type: "button", disabled: state.visiblePage === 0, onClick: () => browser.showPage(state.visiblePage - 1) },
        "Previous loaded page"),
      h("button", { type: "button", disabled: state.visiblePage + 1 >= state.pages.length,
        onClick: () => browser.showPage(state.visiblePage + 1) }, "Next loaded page"),
      h("button", { type: "button", disabled: state.pending || state.phase !== "partial",
        onClick: () => void browser.nextPage() }, "Load next native page"),
      state.phase === "complete" && h("section", { "data-product-tree-active-path": String(state.activePath.length) },
        h("h3", {}, "Current active path"), h("p", { style: { overflowWrap: "anywhere" } }, state.activePath.join(" \u2192 "))),
      state.preview !== undefined && h("section", { "aria-label": "Selected node preview",
        "data-product-tree-preview": state.preview.node.id },
        h("h3", {}, `Preview ${state.preview.node.id}`), h("pre", { style: { whiteSpace: "pre-wrap" } }, state.preview.text),
        originalFiles(view.registration.nativeSessionId, state.preview, originals)),
      navigation !== undefined && h("section", { "aria-label": "Return to history",
        "data-product-navigation-phase": navigation.status === "operation" ? navigation.outcome : navigation.status },
        h("h3", {}, "Return to history"),
        h("p", {}, "Native selection only. Files and external effects are not rolled back. Nothing is sent automatically."),
        navigation.status === "confirmation" && h("div",
          { "data-product-navigation-confirmation": navigation.token },
          h("p", {}, `Target entry: ${navigation.entryId}; actual parent: ${navigation.targetParentId ?? "root"}`),
          h("p", {}, "Confirming keeps the history before this entry in the same Session."),
          h("button", { type: "button", disabled: busy, "data-product-navigation-confirm": "",
            onClick: () => void act({ operation: "confirm", token: navigation.token }) }, "Confirm return in this Session"),
          h("button", { type: "button", disabled: busy,
            onClick: () => void act({ operation: "cancel", token: navigation.token }) }, "Cancel")),
        navigation.status === "operation" && h("div", { "data-product-navigation-operation": navigation.outcome },
          h("p", {}, `Native outcome: ${navigation.outcome}; persisted: ${navigation.persistence}; projection: ${navigation.projection}`),
          h("p", {}, `Actual leaf: ${navigation.actualLeafId ?? "unknown"}; commit: ${navigation.commitId ?? "unknown"}`),
          navigation.draft !== undefined && h("p", {}, "Returned text is available in the composer as an unsent draft."),
          navigation.draftUnavailable !== undefined && h("p", {}, `Returned text unavailable: ${navigation.draftUnavailable}`)),
        navigation.status === "error" && h("p", { role: "alert", "data-product-navigation-error": navigation.code }, navigation.code)),
      branchTarget !== undefined && h("section", { "aria-label": "Branch confirmation", "data-product-branch-confirm": branchTarget.id },
        h("h3", {}, "Branch into a new Session?"),
        h("p", {}, `Target ${branchTarget.id}. Only the history before this message is kept; this message and everything after it stay in the current Session.`),
        h("p", {}, "Files and external effects are not rolled back. The text of this message returns as an unsent draft."),
        h("button", { type: "button", disabled: busy, "data-product-branch-apply": "",
          onClick: () => void branch(branchTarget) }, `Branch at ${branchTarget.id}`),
        h("button", { type: "button", disabled: busy, onClick: () => setBranchTarget(undefined) }, "Cancel")),
      note === "" ? null : h("p", { role: "status", "data-product-history-note": "" }, note));
  }
  function SessionsToggle() {
    return h("button", {
      type: "button", title: "Sessions", "aria-label": "Sessions", "data-product-sessions-toggle": "",
      style: { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: 0,
        color: "inherit", cursor: "pointer", font: "inherit", padding: "6px 8px" },
      onClick: () => openSessions(),
    }, h("span", { "aria-hidden": "true" }, "\u{1F4DA}"), h("span", {}, "Sessions"));
  }
  /**
   * The stock shell has no explicit Open: a read after a Host or worker restart is refused with the
   * typed manual-open marker and only an explicit public Open starts a new native worker. This panel is
   * that affordance; it lists only authorized Sessions and replays nothing.
   */
  function Sessions({ onClose }) {
    const [registered, setRegistered] = useState([]);
    const [choices, setChoices] = useState([]);
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const alive = useRef(true);
    useEffect(() => () => { alive.current = false; }, []);
    const load = async () => {
      const [index, catalog] = await Promise.all([
        remote.ompSessions.index({ pageSize: 32 }).then(unwrap),
        remote.ompSessions.catalog({ pageSize: 32 }).then(unwrap),
      ]);
      if (!alive.current) return;
      setRegistered(index.records); setChoices(catalog.choices);
      if (catalog.status !== "complete") setNote("Native discovery is partial; only listed Sessions can be opened here.");
    };
    useEffect(() => { void load().catch(error => { if (alive.current) setNote(failureText(error)); }); }, []);
    const open = choice => {
      setBusy(true); setNote("");
      void remote.ompSessions.open(choice.selectionId).then(result => {
        unwrap(result);
        return load().then(() => { if (alive.current) setNote(`Opened ${choice.nativeSessionId} as a new native worker.`); });
      }).catch(error => { if (alive.current) setNote(failureText(error)); })
        .finally(() => { if (alive.current) setBusy(false); });
    };
    const rows = new Map();
    for (const record of registered) rows.set(record.nativeSessionId, { record });
    for (const choice of choices) rows.set(choice.nativeSessionId, { ...rows.get(choice.nativeSessionId), choice });
    return modal("Sessions", h("div", { "data-product-sessions": "" },
      h("p", {}, "Opening a Session starts a new native worker for it. Nothing is replayed."),
      h("button", { type: "button", disabled: busy, onClick: () => { setBusy(true); setNote("");
        void load().catch(error => setNote(failureText(error))).finally(() => setBusy(false)); } }, "Refresh Sessions"),
      rows.size === 0 ? h("p", { role: "status" }, "No authorized Session is listed yet.")
        : h("ul", { style: { listStyle: "none", padding: 0 } }, [...rows].map(([nativeSessionId, row]) => {
          const attempt = row.record?.attempt;
          return h("li", { key: nativeSessionId, "data-product-session": nativeSessionId,
            "data-product-session-attempt": attempt?.code ?? attempt?.state ?? "unavailable",
            style: { display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid rgba(128,128,128,.3)" } },
          h("span", { style: { flex: 1, overflowWrap: "anywhere" } },
            `${row.choice?.title ?? nativeSessionId} · ${row.choice?.cwd ?? "unknown directory"}`,
            attempt === undefined ? "" : ` · last attempt ${attempt.state}${attempt.code ? ` · ${attempt.code}` : ""}`,
            !row.choice ? " · not discovered now" : ""),
          h("button", { type: "button", disabled: busy || !row.choice, "data-product-open-session": nativeSessionId,
            onClick: () => open(row.choice) }, "Open Session"));
        })),
      note === "" ? null : h("p", { role: "status", "data-product-sessions-note": "" }, note)), onClose);
  }
  function SessionsOverlay() {
    const [open, setOpen] = useState(false);
    useEffect(() => { openSessions = () => setOpen(true); return () => { openSessions = () => {}; }; }, []);
    return open ? h(Sessions, { onClose: () => setOpen(false) }) : null;
  }
  function HistoryOverlay() {
    const [open, setOpen] = useState(false);
    useEffect(() => { openHistory = () => setOpen(true); return () => { openHistory = () => {}; }; }, []);
    return open ? h(History, { onClose: () => setOpen(false) }) : null;
  }
  function History({ onClose }) {
    const [view, setView] = useState();
    const [error, setError] = useState("");
    useEffect(() => {
      let live = true;
      void remote.ompSessions.current().then(unwrap).then(current => {
        if (!live) return;
        const value = current?.view;
        if (value === undefined || value.state !== "open") {
          setError("Open a native Session before reading its tree.");
          return;
        }
        setView(value);
      }, failure => { if (live) setError(failureText(failure)); });
      return () => { live = false; };
    }, []);
    return modal("Session Tree", error !== "" ? h("p", { role: "alert" }, error)
      : view === undefined ? h("p", { role: "status" }, "Reading the native Session\u2026")
      : h(TreeSurface, { view, onClose }), onClose);
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
    attachedProjection = undefined;
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

  // attach() reports the worker generation, not the projection generation, so renew
  // against the projection identity actually attached instead of that result.
  const projectionKey = projection => `${projection.source}\u0000${projection.generation}`;
  let attachedProjection;
  const attach = async binding => {
    const projection = await waitReady(binding);
    if (!projection) throw new Error("Session projection is not ready");
    const result = unwrap(await remote.ompChatComponent.attach({
      workerId: attachedWorker, projection: { source: projection.source, generation: projection.generation }, draftId,
    }));
    generation = result.generation;
    attachedProjection = projectionKey(projection);
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
      if (state.phase !== "ready" || projectionKey(state.binding) === attachedProjection) return;
      const nextState = state.binding;
      void remote.ompChatComponent.attach({
        workerId: attachedWorker, projection: { source: nextState.source, generation: nextState.generation }, draftId,
      }).then(result => {
        generation = unwrap(result).generation;
        attachedProjection = projectionKey(nextState);
        debug("renewed", { generation });
      }, error => debug("renew-failed", { error: failureText(error) }));
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
  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register(
    { name: "sidebar.footer.action", id: "omp.history.toggle", order: 20 }, HistoryToggle));
  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register(
    { name: "sidebar.footer.action", id: "omp.sessions.toggle", order: 30 }, SessionsToggle));
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "omp.directories" }, Directories));
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "omp.history" }, HistoryOverlay));
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "omp.sessions" }, SessionsOverlay));

  remote = ctx.remote;
  sessions = ctx.sessions;
  uiWorkspace = ctx.uiWorkspace;
  void Promise.all([remote.$mount(sessionsContribution), remote.$mount(chatComponentContribution),
    remote.$mount(treeContribution), remote.$mount(historyNavigationSourceContribution)])
    .then(() => debug("mounted"))
    .catch(error => debug("mount-failed", { error: failureText(error) }));
  // A mounted Remote namespace is the sibling service `remote.<namespace>`; a plugin fiber may only
  // read that name from its inject, and the namespaces do not exist until `$mount` above. This child
  // scope is the public seam that waits for both and gives every namespace call the right lifetime.
  ctx.inject(["remote", "remote.ompSessions", "remote.ompChatComponent", "remote.ompTree",
    "remote.ompHistoryNavigationSource", "conversation", "uiWorkspace"], scoped => {
    remote = scoped.remote;
    conversation = scoped.conversation;
    uiWorkspace = scoped.uiWorkspace;
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
  factory: require => ({ inject: ["sessions", "remote", "uiSession", "slots", "workspaces", "uiWorkspace", "conversation"], apply: ctx => apply(ctx, require) }),
});
