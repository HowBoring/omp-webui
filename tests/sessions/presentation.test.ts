import { expect, test } from "bun:test";
import { Context } from "@deepseek-ai/cordis";
import type { SessionFollowRequest, SessionPageRequest, SessionProjectionBinding } from "@deepseek-ai/dsh-api-session-controller/types";
import type { BrowserAccess } from "../../packages/access/index.ts";
import { sessionCaller, type SessionsService } from "../../packages/sessions/service.ts";
import { SessionPresentationService } from "../../packages/sessions/presentation-service.ts";
import type { SessionSupervisor } from "../../packages/sessions/supervisor.ts";

const SOURCE = "omp-webui/live-journal/v1";
const binding = (generation: string): SessionProjectionBinding =>
  ({ source: SOURCE, generation } as unknown as SessionProjectionBinding);
const identity = {} as BrowserAccess;

interface FakeJournal {
  sessionId: string; generation: string; projection: SessionProjectionBinding; cursor: number;
  continuation: number | null;
  failure: string | undefined; snapshots: number;
  subscribe(listener: unknown): () => void;
  snapshot(): unknown;
  page(): Promise<unknown>;
}

function journal(sessionId: string, generation: string, cursor = 7): FakeJournal {
  const projection = binding(generation);
  return {
    sessionId, generation, projection, cursor, continuation: null, failure: undefined, snapshots: 0,
    subscribe: (_listener: unknown) => () => {},
    snapshot() {
      this.snapshots += 1;
      return { type: "snapshot", cursor, projections: { projection, asOfSeq: cursor,
        values: { conversationContinuation: this.continuation } }, projection, records: [] };
    },
    page: async () => ({ records: [], projection }),
  };
}

interface FakeSupervisor {
  epoch: number; announced: FakeJournal | undefined; live: () => FakeJournal;
  presentationEpoch(): number;
  activeJournal(): FakeJournal | undefined;
  presentation(_identity: BrowserAccess, id: string): Promise<FakeJournal>;
  requirePresentation(): void;
  pollPresentation(): Promise<never>;
}

/** The smallest supervisor surface the presentation service owns, with explicit epoch publication. */
function supervisor(state: { announced: FakeJournal | undefined; live: () => FakeJournal }): FakeSupervisor {
  return {
    epoch: 1, announced: state.announced, live: state.live,
    presentationEpoch() { return this.epoch; },
    activeJournal() { return this.announced; },
    async presentation(_identity: BrowserAccess, id: string) {
      const current = this.live();
      if (current.sessionId !== id) throw new Error("SESSION_PRESENTATION_INVALIDATED");
      return current;
    },
    requirePresentation() {},
    async pollPresentation() { throw new Error("STREAM_END"); },
  };
}

interface BaselineFrame {
  type: string;
  value: { projections: Record<string, { projection: SessionProjectionBinding; asOfSeq: number; values: Record<string, unknown> }> };
}
interface ProjectionFrame {
  type: string; seq: number; projection: SessionProjectionBinding;
  changes: { key: string; val: unknown }[];
}
interface InvalidatedFrame { type: string; projection: SessionProjectionBinding }
interface SnapshotFrame { type: string; cursor: number; projections: { projection: SessionProjectionBinding; asOfSeq: number } }

function service(state: FakeSupervisor, sessions: unknown = {}) {
  return new SessionPresentationService(new Context(), state as unknown as SessionSupervisor, sessions as SessionsService);
}

/** Remote calls read the browser identity from the ambient stores exactly as the Gateway invokes them. */
function call<T>(run: () => T): T { return sessionCaller.run(identity, run); }

async function firstFrame(frames: AsyncGenerator<unknown>): Promise<unknown> {
  return (await call(() => frames.next())).value;
}

test("control never advertises a failing generation as the opening baseline", async () => {
  const stale = journal("native-0000", "native-0000:1"), live = journal("native-0000", "native-0000:2");
  stale.failure = "live_context_changed";
  const state = supervisor({ announced: stale, live: () => live });
  const abort = new AbortController(), frames = call(() => service(state).control(abort.signal));
  try {
    const baseline = await firstFrame(frames) as BaselineFrame;
    expect(baseline.type).toBe("baseline");
    expect(baseline.value.projections["native-0000"]!.projection).toEqual(binding("native-0000:2"));
    expect(baseline.value.projections["native-0000"]!.asOfSeq).toBe(live.cursor);
  } finally { abort.abort(); await frames.return(undefined); }
});

