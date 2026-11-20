import { expect, spyOn, test } from "bun:test";
import type { FileSink } from "bun";
import { EventEmitter } from "node:events";
import { MAX_RPC_FRAME_BYTES, MAX_RPC_REASSEMBLED_BYTES } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame";
import { SessionWorker } from "../../packages/compatibility/session-worker.ts";
import type { RespondUiParams } from "../../packages/contracts/generated/omp-wire.ts";
import type { ReadyEvent } from "../../packages/contracts/preflight.ts";
import { PrivateHelperController } from "../../packages/supervision/controller.ts";
import { sourceFixture } from "./source-fixture.ts";

const generation = "a".repeat(64);
const ready: ReadyEvent = {
  type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2],
  maxFrameBytes: MAX_RPC_FRAME_BYTES, maxReassembledFrameBytes: MAX_RPC_REASSEMBLED_BYTES,
  strictStartup: "strict-start-v1", strictStartupPolicy: {
    version: "strict-start-v1", status: "prototype", platforms: ["linux"],
    ownership: "native-exclusive-lease", selectedInstance: "anchored-carrier", publication: "native-generation-v1",
    carrierFormat: "ompgen1", xattrs: "required-fd-user-xattr", durability: "process-crash-only",
    rollback: "flatten-export-required", maxLogicalBytes: 1024, maxCarrierBytes: 2048, maxRetainedBytes: 4096,
    maxGenerations: 8, catalogCarrierPrefixBytes: 512, catalogControlBytes: 128, catalogGenerationPrefixBytes: 512,
  },
  interactionPolicy: {
    version: "1", explicitAnswersOnly: true, nativeExpiry: "cancel", toolExpiry: "cancel", invalidAnswer: "pending",
  },
};

class ControlSocket extends EventEmitter {
  readonly writes: string[] = [];
  write(bytes: Uint8Array, callback: () => void): void {
    this.writes.push(Buffer.from(bytes).toString("utf8"));
    callback();
  }
  destroy(): void { this.emit("close"); }
  receive(frame: string): void { this.emit("data", Buffer.from(frame)); }
}

function pipe() {
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; } });
  return { stream,
    send: (...values: object[]) => writer.enqueue(Buffer.from(values.map(value => JSON.stringify(value) + "\n").join(""))),
    bytes: (size: number) => writer.enqueue(new Uint8Array(size)), close: () => writer.close() };
}

interface Command extends Partial<RespondUiParams> { id: string; type: string; protocolVersion?: number }
function ownedPeer(registerHeldHelper = async () => {}) {
  const control = new ControlSocket(), stdout = pipe(), stderr = pipe();
  const reap = Promise.withResolvers<number>();
  const commands: Command[] = [];
  let written = Promise.withResolvers<Command>();
  let inputEnded = false;
  let blockedFlush: Promise<number> | undefined;
  let nextWriteResult: Promise<number> | undefined;
  let flushes = 0;
  const stdin: FileSink = {
    write(chunk) {
      if (inputEnded) throw new Error("TEST_PIPE_CLOSED");
      if (typeof chunk !== "string") throw new Error("TEST_INVALID_CHUNK");
      const command = JSON.parse(chunk) as Command;
      commands.push(command); written.resolve(command); written = Promise.withResolvers<Command>();
      const result = nextWriteResult;
      nextWriteResult = undefined;
      return result ?? Buffer.byteLength(chunk);
    },
    flush() { ++flushes; return blockedFlush ?? 0; }, end() { inputEnded = true; return 0; }, start() {}, ref() {}, unref() {},
  };
  const controller = new PrivateHelperController({
    spawn: () => ({ pid: 41, stdin, stdout: stdout.stream, stderr: stderr.stream, exited: reap.promise,
      stdio: [null, null, null, 17] }),
    openControl: () => control, closeControl: () => {},
  });
  const helper = controller.launch({ generation, registerHeldHelper });
  return { helper, stdout, stderr, control, commands, reap: reap.resolve,
    get inputEnded() { return inputEnded; },
    get flushes() { return flushes; },
    holdWrite() {
      const pending = Promise.withResolvers<number>();
      nextWriteResult = pending.promise;
      return pending;
    },
    nextCommand: () => written.promise,
    holdFlush() {
      const pending = Promise.withResolvers<number>();
      blockedFlush = pending.promise;
      return () => { blockedFlush = undefined; pending.resolve(0); };
    },
    hello: () => control.receive(`HELLO ${generation} 41 123 42 124\n`),
    rootExit: () => control.receive(`ROOT_EXIT ${generation} 0 0\n`),
    complete() { control.receive(`COMPLETE ${generation}\n`); control.emit("end"); reap.resolve(0); },
    respond(command: Command, data: object) {
      stdout.send({ type: "response", id: command.id, command: command.type, success: true, data });
    },
  };
}

test("owned Session negotiates on the retained pipes only after authenticated HELLO", async () => {
  const peer = ownedPeer();
  try {
    const connected = SessionWorker.attachOwned(peer.helper);
    peer.stdout.send(ready);
    await Bun.sleep(0);
    expect(peer.commands).toEqual([]);

    const negotiating = peer.nextCommand();
    peer.hello();
    const command = await negotiating;
    expect(command).toMatchObject({ type: "negotiate_protocol", protocolVersion: 2 });
    peer.respond(command, { protocolVersion: 2 });

    const session = await connected.ready;
    expect(session.frames).toEqual([{ ...ready }]);
    await expect(session.command({ type: "prompt", message: "out of scope" })).rejects
      .toThrow("SESSION_INTERACTION_COMMAND_DENIED");
    expect(peer.commands).toHaveLength(1);
  } finally {
    peer.stdout.close(); peer.stderr.close(); peer.helper.disconnectControl(); peer.reap(0);
  }
});

async function negotiate(peer: ReturnType<typeof ownedPeer>, connected: ReturnType<typeof SessionWorker.attachOwned>) {
  const negotiating = peer.nextCommand();
  peer.hello();
  peer.stdout.send(ready);
  peer.respond(await negotiating, { protocolVersion: 2 });
  return connected.ready;
}

async function supervisedOwnedPeer() {
  const peer = ownedPeer();
  const connection = SessionWorker.attachOwned(peer.helper);
  const fixture = await sourceFixture(Date.now, () => connection);
  const opening = fixture.supervisor.open(fixture.identity, fixture.selected);
  void opening.catch(() => {});
  const negotiating = peer.nextCommand();
  peer.hello();
  peer.stdout.send(ready);
  const negotiation = await negotiating;
  const starting = peer.nextCommand();
  peer.respond(negotiation, { protocolVersion: 2 });
  const start = await starting;
  const binding = { ...fixture.selected, ownership: { ...fixture.selected.ownership, state: "held" } };
  const opened = { version: "strict-start-v1", phase: "open", intent: "continue", cwd: fixture.cwd,
    nativeSessionId: fixture.selected.nativeSessionId, binding };
  const session = await connection.ready;
  let closing: Promise<void> | undefined;
  let rootExit: typeof connection.rootExit | undefined;
  const exitRoot = () => {
    if (!rootExit) {
      rootExit = connection.rootExit;
      peer.rootExit();
    }
    return rootExit;
  };
  return { ...fixture, peer, session, opening, start, opened, connection, exitRoot,
    open() { peer.respond(start, opened); return opening; },
    async publishInput(id: string) {
      const delivered = Promise.withResolvers<void>();
      const dispose = session.subscribe(frame => { if (frame.id === id) delivered.resolve(); });
      peer.stdout.send({ type: "extension_ui_request", method: "input", id, title: "Synthetic UI" });
      await delivered.promise;
      dispose();
    },
    close: () => closing ??= (async () => {
      await exitRoot();
      peer.stdout.close();
      peer.stderr.close();
      peer.complete();
      await fixture.close();
      await opening.catch(() => {});
    })(),
  };
}

