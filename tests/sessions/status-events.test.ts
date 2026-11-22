import { expect, test } from "bun:test";
import { sessionStatusEvents, type SessionRunning } from "../../packages/sessions/status-events.ts";
import { sourceFixture } from "./source-fixture.ts";

/** One forwarded frame as the Gateway receives it, including the payload the stock client observes. */
interface Emitted { event: string; args: readonly unknown[] }

async function nextFrame(frames: AsyncIterator<Emitted>): Promise<Emitted> {
  const settled = await frames.next();
  if (settled.done) throw new Error("SESSION_STATUS_STREAM_ENDED");
  return settled.value;
}

/** A subscription the test drives directly, standing in for the supervisor's native observations. */
function pushed() {
  let listener: ((status: SessionRunning | undefined) => void) | undefined;
  let released = 0;
  return {
    subscribe(observe: (status: SessionRunning | undefined) => void) {
      listener = observe;
      return () => { released++; listener = undefined; };
    },
    push(status: SessionRunning | undefined) { listener?.(status); },
    get released() { return released; },
  };
}

test("the forwarded status stream publishes the Session running transitions it observes", async () => {
  const source = pushed(), abort = new AbortController();
  const frames = sessionStatusEvents(source.subscribe)(abort.signal)[Symbol.asyncIterator]();
  try {
    const trueFrame = frames.next();
    source.push({ sessionId: "native-0000", running: true });
    expect((await trueFrame).value).toEqual({ event: "api-session/status", args: ["native-0000", true] });
    const falseFrame = frames.next();
    source.push({ sessionId: "native-0000", running: false });
    expect((await falseFrame).value).toEqual({ event: "api-session/status", args: ["native-0000", false] });
  } finally { abort.abort(); await frames.return?.(undefined); }
});

test("cancelling the forwarded stream releases the Host subscription", async () => {
  const source = pushed(), abort = new AbortController();
  const frames = sessionStatusEvents(source.subscribe)(abort.signal)[Symbol.asyncIterator]();
  const pending = frames.next();
  await Promise.resolve();
  expect(source.released).toBe(0);
  abort.abort();
  expect(source.released).toBe(1);
  source.push({ sessionId: "native-0000", running: true });
  expect((await pending).done).toBe(true);
});

test("the supervisor reports a running transition only once and settles from native status", async () => {
  const f = await sourceFixture();
  const seen: SessionRunning[] = [];
  const changed = Promise.withResolvers<void>();
  let transitions = 0;
  try {
    await f.supervisor.open(f.identity, f.selected);
    const release = f.supervisor.subscribeStatus(status => {
      if (!status) return;
      seen.push(status);
      if (++transitions === 2) changed.resolve();
    });
    try {
      f.controls.busy = true;
      // The Host requested a turn; Native status, not the frame, decides what to publish.
      f.supervisor.statusChanged();
      await waitFor(() => seen.length >= 1);
      expect(seen).toEqual([{ sessionId: "native-session", running: true }]);
      // Further streaming notifications do not repeat the already-running observation.
      f.emit({ type: "message_update" });
      for (let spin = 0; spin < 8; spin++) await Promise.resolve();
      expect(seen).toHaveLength(1);
      f.controls.busy = false;
      f.emit({ type: "session_settled" });
      await changed.promise;
      expect(seen).toEqual([
        { sessionId: "native-session", running: true },
        { sessionId: "native-session", running: false },
      ]);
    } finally { release(); }
  } finally { f.close(); }
});

test("prompt acknowledgement and Stop publish the visible turn without a worker frame", async () => {
  const f = await sourceFixture();
  const seen: SessionRunning[] = [];
  try {
    await f.supervisor.open(f.identity, f.selected);
    const release = f.supervisor.subscribeStatus(status => { if (status) seen.push(status); });
    try {
      f.controls.busy = true;
      f.supervisor.statusChanged();
      await waitFor(() => seen.length >= 1);
      expect(seen).toEqual([{ sessionId: "native-session", running: true }]);
      await f.supervisor.close();
      expect(seen.at(-1)).toEqual({ sessionId: "native-session", running: false });
    } finally { release(); }
  } finally { await f.close(); }
});

test("the supervisor trusts only the live active worker and reports native settlement", async () => {
  const f = await sourceFixture();
  try {
    expect(await f.supervisor.activeStatus()).toBeUndefined();
    await f.supervisor.open(f.identity, f.selected);
    expect(await f.supervisor.activeStatus()).toEqual({ sessionId: "native-session", running: false });
    f.controls.busy = true;
    expect(await f.supervisor.activeStatus()).toEqual({ sessionId: "native-session", running: true });
    f.controls.busy = false;
    expect(await f.supervisor.activeStatus()).toEqual({ sessionId: "native-session", running: false });
  } finally { await f.close(); }
});

/** Native observation arrives after the frame; wait on the observable effect instead of a guessed delay. */
async function waitFor(check: () => boolean): Promise<void> {
  for (let spin = 0; spin < 200; spin++) {
    if (check()) return;
    await Promise.resolve();
  }
  throw new Error("SESSION_STATUS_NOT_OBSERVED");
}
