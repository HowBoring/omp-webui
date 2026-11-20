import { useEffect, useState, useSyncExternalStore } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { TreeNode } from "../contracts/tree.ts";
import { treeContribution } from "../contracts/tree.ts";
import { TreeBrowser } from "./browser.ts";
import type { HistoryNavigationSourceRequest, HistoryNavigationSourceResult } from "../contracts/history-navigation-source.ts";

/** Native allow-list only: a node is branchable because the native command said so, never from its kind. */
export type BranchAffordance = { points: ReadonlySet<string>; branch(node: TreeNode): void };
export interface TreeNavigation {
  sessionId: string;
  action(request: HistoryNavigationSourceRequest): Promise<HistoryNavigationSourceResult>;
  ready(result: Extract<HistoryNavigationSourceResult, { status: "operation" }>): void;
}
export interface OriginalLink {
  entryId: string; objectId: string; displayName: string; mediaType: string; byteLength: number;
  sha256: string; availability: "available" | "missing";
}
/** Public read-only links. The URL re-authorizes and rechecks retention on every open, never once for the page. */
export interface OriginalLinks {
  sessionId: string;
  load(entryId: string): Promise<OriginalLink[]>;
  href(entryId: string, objectId: string, disposition: "inline" | "attachment"): string;
}