const settledState = (sessionId: string) => ({ sessionId, isSettled: true, isStreaming: false, isCompacting: false,
  hasPendingAsyncWork: false, queuedMessageCount: 0, queuedMessages: { steering: [], followUp: [] } });

test("owned shutdown records queue and native settlement while the tracked UI reply is held", async () => {
  const f = await supervisedOwnedPeer();
  try {
    const { peer } = f;
    const view = await f.open();
    await f.publishInput("held-ui");

    const shutdown = f.supervisor.close();
    expect(() => f.supervisor.view(f.identity, view.workerId)).toThrow("SESSION_HOST_CLOSING");
    await Bun.sleep(0);
    const commands = peer.commands.slice(2);
    expect(commands.map(command => command.type)).toEqual([
      "respond_ui", "abort_branch_summary", "abort_retry", "abort_bash", "abort_and_restore_queue",
    ]);
    const [ui, summary, retry, bash, queue] = commands;
    expect(ui).toMatchObject({ targetId: "held-ui", answer: { type: "cancel" } });
    const querying = peer.nextCommand();
    peer.respond(queue!, { steering: [{
      text: "synthetic queued input", images: [{ type: "image", data: "AA==", mimeType: "image/png", extra: true }],
    }], followUp: [], extra: true });
    for (const command of [bash!, retry!, summary!]) peer.respond(command, {});
    const state = await querying;
    expect(state.type).toBe("get_state");
    peer.respond(state, settledState(f.selected.nativeSessionId));
    await Bun.sleep(0);

    expect(f.supervisor.exits()).toMatchObject([{ nativeSettled: true, queuedInputsWithdrawn: true, uiCancelled: false,
      drain: { status: "owned-unresolved", domain: "pending" } }]);
    expect(f.supervisor.hasOwnedReservation).toBe(true);
    peer.respond(ui!, { status: "cancelled" });
    await f.connection.interactionCleanup;
    expect((await f.index.page({})).records[0]?.attempt).toEqual({
      state: "outcome_unknown", code: "SESSION_EXIT_OUTCOME_UNKNOWN",
    });
    await f.close();
    await shutdown;
    expect(f.supervisor.exits()).toMatchObject([{ nativeSettled: true, queuedInputsWithdrawn: true, uiCancelled: true,
      drain: { status: "owned-completed", domain: "completed", output: { stdoutEOF: true, stderrEOF: true } } }]);
    expect(f.supervisor.hasOwnedReservation).toBe(false);
  } finally {
    await f.close();
  }
});

test.each([undefined, { steering: ["invalid"], followUp: [] }])(
  "owned shutdown leaves queue withdrawal unconfirmed for a missing or malformed acknowledgement %p",
  async queueResult => {
    const f = await supervisedOwnedPeer();
    try {
      const { peer } = f;
      await f.open();
      const shutdown = f.supervisor.close();
      await Bun.sleep(0);
      const querying = peer.nextCommand();
      for (const command of peer.commands.slice(2)) {
        if (command.type === "abort_and_restore_queue") {
          peer.stdout.send({ type: "response", id: command.id, command: command.type, success: true, data: queueResult });
        } else peer.respond(command, {});
      }
      const state = await querying;
      expect(state.type).toBe("get_state");
      peer.respond(state, settledState(f.selected.nativeSessionId));
      await Bun.sleep(0);
      expect(f.supervisor.exits()).toMatchObject([{
        queuedInputsWithdrawn: false, nativeSettled: true, uiCancelled: true,
      }]);
      await f.close();
      await shutdown;
    } finally {
      await f.close();
    }
  },
);

test.each(["cancelling", "open"] as const)("root revocation uses strict startup cancellation when Native reports %s",
  async phase => {
    const f = await supervisedOwnedPeer();
    try {
      const { peer } = f;
      await f.publishInput("root-ui");
      expect(f.supervisor.interactions(f.identity)?.pending[0]?.scope).toEqual({ kind: "startup" });

      f.grants.revoke(f.grant.id);
      const revocation = f.supervisor.permissionsChanged();
      await Bun.sleep(0);
      const [ui, cancel] = peer.commands.slice(2);
      expect(peer.commands.slice(2).map(command => command.type)).toEqual(["respond_ui", "cancel_strict_start"]);
      expect(ui).toMatchObject({ targetId: "root-ui", answer: { type: "cancel" } });
      peer.respond(cancel!, phase === "open" ? f.opened : { version: "strict-start-v1", phase });
      peer.respond(f.start, f.opened);
      peer.respond(ui!, { status: "expired" });
      await f.connection.interactionCleanup;
      await expect(f.opening).rejects.toThrow("SESSION_OPEN_RETIRED_OUTCOME_UNKNOWN");
      await Bun.sleep(0);
      expect(peer.commands).toHaveLength(4);
      expect((await f.index.page({})).records[0]?.attempt).toEqual({
        state: "outcome_unknown", code: "SESSION_EXIT_OUTCOME_UNKNOWN",
      });
      expect(f.supervisor.exits()).toMatchObject([{ reason: "directory-revoked",
        nativeSettled: false, queuedInputsWithdrawn: false, uiCancelled: true }]);
      await f.close();
      await revocation;
    } finally {
      await f.close();
    }
  },
);

test("owned shutdown keeps pre-cutoff queue proof and ignores UI and state replies at the original cutoff", async () => {
  const f = await supervisedOwnedPeer();
  const now = spyOn(performance, "now").mockReturnValue(1_000);
  try {
    const { peer } = f;
    await f.open();
    await f.publishInput("late-ui");

    const shutdown = f.supervisor.close();
    await Bun.sleep(0);
    const querying = peer.nextCommand();
    const [ui, ...controls] = peer.commands.slice(2);
    for (const command of controls) peer.respond(command,
      command.type === "abort_and_restore_queue" ? { steering: [], followUp: [] } : {});
    const state = await querying;
    expect(state.type).toBe("get_state");

    now.mockReturnValue(31_000);
    peer.respond(state, settledState(f.selected.nativeSessionId));
    peer.respond(ui!, { status: "cancelled" });
    expect(await f.connection.interactionCleanup).toMatchObject([{ status: "unknown", reason: "cleanup-cutoff" }]);
    await f.close();
    await shutdown;
    expect(f.supervisor.exits()).toMatchObject([{ nativeSettled: false, queuedInputsWithdrawn: true, uiCancelled: false,
      drain: { status: "owned-completed", output: { stdoutEOF: true, stderrEOF: true } } }]);
  } finally {
    now.mockRestore();
    await f.close();
  }
});

