import { expect, test } from "bun:test";
import { HistoryClient } from "../../packages/contracts/generated/history-client.ts";
import type { HistoryCut, HistoryItem, HistoryOpen } from "../../packages/contracts/generated/omp-wire.ts";
import { sourceFixture } from "./source-fixture.ts";

/** Public native ports only: the Host reads a synthetic tree and answers with its own decisions. */
const cut: HistoryCut = { durability: "not_attested", sourceBindingStatus: "worker", sourceId: "source",
  sessionId: "native-session", workerId: "worker", contextId: "context", contentRevision: "content-v1",
  nativeRevision: 7, retainedRevision: "retained-v1", leafId: "entry-1", observationSeq: 8 };
const opened: HistoryOpen = { version: "coherent-history-v1", handoff: "current", snapshot: "native-snapshot",
  cursor: "cursor-0", cursors: { tree: "cursor-0", active: "active", running: "running", live: "live" },
  scope: "tree", cut, expiresAt: Date.now() + 100_000, count: 3, streaming: false, compacting: false,
  prefix: null, scannedBytes: 100, scanMs: 1, snapshotMs: 1,
  limits: { entries: 20000, runningMessages: 10000, scanItems: 60000, bytes: 1000000, nativeItemBytes: 1000000,
    itemBytes: 512 * 1024, ms: 1000, snapshotBytes: 256 * 1024 * 1024, cacheBytes: 512 * 1024 * 1024, snapshots: 8,
    pageItems: 32, pageBytes: 768 * 1024, responseBytes: 1024 * 1024, ttlMs: 100000, contentItems: 64,
    contentPageBytes: 10000, liveEvents: 1024, liveBytes: 1000000, pollItems: 100 } };
const user = (id: string, parentId: string | null, text: string): HistoryItem =>
  ({ id, parentId, active: true, text, kind: "message", role: "user" });
const source = [user("entry-0", null, "Retained question"), user("entry-1", "entry-0", "Branch target"),
  user("entry-x", "entry-0", "Sibling question")];
const destination = [user("entry-0", null, "Retained question")];
function history(rows: () => HistoryItem[]) {
  let opens = 0, served = false, current: HistoryItem[] = [], snapshot = "";
  return new HistoryClient(async command => {
    if (command.type === "history_snapshot_close") { served = false; return { closed: true }; }
    if (command.type === "history_snapshot_open") {
      if (command.scope !== "tree") throw Error("UNEXPECTED_SCOPE");
      current = rows(); served = false; snapshot = `snapshot-${++opens}`;
      return { ...structuredClone(opened), snapshot, cursor: `cursor-${snapshot}`, count: current.length };
    }
    if (command.type !== "history_snapshot_page") throw Error("UNEXPECTED_OPERATION");
    const items = command.cursor === `cursor-${snapshot}` && !served ? (served = true, current) : [];
    return { snapshot, scope: "tree", cut, expiresAt: opened.expiresAt, items, complete: true };
  });
}
async function fixture(options: { destination?: HistoryItem[]; branchSessionId?: string; branchParent?: string } = {}) {
  const branched = options.destination ?? destination;
  const f = await sourceFixture(Date.now, undefined,
    history(() => f.controls.sessionId === "native-session" ? source : branched));
  const openedView = await f.supervisor.open(f.identity, f.selected);
  f.controls.branchPoints = [{ entryId: "entry-0", text: "Retained question" }, { entryId: "entry-1", text: "Branch target" }];
  f.controls.branchSessionId = options.branchSessionId; f.controls.branchParent = options.branchParent ?? "/synthetic/source.jsonl";
  return { f, openedView };
}

test("a busy Session refuses the branch and keeps its worker, generation and input", async () => {
  const { f, openedView } = await fixture();
  try {
    f.controls.busy = true;
    await expect(f.supervisor.branch(f.identity, openedView.workerId, openedView.generation, "entry-1"))
      .rejects.toThrow("SESSION_WORKER_BUSY_STOP_REQUIRED");
    expect(f.supervisor.view(f.identity, openedView.workerId)).toMatchObject({ state: "open", generation: openedView.generation });
    expect(f.controls.launches).toBe(1);
  } finally { await f.close(); }
});

test("a native refusal or cancellation is reported without a new Session and without replay", async () => {
  const { f, openedView } = await fixture();
  try {
    f.controls.branchResult = { text: "Branch target", cancelled: true };
    const cancelled = await f.supervisor.branch(f.identity, openedView.workerId, openedView.generation, "entry-1");
    expect(cancelled).toEqual({ status: "cancelled", previousSessionId: "native-session", targetEntryId: "entry-1" });
    expect(f.supervisor.view(f.identity, openedView.workerId)).toMatchObject({ state: "open", generation: openedView.generation });
    expect(f.controls.sessionId).toBe("native-session");
    expect(f.controls.launches).toBe(1);
    f.controls.branchFailure = new Error("STRICT_WRITE_FAILED");
    await expect(f.supervisor.branch(f.identity, openedView.workerId, openedView.generation, "entry-1"))
      .rejects.toThrow("STRICT_WRITE_FAILED");
    expect(f.supervisor.view(f.identity, openedView.workerId).state).toBe("open");
  } finally { await f.close(); }
});

test("a native success without a readable identity is unknown, never a claimed Session", async () => {
  const { f, openedView } = await fixture();
  try {
    await expect(f.supervisor.branch(f.identity, openedView.workerId, openedView.generation, "entry-1"))
      .rejects.toThrow("SESSION_BRANCH_IDENTITY_UNCONFIRMED");
    expect(f.controls.launches).toBe(1);
    expect(f.supervisor.exits().some(exit => exit.reason === "branch-identity-unknown")).toBe(true);
  } finally { await f.close(); }
});

test("unlisted targets and wrong lineage or retained paths are rejected, not opened", async () => {
  const { f, openedView } = await fixture({ branchSessionId: "branch-session" });
  try {
    f.controls.branchPoints = [{ entryId: "entry-0", text: "Retained question" }];
    await expect(f.supervisor.branch(f.identity, openedView.workerId, openedView.generation, "entry-1"))
      .rejects.toThrow("SESSION_BRANCH_TARGET_UNAVAILABLE");
    f.controls.branchPoints = [{ entryId: "entry-1", text: "Branch target" }];
    f.controls.branchParent = "/synthetic/other.jsonl";
    await expect(f.supervisor.branch(f.identity, openedView.workerId, openedView.generation, "entry-1"))
      .rejects.toThrow("SESSION_BRANCH_LINEAGE_UNCONFIRMED");
    expect(f.controls.launches).toBe(1);
  } finally { await f.close(); }
});

test("a destination holding an off-path sibling is discarded as unverified", async () => {
  const { f, openedView } = await fixture({ destination: [source[0]!, source[2]!], branchSessionId: "branch-session" });
  try {
    const result = await f.supervisor.branch(f.identity, openedView.workerId, openedView.generation, "entry-1");
    expect(result).toMatchObject({ status: "created", retainedEntries: 1 });
    if (result.status !== "created") throw new Error("BRANCH_NOT_CREATED");
    expect(result.view).toBeUndefined();
    expect(f.controls.launches).toBe(2);
  } finally { await f.close(); }
});
