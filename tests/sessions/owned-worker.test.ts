import { expect, spyOn, test } from "bun:test";
import type { FileSink } from "bun";
import { EventEmitter } from "node:events";
import { MAX_RPC_FRAME_BYTES, MAX_RPC_REASSEMBLED_BYTES } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame";
import { SessionWorker } from "../../packages/compatibility/session-worker.ts";
import type { ReadyEvent } from "../../packages/contracts/preflight.ts";
import { PrivateHelperController } from "../../packages/supervision/controller.ts";

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
  write(_bytes: Uint8Array, callback: () => void): void { callback(); }
  destroy(): void { this.emit("close"); }
  receive(frame: string): void { this.emit("data", Buffer.from(frame)); }
}

function pipe() {
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; } });
  return { stream, send: (value: object) => writer.enqueue(Buffer.from(JSON.stringify(value) + "\n")),
    bytes: (size: number) => writer.enqueue(new Uint8Array(size)), close: () => writer.close() };
}

interface Command { id: string; type: string; protocolVersion?: number }
function ownedPeer() {
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
  const helper = controller.launch({ generation, registerHeldHelper: async () => {} });
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

test("Native root exit fences pending RPC while valid EOF tails and helper completion stay observable", async () => {
  const peer = ownedPeer();
  try {
    const connected = SessionWorker.attachOwned(peer.helper, { timeoutMs: 500 });
    const session = await negotiate(peer, connected);
    const notices: unknown[] = [];
    session.subscribe(frame => notices.push(frame));
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
    peer.respond(read, { version: "strict-start-v1", phase: "waiting" });
    peer.stdout.send({ type: "session_settled" });
    peer.stdout.close();
    await Bun.sleep(0);
    expect(domainCompleted).toBe(false);
    expect(notices).toEqual([]);
    expect(peer.commands).toHaveLength(2);

    let outputDone = false;
    void connected.output.then(() => { outputDone = true; });
    peer.complete();
    await connected.completed;
    expect(outputDone).toBe(false);
    peer.stderr.close();
    expect(await connected.output).toEqual({ stdoutEOF: true, stderrEOF: true, stderrBytes: 0 });
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
    const root = connected.rootExit;
    peer.rootExit();
    expect(await root).toMatchObject({ exitCode: 0 });

    peer.stdout.close();
    peer.stderr.close();
    expect(await connected.output).toEqual({
      stdoutEOF: true, stderrEOF: true, stderrBytes: 0, protocolFailure: "RPC_NEGOTIATION",
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
    expect(await connected.output).toEqual({ stdoutEOF: true, stderrEOF: true, stderrBytes: 0 });
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

    peer.stdout.send({ type: "unexpected_public_frame" });
    peer.stdout.close();
    peer.stderr.close();
    expect(await connected.output).toEqual({
      stdoutEOF: true, stderrEOF: true, stderrBytes: 0, protocolFailure: "RPC_PROTOCOL",
    });
    peer.reap(0);
    await expect(connected.completed).rejects.toMatchObject({ code: "PRIVATE_DOMAIN_UNRESOLVED" });
  } finally { peer.helper.disconnectControl(); peer.reap(0); }
});

test("an unavailable pipe returns a failed attachment with the retained helper observations", async () => {
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
    peer.stdout.close();

    let outputDone = false;
    void connected.output.then(() => { outputDone = true; });
    await Bun.sleep(0);
    expect(outputDone).toBe(false);
    peer.stderr.bytes(8192);
    peer.stderr.close();
    expect(await connected.output).toEqual({
      stdoutEOF: true, stderrEOF: true, stderrBytes: 65_536, protocolFailure: "RPC_STDERR_LIMIT",
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
      expect(await connected.output).toEqual({ stdoutEOF: true, stderrEOF: true, stderrBytes: 0 });
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
      stdoutEOF: true, stderrEOF: true, stderrBytes: 0, protocolFailure: "RPC_STDIN",
    });
    peer.rootExit();
    peer.complete();
    await connected.completed;
  } finally { peer.helper.disconnectControl(); peer.reap(0); }
});