test("owned shutdown leaves missing acknowledgements unconfirmed after root exit despite late valid replies", async () => {
  const f = await supervisedOwnedPeer();
  try {
    const { peer } = f;
    await f.open();
    await f.publishInput("lost-ui");

    const shutdown = f.supervisor.close();
    await Bun.sleep(0);
    const commands = peer.commands.slice(2);
    expect(commands.map(command => command.type)).toEqual([
      "respond_ui", "abort_branch_summary", "abort_retry", "abort_bash", "abort_and_restore_queue",
    ]);
    await f.exitRoot();
    expect(await f.connection.interactionCleanup).toMatchObject([{ status: "unknown", reason: "cleanup-reply-lost" }]);
    for (const command of commands) peer.respond(command,
      command.type === "respond_ui" ? { status: "cancelled" }
        : command.type === "abort_and_restore_queue" ? { steering: [], followUp: [] } : {});
    await f.close();
    await shutdown;
    expect(peer.commands).toHaveLength(7);
    expect(f.supervisor.exits()).toMatchObject([{ nativeSettled: false, queuedInputsWithdrawn: false, uiCancelled: false,
      drain: { status: "owned-completed", rootExit: { exitCode: 0, signal: 0 } } }]);
    expect(await f.connection.output).not.toHaveProperty("protocolFailure");
  } finally {
    await f.close();
  }
});

test.each(["wrong Session", "malformed", "busy"] as const)("owned shutdown keeps %s state unconfirmed",
  async stateKind => {
    const f = await supervisedOwnedPeer();
    try {
      const { peer } = f;
      await f.open();
      const shutdown = f.supervisor.revokeAll();
      await Bun.sleep(0);
      const querying = peer.nextCommand();
      for (const command of peer.commands.slice(2)) peer.respond(command,
        command.type === "abort_and_restore_queue" ? { steering: [], followUp: [] } : {});
      const state = await querying;
      const settled = settledState(f.selected.nativeSessionId);
      const reply = stateKind === "wrong Session" ? { ...settled, sessionId: f.other.nativeSessionId }
        : stateKind === "malformed" ? { ...settled, isSettled: "true" } : { ...settled, isStreaming: true };
      peer.respond(state, reply);
      await f.close();
      await shutdown;
      expect(f.supervisor.exits()).toMatchObject([{ reason: "all-browser-access-revoked",
        nativeSettled: false, queuedInputsWithdrawn: true, uiCancelled: true }]);
    } finally {
      await f.close();
    }
  },
);

test("an authoritative answer correlated at the owned fence does not confirm UI cancellation", async () => {
  const f = await supervisedOwnedPeer();
  try {
    const { peer } = f;
    await f.open();
    await f.publishInput("answered-ui");
    const card = f.supervisor.interactions(f.identity)?.pending[0];
    if (!card) throw new Error("TEST_INTERACTION_UNAVAILABLE");
    const stopped = Promise.withResolvers<void>();
    f.session.subscribe(frame => {
      if (frame.type === "session_settled") stopped.resolve(f.supervisor.close());
    });
    const answering = peer.nextCommand();
    const answer = f.supervisor.answer(f.identity, card.generation, card.id, { type: "value", value: "Synthetic answer" });
    void answer.catch(() => {});
    const command = await answering;
    peer.stdout.send(
      { type: "response", id: command.id, command: command.type, success: true, data: { status: "answered" } },
      { type: "session_settled" },
    );
    expect(await f.connection.interactionCleanup).toEqual([
      { id: card.id, status: "answered", reason: "explicit-answer" },
    ]);
    await expect(answer).rejects.toThrow("SESSION_HOST_CLOSING");
    expect(peer.commands.filter(item => item.type === "respond_ui")).toEqual([command]);
    await f.close();
    await stopped.promise;
    expect(f.supervisor.exits()).toMatchObject([{ uiCancelled: false, drain: { status: "owned-completed" } }]);
  } finally {
    await f.close();
  }
});

test.each([false, true])("a retired generation reports notification lower bounds with delivery after cutoff=%s", async expired => {
  const peer = ownedPeer();
  const connection = SessionWorker.attachOwned(peer.helper);
  const launching = Promise.withResolvers<void>();
  const delivery = Promise.withResolvers<typeof connection>();
  const readiness = Promise.withResolvers<Awaited<typeof connection.ready>>();
  const owned = { ...connection, ready: readiness.promise };
  const fenced = Promise.withResolvers<void>();
  const fence = spyOn(owned, "beginCleanup").mockImplementation(cutoff => {
    const cleanup = connection.beginCleanup(cutoff);
    fenced.resolve();
    return cleanup;
  });
  const f = await sourceFixture(Date.now, () => { launching.resolve(); return delivery.promise; });
  const opening = f.supervisor.open(f.identity, f.selected);
  void opening.catch(() => {});
  let closeOutputs = () => { peer.stdout.close(); peer.stderr.close(); };
  const clock = spyOn(performance, "now").mockReturnValue(1_000);
  try {
    await launching.promise;
    const readySession = await negotiate(peer, connection);
    const published = Promise.withResolvers<void>();
    readySession.subscribe(() => published.resolve());
    peer.stdout.send({ type: "session_settled" });
    await published.promise;
    expect(readySession.notificationCount).toBe(1);
    const shutdown = f.supervisor.close(), revocation = f.supervisor.revokeAll();
    expect(fence).not.toHaveBeenCalled();
    if (expired) clock.mockReturnValue(31_000);
    delivery.resolve(owned);
    await fenced.promise;
    expect(fence).toHaveBeenCalledTimes(1);
    expect(fence).toHaveBeenCalledWith(31_000);
    readiness.resolve(readySession);
    await expect(opening).rejects.toThrow("SESSION_HOST_CLOSING");
    expect(peer.commands.map(command => command.type)).toEqual(["negotiate_protocol"]);
    expect(f.supervisor.hasOwnedReservation).toBe(true);
    expect((await f.index.page({})).records[0]?.attempt).toEqual({
      state: "outcome_unknown", code: "SESSION_EXIT_OUTCOME_UNKNOWN",
    });

    peer.stdout.send({ type: "session_settled" });
    peer.rootExit();
    peer.complete();
    closeOutputs();
    closeOutputs = () => {};
    await Promise.all([shutdown, revocation]);
    expect(f.supervisor.hasOwnedReservation).toBe(false);
    expect(f.supervisor.starts).toBe(1);
    expect(f.supervisor.exits()).toMatchObject([{
      notificationCount: 1, tailNotifications: 1, tailNotificationsLowerBound: true,
      uiCancelled: !expired, queuedInputsWithdrawn: false, nativeSettled: false,
    }]);
  } finally {
    clock.mockRestore();
    delivery.resolve(owned);
    readiness.reject(new Error("RPC_STARTUP_FAILED"));
    closeOutputs();
    peer.helper.disconnectControl();
    peer.reap(0);
    await opening.catch(() => {});
    await f.close();
  }
});

