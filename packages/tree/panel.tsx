import { useEffect, useState, useSyncExternalStore } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { TreeNode } from "../contracts/tree.ts";
import { treeContribution } from "../contracts/tree.ts";
import { TreeBrowser } from "./browser.ts";

/** Native allow-list only: a node is branchable because the native command said so, never from its kind. */
export type BranchAffordance = { points: ReadonlySet<string>; branch(node: TreeNode): void };
function NodeButton({ node, browser, affordance }: { node: TreeNode; browser: TreeBrowser; affordance?: BranchAffordance | undefined }) {
  const state = browser.getSnapshot();
  return <><button disabled={state.pending || state.phase !== "complete"}
    aria-pressed={state.selectedId === node.id} onClick={() => void browser.select(node.id)}>
    {node.id} · {node.boundary ?? node.role ?? node.kind} · {node.active ? "active path" : "other branch"}
  </button>{affordance?.points.has(node.id) && <button data-chat-branch-point={node.id}
    onClick={() => affordance.branch(node)}>Branch here</button>}</>;
}
function Segment({ nodes, browser, affordance }: { nodes: TreeNode[]; browser: TreeBrowser; affordance?: BranchAffordance | undefined }) {
  const [count, setCount] = useState(64);
  return <><ol>{nodes.slice(0, count).map(node => <li key={node.id}><NodeButton node={node} browser={browser} affordance={affordance}/></li>)}</ol>
    {nodes.length > count && <button onClick={() => setCount(count + 64)}>Show more retained nodes</button>}</>;
}
function ActivePath({ browser, affordance }: { browser: TreeBrowser; affordance?: BranchAffordance | undefined }) {
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
        <Segment key={`${index}-${segment.boundary.id}`} nodes={segment.nodes} browser={browser} affordance={affordance}/></details>
      <p>Native {segment.boundary.boundary} boundary: <NodeButton node={segment.boundary} browser={browser} affordance={affordance}/></p>
    </> : <Segment key="current" nodes={segment.nodes} browser={browser} affordance={affordance}/>}</section>)}</section>;
}
/** Small public React surface. Explicit Open/Page/Select; rendering never opens a Session or sends input. */
export function TreePanel({ browser, affordance }: { browser: TreeBrowser; affordance?: BranchAffordance | undefined }) {
  const state = useSyncExternalStore(browser.subscribe, browser.getSnapshot, browser.getSnapshot);
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
          <NodeButton node={node} browser={browser} affordance={affordance}/> <span>parent: {node.parentId ?? "root"}</span></li>)}</ol>
        <button disabled={state.visiblePage === 0} onClick={() => browser.showPage(state.visiblePage - 1)}>Previous loaded page</button>
        <button disabled={state.visiblePage + 1 >= state.pages.length}
          onClick={() => browser.showPage(state.visiblePage + 1)}>Next loaded page</button>
        <button disabled={state.pending || state.phase !== "partial"}
          onClick={() => void browser.nextPage()}>Load next native page</button></section>
      {state.phase === "complete" && <ActivePath browser={browser} affordance={affordance}/>}</>}
    {state.preview && <section aria-label="Selected node preview"><h3>Preview {state.preview.node.id}</h3>
      <pre>{state.preview.text}</pre><p>Attachment Originals: association unproven; no original download is offered here.</p></section>}
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
    return <TreePanel browser={browser}/>;
  }
  const unregister = ctx.slots.register({ name: "omp.history" }, BoundTree);
  return () => { unregister(); void unmount(); };
}