test("control keeps reporting epochs that name a live journal only", async () => {
  const stale = journal("native-0000", "native-0000:1"), live = journal("native-0000", "native-0000:2");
  stale.failure = "live_context_changed";
  const state = supervisor({ announced: stale, live: () => live });
  const abort = new AbortController(), frames = call(() => service(state).control(abort.signal));
  const seen: string[] = [];
  try {
    const baseline = await firstFrame(frames) as BaselineFrame;
    seen.push(baseline.value.projections["native-0000"]!.projection.generation);
    // The owner publishes a new generation later: control must announce it, not swallow the epoch.
    state.announced = live; state.epoch += 1;
    const next = await firstFrame(frames) as InvalidatedFrame;
    expect(next.type).toBe("projection-invalidated");
    seen.push(next.projection.generation);
    expect(seen).toEqual(["native-0000:2", "native-0000:2"]);
  } finally { abort.abort(); await frames.return(undefined); }
});

test("a stale or out-of-order opening is refused; the current generation reloads", async () => {
  const live = journal("native-0000", "native-0000:2");
  const state = supervisor({ announced: live, live: () => live });
  const api = service(state);
  const request = (generation: string | undefined): SessionFollowRequest => ({
    address: { kind: "session", sessionId: "native-0000" }, maxMessages: 500, activate: true,
    ...(generation === undefined ? {} : { projection: binding(generation) }),
  } as SessionFollowRequest);
  for (const generation of ["native-0000:1", "native-0000:3"]) {
    const frames = call(() => api.follow(request(generation), new AbortController().signal));
    await expect(firstFrame(frames)).rejects.toMatchObject({ code: "session/projections-unavailable" });
  }
  expect(live.snapshots).toBe(0);
  const page = await call(() => api.page({ address: { kind: "session", sessionId: "native-0000" }, projection: binding("native-0000:1") } as SessionPageRequest))
    .catch((error: unknown) => error);
  expect(page).toMatchObject({ code: "session/projections-unavailable" });
  const frames = call(() => api.follow(request("native-0000:2"), new AbortController().signal));
  try {
    const snapshot = await firstFrame(frames) as SnapshotFrame;
    expect(snapshot).toMatchObject({ type: "snapshot", cursor: 7, projections: { asOfSeq: 7 } });
    expect(snapshot.projections.projection).toEqual(binding("native-0000:2"));
  } finally { await call(() => frames.return(undefined)); }
});

test("the continuation view reaches projections and live control without a reload", async () => {
  const live = journal("native-0000", "native-0000:2");
  live.continuation = 5;
  const state = supervisor({ announced: live, live: () => live });
  const api = service(state);
  const projections = await call(() => api.projections({ sessionId: live.sessionId } as never));
  expect(projections).toMatchObject({ values: { conversationContinuation: 5 }, asOfSeq: live.cursor });
  const abort = new AbortController(), frames = call(() => api.control(abort.signal));
  try {
    const baseline = await firstFrame(frames) as BaselineFrame;
    expect(baseline.value.projections["native-0000"]!.values).toEqual({
      conversationContinuation: 5, modelSelection: { lastUsed: null, next: null } });
    live.continuation = 9; live.cursor = 9;
    const update = await firstFrame(frames) as ProjectionFrame;
    expect(update).toMatchObject({ type: "projection", seq: 9, projection: binding("native-0000:2"),
      changes: [{ key: "conversationContinuation", val: 9 }] });
  } finally { abort.abort(); await frames.return(undefined); }
});

test("a snapshot captured before the model catalog resolves never yields after the grant is revoked", async () => {
  const live = journal("native-0000", "native-0000:2");
  const state = { presented: true };
  const fake = supervisor({ announced: live, live: () => live });
  fake.requirePresentation = () => {
    if (!state.presented) throw new Error("SESSION_MANUAL_OPEN_REQUIRED");
  };
  const begun = Promise.withResolvers<void>();
  const catalog = Promise.withResolvers<unknown>();
  const api = service(fake, { stockModelCatalog: () => { begun.resolve(); return catalog.promise; } });
  const request = { address: { kind: "session", sessionId: "native-0000" }, maxMessages: 500,
    activate: true } as SessionFollowRequest;
  const frames = call(() => api.follow(request, new AbortController().signal));
  const pending = call(() => frames.next());
  await begun.promise;
  // The owner revokes the grant while the Host is still reading the native model catalog. The snapshot
  // was taken before that await, so nothing may leave the Host until access is proven again.
  state.presented = false;
  catalog.resolve({ default: { provider: "synthetic", model: "fixture" } });
  await expect(pending).rejects.toThrow("SESSION_MANUAL_OPEN_REQUIRED");
  await expect(call(() => frames.return(undefined))).resolves.toMatchObject({ done: true });
});