test.each([true, false])("owned exit counts startup, live and tail notifications with clean framing=%s", async clean => {
  const peer = ownedPeer();
  const connection = SessionWorker.attachOwned(peer.helper);
  const f = await sourceFixture(Date.now, () => connection);
  const opening = f.supervisor.open(f.identity, f.selected);
  void opening.catch(() => {});
  let closeOutputs = () => { peer.stdout.close(); peer.stderr.close(); };
  try {
    const negotiating = peer.nextCommand();
    peer.hello();
    peer.stdout.send(ready);
    const negotiation = await negotiating;
    const starting = peer.nextCommand();
    peer.stdout.send({ type: "session_settled" });
    peer.respond(negotiation, { protocolVersion: 2 });
    const start = await starting;
    expect(start.type).toBe("strict_start");
    const binding = { ...f.selected, ownership: { ...f.selected.ownership, state: "held" } };
    peer.respond(start, { version: "strict-start-v1", phase: "open", intent: "continue", cwd: f.cwd,
      nativeSessionId: f.selected.nativeSessionId, binding });
    expect(await opening).toMatchObject({ state: "open" });

    const worker = await connection.ready;
    const published = Promise.withResolvers<void>();
    worker.subscribe(() => published.resolve());
    peer.stdout.send({ type: "session_settled" });
    await published.promise;

    const shutdown = f.supervisor.close();
    peer.stdout.send({ type: "session_settled" });
    if (!clean) peer.stdout.send({ type: "synthetic_invalid" }, { type: "session_settled" });
    peer.rootExit();
    await connection.rootExit;
    peer.complete();
    closeOutputs();
    closeOutputs = () => {};
    await shutdown;
    const exit = f.supervisor.exits()[0];
    expect(exit).toMatchObject({ notificationCount: 3, tailNotifications: 1, drain: { status: "owned-completed" } });
    expect(exit?.tailNotificationsLowerBound).toBe(clean ? undefined : true);
  } finally {
    closeOutputs();
    peer.helper.disconnectControl();
    peer.reap(0);
    await opening.catch(() => {});
    await f.close();
  }
});

test("owned Interaction tracking preserves notification replay until a Session subscriber attaches", async () => {
  const peer = ownedPeer();
  try {
    const connected = SessionWorker.attachOwned(peer.helper);
    const negotiation = peer.nextCommand();
    peer.hello();
    peer.stdout.send(ready);
    const command = await negotiation;
    const before = { type: "extension_ui_request", method: "input", id: "before-negotiation", title: "Synthetic UI" };
    const after = { type: "extension_ui_request", method: "input", id: "after-negotiation", title: "Synthetic UI" };
    peer.stdout.send(before,
      { type: "response", id: command.id, command: command.type, success: true, data: { protocolVersion: 2 } });
    const session = await connected.ready;

    const stateCommand = peer.nextCommand();
    const observing = session.startup.state();
    const state = await stateCommand;
    peer.stdout.send(after, { type: "response", id: state.id, command: state.type, success: true,
      data: { version: "strict-start-v1", phase: "waiting" } });
    await observing;
    expect(session.frames).toEqual([{ ...ready }, before, after]);
    expect(session.interactions.snapshot().pending.map(card => card.id)).toEqual([before.id, after.id]);

    const delivered = Promise.withResolvers<unknown>();
    session.subscribe(frame => delivered.resolve(frame));
    const notice = { type: "session_settled" };
    peer.stdout.send(notice);
    expect(await delivered.promise).toEqual(notice);
    expect(session.frames).toEqual([{ ...ready }, before, after]);

    peer.rootExit();
    await connected.rootExit;
    peer.stdout.close(); peer.stderr.close();
    expect((await connected.output).protocolFailure).toBeUndefined();
    peer.complete();
    await connected.completed;
  } finally { peer.helper.disconnectControl(); peer.reap(0); }
});

test("owned cleanup fences regular work while fixed cleanup RPCs still drain on the same pipes", async () => {
  const peer = ownedPeer();
  const clock = spyOn(performance, "now").mockReturnValue(1000);
  try {
    const connected = SessionWorker.attachOwned(peer.helper);
    const session = await negotiate(peer, connected);
    const notices: unknown[] = [];
    session.subscribe(frame => notices.push(frame));
    const releaseFlush = peer.holdFlush();
    const reading = peer.nextCommand();
    const dispatched = session.startup.state();
    void dispatched.catch(() => {});
    const read = await reading;
    const queued = session.startup.state();
    void queued.catch(() => {});

    const cleanup = connected.beginCleanup(2000);
    expect(cleanup).toBeDefined();
    if (!cleanup) throw new Error("TEST_CLEANUP_UNAVAILABLE");
    await expect(dispatched).rejects.toMatchObject({ code: "RPC_SESSION_RETIRED" });
    await expect(queued).rejects.toMatchObject({ code: "RPC_SESSION_RETIRED" });
    await expect(session.state()).rejects.toMatchObject({ code: "RPC_SESSION_RETIRED" });
    expect(peer.inputEnded).toBe(false);

    const cancelling = peer.nextCommand();
    const cancelled = cleanup.cancelStrictStart();
    releaseFlush();
    const cancel = await cancelling;
    expect(cancel.type).toBe("cancel_strict_start");
    const withdrawing = peer.nextCommand();
    const withdrawn = cleanup.abortAndRestoreQueue();
    const withdraw = await withdrawing;
    expect(withdraw.type).toBe("abort_and_restore_queue");

    peer.respond(withdraw, { steering: [], followUp: [] });
    await withdrawn;
    const strictState = { version: "strict-start-v1", phase: "waiting" } as const;
    peer.respond(read, strictState);
    peer.stdout.send({ type: "session_settled" });
    peer.respond(cancel, strictState);
    expect(await cancelled).toEqual(strictState);

    const querying = peer.nextCommand();
    const queried = cleanup.state();
    const query = await querying;
    expect(query.type).toBe("get_state");
    const settled = { sessionId: "session", isSettled: true, isStreaming: false, isCompacting: false,
      hasPendingAsyncWork: false, queuedMessageCount: 0, queuedMessages: { steering: [], followUp: [] } };
    peer.respond(query, settled);
    expect(await queried).toEqual(settled);
    expect(notices).toEqual([]);
    expect(peer.commands.map(command => command.type)).toEqual([
      "negotiate_protocol", "get_strict_state", "cancel_strict_start", "abort_and_restore_queue", "get_state",
    ]);

    const summarizing = peer.nextCommand();
    const summary = cleanup.abortBranchSummary();
    void summary.catch(() => {});
    const stopSummary = await summarizing;
    expect(stopSummary.type).toBe("abort_branch_summary");
    peer.rootExit();
    await connected.rootExit;
    expect(connected.beginCleanup(2000)).toBeUndefined();
    await expect(summary).rejects.toMatchObject({ code: "RPC_ROOT_EXITED" });
    await expect(cleanup.state()).rejects.toMatchObject({ code: "RPC_ROOT_EXITED" });
    peer.respond(stopSummary, {});
    peer.stdout.close();
    peer.stderr.close();
    expect(await connected.output).toEqual({
      stdoutEOF: true, stderrEOF: true, stderrBytes: 0, observedTailNotifications: 1,
    });
    peer.complete();
    await connected.completed;
  } finally { clock.mockRestore(); peer.helper.disconnectControl(); peer.reap(0); }
});