/** Same-origin read-only links; the Host re-authorizes and rechecks retention on every open. */
export function historicalOriginals(sessionId: string): OriginalLinks {
  return {
    sessionId,
    load: async entryId => {
      const query = new URLSearchParams({ sessionId, entryId });
      const response = await fetch(`/api/ompOriginals/history?${query}`, { credentials: "same-origin",
        headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`originals_http_${response.status}`);
      const body = await response.json() as { items?: OriginalLink[] };
      return body.items ?? [];
    },
    href: (entryId, objectId, disposition) =>
      `/api/ompOriginals/original?${new URLSearchParams({ sessionId, entryId, objectId, disposition })}`,
  };
}

function OriginalFiles({ entryId, links }: { entryId: string; links: OriginalLinks | undefined }) {
  const [state, setState] = useState<{ entryId?: string; phase: "idle" | "loading" | "ready" | "error";
    items?: OriginalLink[]; code?: string }>({ phase: "idle" });
  useEffect(() => {
    if (!links || !entryId) { setState({ phase: "idle" }); return; }
    let live = true;
    setState({ entryId, phase: "loading" });
    void links.load(entryId).then(items => { if (live) setState({ entryId, phase: "ready", items }); },
      error => { if (live) setState({ entryId, phase: "error", code: error instanceof Error ? error.message : String(error) }); });
    return () => { live = false; };
  }, [entryId, links?.sessionId]);
  return <section aria-label="Original files" data-originals-entry={entryId} data-originals-phase={state.entryId === entryId ? state.phase : "loading"}>
    <h4>Original files</h4>
    <p>These are the files that were attached, not the model input or the extracted text. Each open rechecks this browser,
      the directory grant and this exact Session.</p>
    {state.entryId === entryId && state.phase === "loading" && <p role="status">Checking retained Originals…</p>}
    {state.entryId === entryId && state.phase === "error" && <p role="alert">Originals unavailable ({state.code}).
      The retained Native history is unchanged.</p>}
    {state.entryId === entryId && state.phase === "ready" && links && (state.items?.length
      ? <ul>{state.items.map(item => <li key={item.objectId} data-original-object={item.objectId}
        data-original-availability={item.availability}><span>{item.displayName} · {item.mediaType} · {item.byteLength} bytes</span>
        {item.availability === "available" ? <> <a href={links.href(entryId, item.objectId, "inline")} target="_blank"
          rel="noreferrer">Open original</a> <a href={links.href(entryId, item.objectId, "attachment")}
          download={item.displayName}>Download original</a></> : <span> The stored original file is missing;
          the Native history and its causal association are preserved.</span>}</li>)}</ul>
      : <p>No original is associated with this retained entry. Imported native history, messages without
        attachments and non-original model inputs have none.</p>)}
  </section>;
}

function NodeButton({ node, browser, affordance, navigation, inspect }: { node: TreeNode; browser: TreeBrowser;
  affordance?: BranchAffordance | undefined; navigation: TreeNavigation | undefined; inspect: ((entryId: string) => void) | undefined }) {
  const state = browser.getSnapshot();
  return <><button disabled={state.pending || state.phase !== "complete"}
    aria-pressed={state.selectedId === node.id} onClick={() => void browser.select(node.id)}>
    {node.id} · {node.boundary ?? node.role ?? node.kind} · {node.active ? "active path" : "other branch"}
  </button>{affordance?.points.has(node.id) && <button data-chat-branch-point={node.id}
    onClick={() => affordance.branch(node)}>Branch here</button>}
    {navigation && inspect && <button data-navigation-target={node.id}
    onClick={() => inspect(node.id)}>Return to before this entry…</button>}</>;
}
function Segment({ nodes, browser, affordance, navigation, inspect }: { nodes: TreeNode[]; browser: TreeBrowser;
  affordance?: BranchAffordance | undefined; navigation: TreeNavigation | undefined;
  inspect: ((entryId: string) => void) | undefined }) {
  const [count, setCount] = useState(64);
  return <><ol>{nodes.slice(0, count).map(node => <li key={node.id}><NodeButton node={node} browser={browser} affordance={affordance}
    navigation={navigation} inspect={inspect}/></li>)}</ol>
    {nodes.length > count && <button onClick={() => setCount(count + 64)}>Show more retained nodes</button>}</>;
}
function ActivePath({ browser, affordance, navigation, inspect }: { browser: TreeBrowser; affordance?: BranchAffordance | undefined;
  navigation: TreeNavigation | undefined; inspect: ((entryId: string) => void) | undefined }) {
  const state = browser.getSnapshot(), nodes = new Map(state.pages.flat().map(node => [node.id, node]));
  const segments: { nodes: TreeNode[]; boundary?: TreeNode }[] = [];
  let pending: TreeNode[] = [];
  for (const id of state.activePath) {
    const node = nodes.get(id);
    if (!node) continue; // The Host publishes a complete path only after validating every parent.
    if (node.boundary) { segments.push({ nodes: pending, boundary: node }); pending = []; }
    else pending.push(node);
  }
  segments.push({ nodes: pending });
  return <section aria-label="Current active path"><h3>Current active path</h3>{segments.map((segment, index) =>
    <section key={segment.boundary?.id ?? "current"}>{segment.boundary ? <>
      <details><summary>Retained history before {segment.boundary.boundary} ({segment.nodes.length} nodes)</summary>
        <Segment key={`${index}-${segment.boundary.id}`} nodes={segment.nodes} browser={browser} affordance={affordance}
          navigation={navigation} inspect={inspect}/></details>
      <p>Native {segment.boundary.boundary} boundary: <NodeButton node={segment.boundary} browser={browser} affordance={affordance}
        navigation={navigation} inspect={inspect}/></p>
    </> : <Segment key="current" nodes={segment.nodes} browser={browser} affordance={affordance} navigation={navigation}
      inspect={inspect}/>}</section>)}</section>;
}
/** Small public React surface. Explicit Open/Page/Select; rendering never opens a Session or sends input. */
export function TreePanel({ browser, affordance, navigation, originals }: { browser: TreeBrowser;
  affordance?: BranchAffordance | undefined; navigation?: TreeNavigation; originals?: OriginalLinks }) {
  const state = useSyncExternalStore(browser.subscribe, browser.getSnapshot, browser.getSnapshot);
  const [returnState, setReturnState] = useState<{ busy: boolean; result?: HistoryNavigationSourceResult; error?: string }>({ busy: false });
  async function act(request: HistoryNavigationSourceRequest): Promise<void> {
    setReturnState({ busy: true });
    try {
      const result = await navigation!.action(request);
      setReturnState({ busy: false, result });
      if (result.status === "operation" && result.outcome === "committed") {
        browser.invalidate("navigation_pending");
        await browser.open();
        navigation!.ready(result);
      }
    } catch (error) {
      setReturnState({ busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const inspect = navigation ? (entryId: string) => void act({ operation: "inspect", sessionId: navigation.sessionId, entryId }) : undefined;
  const confirmation = returnState.result?.status === "confirmation" ? returnState.result : undefined;
  const operation = returnState.result?.status === "operation" ? returnState.result : undefined;
  useEffect(() => {
    if (state.expiresAt === undefined) return;
    const timer = setTimeout(() => browser.invalidate("tree_snapshot_expired"), Math.max(0, state.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [browser, state.expiresAt]);
  return <section aria-label="Read-only Session Tree"><h2>Session Tree</h2>
    <p>Session: {browser.sessionId}</p><p>Current native leaf: {state.position ? state.position.leafId ?? "none" : "unavailable"}</p>
    <p>Selected preview: {state.selectedId ?? "none"}</p>
    <p>Displayed retained history is not an exact model-input audit. Native-pruned content cannot be reconstructed.</p>
    <button disabled={state.pending} onClick={() => void browser.open()}>Open current tree</button>
    {state.error && <p role="alert">{state.error === "tree_preview_budget"
      ? "This entry exceeds the preview limit. You can select another entry."
      : `${state.error}. Open the current tree again.`}</p>}
    <p role="status">{state.phase === "partial" ? "Partial native tree; load remaining pages before preview." : state.phase}</p>
    {state.position && <><p>Source version: {state.position.contentRevision}; durability: not attested</p>
      <section aria-label="Native tree page"><h3>{state.phase === "complete" ? "Complete native tree" : "Native tree pages"}</h3>
        <p>Page {state.visiblePage + 1} of {state.pages.length} loaded pages; each row names its native parent.</p>
        <ol>{state.pages[state.visiblePage]?.map(node => <li key={node.id}>
          <NodeButton node={node} browser={browser} affordance={affordance} navigation={navigation} inspect={inspect}/> <span>parent: {node.parentId ?? "root"}</span></li>)}</ol>
        <button disabled={state.visiblePage === 0} onClick={() => browser.showPage(state.visiblePage - 1)}>Previous loaded page</button>
        <button disabled={state.visiblePage + 1 >= state.pages.length}
          onClick={() => browser.showPage(state.visiblePage + 1)}>Next loaded page</button>
        <button disabled={state.pending || state.phase !== "partial"}
          onClick={() => void browser.nextPage()}>Load next native page</button></section>
      {state.phase === "complete" && <ActivePath browser={browser} affordance={affordance} navigation={navigation} inspect={inspect}/>}</>}
    {navigation && <section aria-label="Return to history" data-navigation-panel data-navigation-phase={returnState.busy ? "busy"
      : returnState.error ? "error" : returnState.result?.status ?? "idle"}>
      <h3>Return to history</h3>
      <p>Native selection only. Files and external effects are not rolled back. Nothing is sent automatically.</p>
      {returnState.error && <p role="alert">{returnState.error}</p>}
      {returnState.result?.status === "error" && <p role="alert" data-navigation-error={returnState.result.code}>{returnState.result.code}</p>}
      {confirmation && <div data-navigation-confirmation>
        <p>Original Session: {confirmation.sessionId}</p>
        <p>Target entry: {confirmation.entryId}; actual parent: {confirmation.targetParentId ?? "root"}</p>
        <p>{confirmation.notice}</p>
        <button disabled={returnState.busy} data-navigation-confirm
          onClick={() => void act({ operation: "confirm", token: confirmation.token })}>Confirm return in this Session</button>
        <button disabled={returnState.busy} data-navigation-cancel
          onClick={() => void act({ operation: "cancel", token: confirmation.token })}>Cancel</button>
      </div>}
      {operation && <div data-navigation-operation={operation.outcome}>
        <p>Native outcome: {operation.outcome}; persisted: {operation.persistence}; projection: {operation.projection}</p>
        <p>Actual leaf: {operation.actualLeafId ?? "unknown"}; commit: {operation.commitId ?? "unknown"}</p>
        {operation.draft && <p>Returned text is available in the composer area as an explicit draft choice.</p>}
        {operation.draftUnavailable && <p>Returned text unavailable: {operation.draftUnavailable}</p>}
      </div>}
    </section>}
    {state.preview && <section aria-label="Selected node preview"><h3>Preview {state.preview.node.id}</h3>
      <pre>{state.preview.text}</pre>
      <OriginalFiles entryId={state.preview.node.id} links={originals}/></section>}
  </section>;
}

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap { "omp.history": { kind: "single"; scope: "root"; owner: { sessionId: string; authorityEpoch: string } } }
}
/** Opt-in slot; its owner must key/remount on the current authorized Session/projection/connection binding. */
export async function registerReadonlyTree(ctx: Context): Promise<() => void> {
  const unmount = await ctx.remote.$mount(treeContribution);
  function BoundTree({ sessionId, authorityEpoch }: PropsRuntime<"omp.history">) {
    return <SessionTree key={`${sessionId}:${authorityEpoch}`} sessionId={sessionId}/>;
  }
  function SessionTree({ sessionId }: { sessionId: string }) {
    const [browser] = useState(() => new TreeBrowser(sessionId, async request => {
      const result = await ctx.remote.ompTree.read(request);
      return result.ok ? result.value : { status: "error", code: "tree_remote_unavailable" };
    }));
    useEffect(() => () => browser.dispose(), [browser]);
    return <TreePanel browser={browser} originals={historicalOriginals(sessionId)}/>;
  }
  const unregister = ctx.slots.register({ name: "omp.history" }, BoundTree);
  return () => { unregister(); void unmount(); };
}