test("the first activation of a Session this Host never opened is the owner's explicit Open", async () => {
  const live = journal("native-0000", "native-0000:2");
  const state = { presented: false };
  const activated: string[] = [];
  const fake = supervisor({ announced: live, live: () => live });
  fake.presentation = async (_identity: BrowserAccess, id: string) => {
    if (!state.presented) throw new Error("SESSION_MANUAL_OPEN_REQUIRED");
    if (live.sessionId !== id) throw new Error("SESSION_PRESENTATION_INVALIDATED");
    return live;
  };
  const stub = { activateUnopened: async (id: string) => { activated.push(id); state.presented = true; return { workerId: "worker-new" }; } };
  const api = new SessionPresentationService(new Context(), fake as unknown as SessionSupervisor, stub as unknown as SessionsService);
  const request = { address: { kind: "session", sessionId: "native-0000" }, maxMessages: 500, activate: true } as SessionFollowRequest;
  const frames = call(() => api.follow(request, new AbortController().signal));
  try {
    expect(await firstFrame(frames) as SnapshotFrame).toMatchObject({ type: "snapshot", cursor: 7 });
    expect(activated).toEqual(["native-0000"]);
  } finally { await call(() => frames.return(undefined)); }
});

test("page and passive follows never open; only an activate:true follow asks for the owner's Open", async () => {
  const live = journal("native-0000", "native-0000:2");
  const state = { presented: false };
  const fake = supervisor({ announced: live, live: () => live });
  fake.presentation = async (_identity: BrowserAccess, id: string) => {
    if (!state.presented) throw new Error("SESSION_MANUAL_OPEN_REQUIRED");
    if (live.sessionId !== id) throw new Error("SESSION_PRESENTATION_INVALIDATED");
    return live;
  };
  const activated: string[] = [];
  const starts: string[] = [];
  const stub = {
    // The index still holds the interrupted attempt, so the stock activation is refused with the marker.
    activateUnopened: async (id: string) => { activated.push(id); throw new Error("SESSION_MANUAL_OPEN_REQUIRED"); },
    nativeOpen: async (id: string) => { starts.push(id); return { workerId: "worker-new" }; },
  };
  const api = new SessionPresentationService(new Context(), fake as unknown as SessionSupervisor, stub as unknown as SessionsService);
  const address = { kind: "session", sessionId: "native-0000" } as const;
  const follow = (activate?: boolean) => call(() => api.follow({
    address, maxMessages: 500, ...(activate === undefined ? {} : { activate }) } as SessionFollowRequest,
    new AbortController().signal).next());
  const page = () => call(() => api.page({ address } as SessionPageRequest));
  // Passive reads never reach the activation policy: the typed manual-open condition is what they answer.
  await expect(follow()).rejects.toThrow("SESSION_MANUAL_OPEN_REQUIRED");
  await expect(follow(false)).rejects.toThrow("SESSION_MANUAL_OPEN_REQUIRED");
  await expect(page()).rejects.toThrow("SESSION_MANUAL_OPEN_REQUIRED");
  expect(activated).toEqual([]);
  // The stock activation asks the policy, which refuses because the attempt is interrupted.
  await expect(follow(true)).rejects.toThrow("SESSION_MANUAL_OPEN_REQUIRED");
  expect(activated).toEqual(["native-0000"]);
  expect(starts).toEqual([]);
  expect(live.snapshots).toBe(0);
  // The owner answers with the explicit public Open; the next activation carries the real snapshot.
  await stub.nativeOpen("native-0000");
  state.presented = true;
  const frames = call(() => api.follow({ address, maxMessages: 500, activate: true } as SessionFollowRequest,
    new AbortController().signal));
  try {
    const snapshot = await firstFrame(frames) as SnapshotFrame;
    expect(snapshot).toMatchObject({ type: "snapshot", cursor: 7, projections: { asOfSeq: 7 } });
  } finally { await call(() => frames.return(undefined)); }
});