test("owned cleanup withdraws tracked extension UI and sends only a fixed Native cancellation", async () => {
  const peer = ownedPeer();
  try {
    const connected = SessionWorker.attachOwned(peer.helper);
    const session = await negotiate(peer, connected);
    const delivered = Promise.withResolvers<void>();
    session.subscribe(frame => { if (frame.id === "notify") delivered.resolve(); });
    peer.stdout.send({ type: "extension_ui_request", method: "input", id: "pending-root", title: "Synthetic UI" });
    peer.stdout.send({ type: "extension_ui_request", method: "notify", id: "notify", message: "Synthetic notice" });
    await delivered.promise;
    const { interactions } = session;
    expect(interactions.snapshot().pending).toMatchObject([{ id: "pending-root", scope: { kind: "startup" } }]);

    const cancelling = peer.nextCommand();
    const cutoff = performance.now() + 10_000;
    const cleanup = connected.beginCleanup(cutoff);
    expect(cleanup).toBeDefined();
    expect(connected.beginCleanup(cutoff)).toBe(cleanup);
    expect(interactions.snapshot().pending).toEqual([]);
    expect(await interactions.answer(interactions.generation, "pending-root", { type: "value", value: "late" }))
      .toEqual({ status: "stale" });
    expect(await interactions.answer(interactions.generation, "forged", { type: "cancel" })).toEqual({ status: "stale" });
    await expect(session.command({ type: "respond_ui", targetId: "forged", answer: { type: "cancel" } }))
      .rejects.toMatchObject({ code: "RPC_SESSION_RETIRED" });

    const command = await cancelling;
    expect(command).toEqual({ type: "respond_ui", id: expect.any(String), targetId: "pending-root",
      answer: { type: "cancel" } });
    peer.stdout.send({ type: "extension_ui_request", method: "input", id: "after-fence", title: "Synthetic late UI" });
    peer.respond(command, { status: "cancelled" });
    expect(await connected.interactionCleanup).toEqual([
      { id: "pending-root", status: "cancelled", reason: "explicit-native-acknowledgement" },
    ]);
    expect(interactions.snapshot().pending).toEqual([]);
    expect(peer.commands.map(item => item.type)).toEqual(["negotiate_protocol", "respond_ui"]);
    peer.stdout.close(); peer.stderr.close();
    expect((await connected.output).observedTailNotifications).toBe(1);
    peer.rootExit(); peer.complete();
    await connected.completed;
  } finally { peer.helper.disconnectControl(); peer.reap(0); }
});

test("owned UI cleanup preserves an answer acknowledged before retirement in the same stdout read", async () => {
  const peer = ownedPeer();
  try {
    const connected = SessionWorker.attachOwned(peer.helper);
    const session = await negotiate(peer, connected);
    const { interactions } = session;
    const delivered = Promise.withResolvers<void>();
    session.subscribe(frame => {
      if (frame.id === "fenced-answer") delivered.resolve();
      if (frame.type === "session_settled") connected.beginCleanup(performance.now() + 10_000);
    });
    peer.stdout.send(
      { type: "extension_ui_request", method: "input", id: "confirmed-answer", title: "Synthetic first UI" },
      { type: "extension_ui_request", method: "input", id: "fenced-answer", title: "Synthetic second UI" },
    );
    await delivered.promise;

    const firstWrite = peer.nextCommand();
    const first = interactions.answer(interactions.generation, "confirmed-answer", { type: "value", value: "first" });
    const firstCommand = await firstWrite;
    const secondWrite = peer.nextCommand();
    const second = interactions.answer(interactions.generation, "fenced-answer", { type: "value", value: "second" });
    const secondCommand = await secondWrite;
    const cancelling = peer.nextCommand();
    peer.stdout.send(
      { type: "response", id: firstCommand.id, command: "respond_ui", success: true, data: { status: "answered" } },
      { type: "session_settled" },
      { type: "response", id: secondCommand.id, command: "respond_ui", success: true, data: { status: "answered" } },
    );
    expect(await first).toEqual({ status: "answered" });
    expect(await second).toEqual({ status: "stale" });

    const cancel = await cancelling;
    expect(cancel).toMatchObject({ type: "respond_ui", targetId: "fenced-answer", answer: { type: "cancel" } });
    // The fenced answer could have reached Native. Its stale cancellation does not prove a cancellation happened.
    peer.respond(cancel, { status: "stale" });
    // The settled card keeps the reason of the reply that won its single continuation.
    expect(await connected.interactionCleanup).toEqual([
      { id: "confirmed-answer", status: "answered", reason: "explicit-answer" },
      { id: "fenced-answer", status: "stale", reason: "explicit-native-acknowledgement" },
    ]);
    expect(interactions.snapshot().outcomes).toHaveLength(2);
    expect(peer.commands).toHaveLength(4);
    peer.stdout.close(); peer.stderr.close();
    expect((await connected.output).protocolFailure).toBeUndefined();
    peer.rootExit(); peer.complete();
    await connected.completed;
  } finally { peer.helper.disconnectControl(); peer.reap(0); }
});

test.each(["before", "after"] as const)("owned UI cleanup with a same-card decisive reply %s the fence", async when => {
  const peer = ownedPeer();
  try {
    const connected = SessionWorker.attachOwned(peer.helper);
    const session = await negotiate(peer, connected);
    const { interactions } = session;
    const delivered = Promise.withResolvers<void>();
    session.subscribe(frame => {
      if (frame.type === "extension_ui_request") delivered.resolve();
      if (frame.type === "session_settled") connected.beginCleanup(performance.now() + 10_000);
    });
    peer.stdout.send({ type: "extension_ui_request", method: "input", id: "same-card", title: "Synthetic UI" });
    await delivered.promise;

    const answering = peer.nextCommand();
    const answer = interactions.answer(interactions.generation, "same-card", { type: "value", value: "winner" });
    const answerCommand = await answering;
    // The held answer owns this card's only continuation: a racing cancel is stale and sends nothing.
    const cancel = interactions.answer(interactions.generation, "same-card", { type: "cancel" });
    expect(await cancel).toEqual({ status: "stale" });
    expect(answerCommand.targetId).toBe("same-card");
    expect(peer.commands.map(command => command.type)).toEqual(["negotiate_protocol", "respond_ui"]);

    const decisive = { type: "response", id: answerCommand.id, command: "respond_ui", success: true,
      data: { status: "answered" } };
    const fence = { type: "session_settled" };
    const expected: Command[] = [];
    let outcome: { id: string; status: "answered" | "cancelled"; reason: string };
    if (when === "before") {
      peer.stdout.send(decisive, fence);
      expect(await answer).toEqual({ status: "answered" });
      outcome = { id: "same-card", status: "answered", reason: "explicit-answer" };
    } else {
      peer.stdout.send(fence, decisive);
      expect(await answer).toEqual({ status: "stale" });
      // Fenced answers reject without retiring the card; the cleanup lane carries the only cancellation.
      const cancelling = peer.nextCommand();
      const command = await cancelling;
      expected.push(command);
      expect(command).toMatchObject({ type: "respond_ui", targetId: "same-card", answer: { type: "cancel" } });
      peer.respond(command, { status: "cancelled" });
      outcome = { id: "same-card", status: "cancelled", reason: "explicit-native-acknowledgement" };
    }
    expect(await connected.interactionCleanup).toEqual([outcome]);
    expect(interactions.snapshot()).toMatchObject({ pending: [], outcomes: [outcome] });
    expect(peer.commands.map(command => command.type))
      .toEqual(["negotiate_protocol", "respond_ui", ...expected.map(command => command.type)]);

    peer.stdout.close(); peer.stderr.close();
    expect((await connected.output).protocolFailure).toBeUndefined();
    peer.rootExit(); peer.complete();
    await connected.completed;
  } finally { peer.helper.disconnectControl(); peer.reap(0); }
});

