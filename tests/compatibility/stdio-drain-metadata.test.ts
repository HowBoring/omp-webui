import { expect, spyOn, test } from "bun:test";
import { BoundedStdioTransport } from "../../packages/compatibility/stdio-transport.ts";

/** Fake only the OS process boundary; framing, negotiation, writes and readers remain real. */
function fakeProcess() {
  let stdout!: ReadableStreamDefaultController<Uint8Array>;
  let stderr!: ReadableStreamDefaultController<Uint8Array>;
  const exited = Promise.withResolvers<number>();
  const stdinEnded = Promise.withResolvers<void>();
  const encode = (value: object) => new TextEncoder().encode(JSON.stringify(value) + "\n");
  const child = {
    pid: 1,
    stdout: new ReadableStream<Uint8Array>({ start(controller) {
      stdout = controller;
      stdout.enqueue(encode({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2] }));
    } }),
    stderr: new ReadableStream<Uint8Array>({ start(controller) { stderr = controller; } }),
    stdin: {
      write(line: string) {
        const command: unknown = JSON.parse(line);
        if (typeof command !== "object" || command === null || !("id" in command)
          || !("type" in command) || command.type !== "negotiate_protocol") throw new Error("UNEXPECTED_FAKE_COMMAND");
        stdout.enqueue(encode({ type: "response", id: command.id, command: command.type,
          success: true, data: { protocolVersion: 2 } }));
      },
      flush() { return 0; },
      end() { stdinEnded.resolve(); },
    },
    exited: exited.promise,
    kill() { throw new Error("UNEXPECTED_FAKE_SIGNAL"); },
  };
  const spawn = spyOn(Bun, "spawn").mockReturnValue(child as unknown as ReturnType<typeof Bun.spawn>);
  return { stdout, stderr, exited, stdinEnded: stdinEnded.promise, restore: () => spawn.mockRestore() };
}

const open = () => BoundedStdioTransport.open({ argv: ["fake-process-never-executed"], env: {}, timeoutMs: 1000 }, {
  validateCommand: () => true, acceptReady: () => true, remoteError: () => "RPC_REMOTE_REJECTED",
  physicalFrameBytes: 262144, allowChunks: false, commandBytes: 16384,
});

test("default close waits for exit and both readers before reporting observed EOF", async () => {
  const peer = fakeProcess();
  try {
    const transport = await open();
    let closed = false;
    const completion = transport.close().then(result => { closed = true; return result; });
    await peer.stdinEnded;
    peer.exited.resolve(0);
    peer.stdout.close();
    await Bun.sleep(0);
    expect(closed).toBe(false);
    peer.stderr.close();
    expect(await completion).toEqual({ code: 0, forced: false, stderrBytes: 0,
      terminationSent: false, forceSent: false, stdoutEOF: true, stderrEOF: true });
  } finally { peer.restore(); }
});

test("default close does not infer stderr EOF from a successful exit when its reader fails", async () => {
  const peer = fakeProcess();
  try {
    const transport = await open();
    const completion = transport.close();
    await peer.stdinEnded;
    peer.exited.resolve(0);
    await transport.exited;
    peer.stdout.close();
    peer.stderr.error(new Error("FAKE_READER_FAILURE"));
    expect(await completion).toEqual({ code: 0, forced: false, stderrBytes: 0,
      terminationSent: false, forceSent: false, stdoutEOF: true, stderrEOF: false,
      protocolFailure: "RPC_STDERR_LIMIT" });
  } finally { peer.restore(); }
});