test.each([
  ["Native rejection", "cleanup-request-failed"],
  ["incompatible acknowledgement", "cleanup-reply-invalid"],
  ["acknowledgement at the cutoff", "cleanup-cutoff"],
  ["root exit with no acknowledgement", "cleanup-reply-lost"],
  ["unavailable cleanup lane", "cleanup-unavailable"],
] as const)("owned UI cleanup records uncertainty after %s", async (fault, reason) => {
  const peer = ownedPeer();
  const clock = spyOn(performance, "now").mockReturnValue(1000);
  try {
    const connected = SessionWorker.attachOwned(peer.helper);
    const session = await negotiate(peer, connected);
    const delivered = Promise.withResolvers<void>();
    session.subscribe(() => delivered.resolve());
    peer.stdout.send({ type: "extension_ui_request", method: "input", id: "unresolved", title: "Synthetic UI" });
    await delivered.promise;
    const cancelling = peer.nextCommand();
    const unavailable = fault === "unavailable cleanup lane";
    const cleanup = connected.beginCleanup(unavailable ? 1000 : 6000);
    if (unavailable) {
      expect(cleanup).toBeUndefined();
      expect(connected.beginCleanup(9000)).toBeUndefined();
    } else {
      expect(cleanup).toBeDefined();
      const command = await cancelling;
      if (fault === "Native rejection") {
        peer.stdout.send({ type: "response", id: command.id, command: command.type, success: false,
          error: "Synthetic Native rejection" });
      } else if (fault === "incompatible acknowledgement") {
        peer.respond(command, { status: "answered" });
      } else if (fault === "acknowledgement at the cutoff") {
        clock.mockReturnValue(6000);
        peer.respond(command, { status: "cancelled" });
      } else {
        peer.rootExit();
        await connected.rootExit;
      }
    }
    const cancellation = { id: "unresolved", status: "unknown", reason } as const;
    expect(await connected.interactionCleanup).toEqual([cancellation]);
    expect(session.interactions.snapshot()).toMatchObject({ pending: [], outcomes: [cancellation] });
    expect(peer.commands.map(command => command.type)).toEqual(unavailable
      ? ["negotiate_protocol"] : ["negotiate_protocol", "respond_ui"]);
    peer.stdout.close(); peer.stderr.close();
    expect(await connected.output).toMatchObject({ stdoutEOF: true, stderrEOF: true });
    if (fault !== "root exit with no acknowledgement") peer.rootExit();
    peer.complete();
    await connected.completed;
  } finally { clock.mockRestore(); peer.helper.disconnectControl(); peer.reap(0); }
});

test("owned cleanup stops delivery to later subscribers of the current notification", async () => {
  const peer = ownedPeer();
  try {
    const connected = SessionWorker.attachOwned(peer.helper);
    const session = await negotiate(peer, connected);
    const first: unknown[] = [];
    const second: unknown[] = [];
    const retired = Promise.withResolvers<boolean>();
    session.subscribe(frame => {
      first.push(frame);
      retired.resolve(connected.beginCleanup(performance.now() + 10_000) !== undefined);
    });
    session.subscribe(frame => second.push(frame));

    const settled = { type: "session_settled" };
    peer.stdout.send(settled);
    expect(await retired.promise).toBe(true);
    peer.stdout.send(settled);
    peer.stdout.close();
    peer.stderr.close();
    expect(await connected.output).toEqual({
      stdoutEOF: true, stderrEOF: true, stderrBytes: 0, observedTailNotifications: 1,
    });
    expect(first).toEqual([settled]);
    expect(second).toEqual([]);
    expect(session.notificationCount).toBe(1);
    peer.rootExit();
    peer.complete();
    await connected.completed;
  } finally { peer.helper.disconnectControl(); peer.reap(0); }
});

test("owned cleanup keeps the first cutoff for pending replies and writes behind a flush", async () => {
  const peer = ownedPeer();
  let now = 1000;
  const clock = spyOn(performance, "now").mockImplementation(() => now);
  try {
    const connected = SessionWorker.attachOwned(peer.helper);
    await negotiate(peer, connected);
    const cleanup = connected.beginCleanup(6000);
    expect(cleanup).toBeDefined();
    if (!cleanup) throw new Error("TEST_CLEANUP_UNAVAILABLE");
    expect(connected.beginCleanup(9000)).toBe(cleanup);

    const releaseFlush = peer.holdFlush();
    const aborting = peer.nextCommand();
    const dispatched = cleanup.abortRetry();
    void dispatched.catch(() => {});
    const retry = await aborting;
    expect(retry.type).toBe("abort_retry");
    const queued = cleanup.abortBash();
    void queued.catch(() => {});

    now = 6000;
    expect(connected.beginCleanup(9000)).toBeUndefined();
    await expect(cleanup.abortBranchSummary()).rejects.toMatchObject({ code: "RPC_CLEANUP_CLOSED" });
    peer.respond(retry, {});
    releaseFlush();
    await expect(dispatched).rejects.toMatchObject({ code: "RPC_CLEANUP_CLOSED" });
    await expect(queued).rejects.toMatchObject({ code: "RPC_CLEANUP_CLOSED" });
    expect(peer.commands.map(command => command.type)).toEqual(["negotiate_protocol", "abort_retry"]);

    peer.stdout.close();
    peer.stderr.close();
    expect(await connected.output).toEqual({
      stdoutEOF: true, stderrEOF: true, stderrBytes: 0, observedTailNotifications: 0,
    });
    peer.rootExit();
    peer.complete();
    await connected.completed;
  } finally { clock.mockRestore(); peer.helper.disconnectControl(); peer.reap(0); }
});

test.each(["before HELLO", "during registration", "before the v2 ack"] as const)(
  "owned retirement %s fences startup and cannot later admit cleanup", async when => {
  const registrationStarted = Promise.withResolvers<void>();
  const registration = Promise.withResolvers<void>();
  const peer = ownedPeer(async () => {
    registrationStarted.resolve();
    await registration.promise;
  });
  try {
    const connected = SessionWorker.attachOwned(peer.helper);
    const negotiating = peer.nextCommand();
    peer.stdout.send(ready);
    let command: Command | undefined;
    if (when !== "before HELLO") {
      peer.hello();
      await registrationStarted.promise;
      registration.resolve();
    }
    if (when === "before the v2 ack") command = await negotiating;
    expect(connected.beginCleanup(performance.now() + 1000)).toBeUndefined();
    expect(peer.inputEnded).toBe(true);
    await expect(connected.ready).rejects.toMatchObject({ code: "RPC_SESSION_RETIRED" });
    if (command) peer.respond(command, { protocolVersion: 2 });
    if (when === "before HELLO") {
      peer.hello();
      registration.resolve();
    }
    await peer.helper.ready;
    expect(peer.control.writes).toEqual(command ? [`START ${generation}\n`] : []);
    expect(peer.helper.control.nativeIdentity).toEqual({ pid: 42, startTime: "124" });

    peer.stdout.send({ type: "session_settled" });
    peer.stdout.close();
    peer.stderr.close();
    expect(await connected.output).toEqual({
      stdoutEOF: true, stderrEOF: true, stderrBytes: 0, observedTailNotifications: 1,
    });
    expect(connected.beginCleanup(performance.now() + 1000)).toBeUndefined();
    expect(peer.commands).toHaveLength(command ? 1 : 0);
    await peer.helper.control.mandatoryCleanup();
    expect(peer.control.writes.at(-1)).toBe(`MANDATORY ${generation}\n`);
    peer.rootExit();
    expect(await connected.rootExit).toMatchObject({ exitCode: 0, signal: 0 });
    peer.complete();
    await connected.completed;
  } finally {
    registration.resolve();
    peer.helper.disconnectControl();
    peer.reap(0);
  }
});

test("Native root exit fences pending RPC while valid EOF tails and helper completion stay observable", async () => {
  const peer = ownedPeer();
  try {
    const connected = SessionWorker.attachOwned(peer.helper, { timeoutMs: 500 });
    const session = await negotiate(peer, connected);
    const notices: unknown[] = [];
    const delivered = Promise.withResolvers<void>();
    session.subscribe(frame => { notices.push(frame); delivered.resolve(); });
    const settled = { type: "session_settled" };
    peer.stdout.send(settled);
    await delivered.promise;
    const releaseFlush = peer.holdFlush();
    const reading = peer.nextCommand();
    const pending = session.startup.state();
    void pending.catch(() => {});
    const read = await reading;
    const queued = session.startup.state();
    void queued.catch(() => {});

    peer.rootExit();
    expect(await connected.rootExit).toEqual({ kind: "rootExit", generation, exitCode: 0, signal: 0 });
    await expect(pending).rejects.toThrow("RPC_ROOT_EXITED");
    await expect(queued).rejects.toThrow("RPC_ROOT_EXITED");
    await expect(session.startup.state()).rejects.toThrow("RPC_ROOT_EXITED");
    releaseFlush();

    let domainCompleted = false;
    void connected.completed.then(() => { domainCompleted = true; }, () => {});
    peer.stdout.send(settled);
    peer.respond(read, { version: "strict-start-v1", phase: "waiting" });
    peer.stdout.send(settled);
    peer.stdout.close();
    await Bun.sleep(0);
    expect(domainCompleted).toBe(false);
    expect(notices).toEqual([settled]);
    expect(session.notificationCount).toBe(1);
    expect(peer.commands).toHaveLength(2);

    let outputDone = false;
    void connected.output.then(() => { outputDone = true; });
    peer.complete();
    await connected.completed;
    expect(outputDone).toBe(false);
    peer.stderr.close();
    expect(await connected.output).toEqual({
      stdoutEOF: true, stderrEOF: true, stderrBytes: 0, observedTailNotifications: 2,
    });
  } finally {
    peer.helper.disconnectControl(); peer.reap(0);
  }
});

test("failed RPC negotiation fences Native stdin while the original helper remains observable", async () => {
  const peer = ownedPeer();
  try {
    const connected = SessionWorker.attachOwned(peer.helper);
    const negotiating = peer.nextCommand();
    peer.hello();
    peer.stdout.send(ready);
    peer.respond(await negotiating, { protocolVersion: 1 });

    await expect(connected.ready).rejects.toMatchObject({ code: "RPC_NEGOTIATION" });
    expect(() => peer.helper.stdin.write("stale")).toThrow("NATIVE_ADMISSION_CLOSED");
    expect(connected.completed).toBe(peer.helper.completed);
    expect(connected.beginCleanup(performance.now() + 1000)).toBeUndefined();
    const root = connected.rootExit;
    peer.rootExit();
    expect(await root).toMatchObject({ exitCode: 0 });

    peer.stdout.close();
    peer.stderr.close();
    expect(await connected.output).toEqual({
      stdoutEOF: true, stderrEOF: true, stderrBytes: 0, observedTailNotifications: 0, protocolFailure: "RPC_NEGOTIATION",
    });
    peer.complete();
    await connected.completed;
  } finally {
    peer.helper.disconnectControl(); peer.reap(0);
  }
});

test("helper startup failure preserves its error and keeps the domain pending until reap", async () => {
  const peer = ownedPeer();
  try {
    const connected = SessionWorker.attachOwned(peer.helper);
    peer.stdout.send(ready);
    peer.control.emit("close");
    await expect(connected.ready).rejects.toMatchObject({ code: "PRIVATE_DOMAIN_UNRESOLVED" });
    await expect(connected.rootExit).rejects.toMatchObject({ code: "PRIVATE_ROOT_EXIT_UNOBSERVED" });
    expect(peer.commands).toEqual([]);
    expect(peer.inputEnded).toBe(true);

    peer.stdout.close();
    peer.stderr.close();
    expect(await connected.output).toEqual({
      stdoutEOF: true, stderrEOF: true, stderrBytes: 0, observedTailNotifications: 0,
    });
    let domainFailed = false;
    void connected.completed.catch(() => { domainFailed = true; });
    await Bun.sleep(0);
    expect(domainFailed).toBe(false);
    peer.reap(0);
    await expect(connected.completed).rejects.toMatchObject({ code: "PRIVATE_DOMAIN_UNRESOLVED" });
  } finally { peer.helper.disconnectControl(); peer.reap(0); }
});

test("control loss fences RPC and malformed stdout tail fails validation without hiding real EOF", async () => {
  const peer = ownedPeer();
  try {
    const connected = SessionWorker.attachOwned(peer.helper);
    const session = await negotiate(peer, connected);
    peer.control.emit("close");
    await expect(connected.rootExit).rejects.toMatchObject({ code: "PRIVATE_ROOT_EXIT_UNOBSERVED" });
    await expect(session.startup.state()).rejects.toThrow("RPC_ROOT_EXIT_UNOBSERVED");
    expect(connected.beginCleanup(performance.now() + 1000)).toBeUndefined();

    peer.stdout.send({ type: "session_settled" });
    peer.stdout.send({ type: "unexpected_public_frame" });
    peer.stdout.send({ type: "session_settled" });
    peer.stdout.close();
    peer.stderr.close();
    expect(await connected.output).toEqual({
      stdoutEOF: true, stderrEOF: true, stderrBytes: 0, observedTailNotifications: 1, protocolFailure: "RPC_PROTOCOL",
    });
    peer.reap(0);
    await expect(connected.completed).rejects.toMatchObject({ code: "PRIVATE_DOMAIN_UNRESOLVED" });
  } finally { peer.helper.disconnectControl(); peer.reap(0); }
});

test("retiring a failed pipe attachment fences START and preserves the retained helper observations", async () => {
  const peer = ownedPeer();
  const reader = peer.stderr.stream.getReader();
  try {
    const connected = SessionWorker.attachOwned(peer.helper);
    expect(connected.rootExit).toBe(peer.helper.rootExit);
    expect(connected.completed).toBe(peer.helper.completed);
    await expect(connected.ready).rejects.toMatchObject({ code: "RPC_PIPES_IN_USE" });
    await expect(connected.output).rejects.toMatchObject({ code: "RPC_PIPES_IN_USE" });
    expect(peer.stdout.stream.locked).toBe(false);
    expect(peer.inputEnded).toBe(false);
    expect(connected.beginCleanup(performance.now() + 1000)).toBeUndefined();
    peer.hello();
    await peer.helper.ready;
    expect(peer.control.writes).toEqual([]);
  } finally {
    reader.releaseLock();
    peer.stdout.close(); peer.stderr.close(); peer.helper.disconnectControl(); peer.reap(0);
  }
});

test("owned stderr overflow fences RPC, caps diagnostics and drains to actual EOF", async () => {
  const peer = ownedPeer();
  try {
    const connected = SessionWorker.attachOwned(peer.helper);
    const session = await negotiate(peer, connected);
    const reading = peer.nextCommand();
    const pending = session.startup.state();
    void pending.catch(() => {});
    await reading;

    peer.stderr.bytes(65_536);
    peer.stderr.bytes(1);
    await expect(pending).rejects.toMatchObject({ code: "RPC_STDERR_LIMIT" });
    expect(peer.inputEnded).toBe(true);
    expect(connected.beginCleanup(performance.now() + 1000)).toBeUndefined();
    peer.stdout.close();

    let outputDone = false;
    void connected.output.then(() => { outputDone = true; });
    await Bun.sleep(0);
    expect(outputDone).toBe(false);
    peer.stderr.bytes(8192);
    peer.stderr.close();
    expect(await connected.output).toEqual({
      stdoutEOF: true, stderrEOF: true, stderrBytes: 65_536, observedTailNotifications: 0, protocolFailure: "RPC_STDERR_LIMIT",
    });
  } finally { peer.helper.disconnectControl(); peer.reap(0); }
});

test.each([
  ["root exit", "undispatched"],
  ["root exit", "duplicate"],
  ["request timeout", "undispatched"],
  ["request timeout", "duplicate"],
] as const)("%s rejects the %s late response as a protocol failure", async (boundary, invalid) => {
  const peer = ownedPeer();
  try {
    const connected = SessionWorker.attachOwned(peer.helper, {
      readyTimeoutMs: 2000, timeoutMs: boundary === "request timeout" ? 50 : 1000,
    });
    const session = await negotiate(peer, connected);
    const releaseFlush = peer.holdFlush();
    const reading = peer.nextCommand();
    const pending = session.startup.state();
    void pending.catch(() => {});
    const dispatched = await reading;
    const queuedId = "00000000-0000-4000-8000-000000000020";
    const uuid = spyOn(crypto, "randomUUID").mockReturnValueOnce(queuedId);
    const queued = session.startup.state();
    uuid.mockRestore();
    void queued.catch(() => {});

    if (boundary === "root exit") {
      peer.rootExit();
      await connected.rootExit;
    }
    const expected = boundary === "root exit" ? "RPC_ROOT_EXITED" : "RPC_REQUEST_TIMEOUT";
    await expect(pending).rejects.toThrow(expected);
    await expect(queued).rejects.toThrow(expected);
    releaseFlush();

    const state = { version: "strict-start-v1", phase: "waiting" };
    peer.respond(dispatched, state);
    peer.respond(invalid === "duplicate" ? dispatched : { id: queuedId, type: dispatched.type }, state);
    peer.stdout.close();
    peer.stderr.close();
    expect(peer.commands).toHaveLength(2);
    expect(await connected.output).toMatchObject({
      stdoutEOF: true, stderrEOF: true, protocolFailure: "RPC_PROTOCOL",
    });
  } finally { peer.helper.disconnectControl(); peer.reap(0); }
});

test("a successful late negotiation ack still needs a valid v2 payload", async () => {
  const peer = ownedPeer();
  try {
    const connected = SessionWorker.attachOwned(peer.helper);
    const negotiating = peer.nextCommand();
    peer.hello();
    peer.stdout.send(ready);
    const command = await negotiating;
    peer.rootExit();
    await expect(connected.ready).rejects.toMatchObject({ code: "RPC_ROOT_EXITED" });

    peer.respond(command, { protocolVersion: 1 });
    peer.stdout.close();
    peer.stderr.close();
    expect(await connected.output).toMatchObject({
      stdoutEOF: true, stderrEOF: true, protocolFailure: "RPC_NEGOTIATION",
    });
    peer.complete();
    await connected.completed;
  } finally { peer.helper.disconnectControl(); peer.reap(0); }
});

test.each(["aliased pipes", "throwing stderr reader"] as const)(
  "%s rolls back the acquired stdout lock and keeps the helper lifecycle", async fault => {
    const peer = ownedPeer();
    const reader = fault === "throwing stderr reader"
      ? spyOn(peer.stderr.stream, "getReader").mockImplementation(() => { throw new Error("test-only private path"); })
      : undefined;
    if (fault === "aliased pipes") peer.helper.stderr = peer.helper.stdout;
    try {
      const failed = SessionWorker.attachOwned(peer.helper);
      expect(failed.rootExit).toBe(peer.helper.rootExit);
      expect(failed.completed).toBe(peer.helper.completed);
      expect(peer.stdout.stream.locked).toBe(false);
      expect(peer.inputEnded).toBe(false);
      const error = { code: "RPC_PIPE_ATTACH_FAILED", message: "RPC_PIPE_ATTACH_FAILED" };
      await expect(failed.ready).rejects.toMatchObject(error);
      await expect(failed.output).rejects.toMatchObject(error);

      reader?.mockRestore();
      peer.helper.stderr = peer.stderr.stream;
      const connected = SessionWorker.attachOwned(peer.helper);
      await negotiate(peer, connected);
      peer.stdout.close();
      peer.stderr.close();
      expect(await connected.output).toEqual({
        stdoutEOF: true, stderrEOF: true, stderrBytes: 0, observedTailNotifications: 0,
      });
    } finally {
      reader?.mockRestore();
      peer.helper.disconnectControl(); peer.reap(0);
    }
  },
);

test("an asynchronous Native write rejection flushes and fences the owned RPC connection", async () => {
  const peer = ownedPeer();
  try {
    const connected = SessionWorker.attachOwned(peer.helper);
    const session = await negotiate(peer, connected);
    const previousFlushes = peer.flushes;
    const write = peer.holdWrite();
    const reading = peer.nextCommand();
    const pending = session.startup.state();
    void pending.catch(() => {});
    await reading;
    expect(peer.flushes).toBe(previousFlushes + 1);

    write.reject(new Error("private sink failure"));
    await expect(pending).rejects.toMatchObject({ code: "RPC_STDIN", message: "RPC_STDIN" });
    expect(() => peer.helper.stdin.write("stale")).toThrow("NATIVE_ADMISSION_CLOSED");

    peer.stdout.close();
    peer.stderr.close();
    expect(await connected.output).toEqual({
      stdoutEOF: true, stderrEOF: true, stderrBytes: 0, observedTailNotifications: 0, protocolFailure: "RPC_STDIN",
    });
    peer.rootExit();
    peer.complete();
    await connected.completed;
  } finally { peer.helper.disconnectControl(); peer.reap(0); }
});
