import { expect, test } from "bun:test";
import type { FileSink } from "bun";
import { EventEmitter } from "node:events";
import { PrivateHelperController, type PrivateHelperProcess } from "../../packages/supervision/controller.ts";

const generation = "a".repeat(64);

function controlledProcess(fd: unknown, endFault = false): { process: PrivateHelperProcess; reap(code: number): void } {
  let closed = false;
  const stdin: FileSink = {
    write: () => { if (closed) throw new Error("OS_PIPE_CLOSED"); return 1; },
    end: () => { if (endFault) throw new Error("secret pipe failure"); closed = true; return 0; }, flush: () => 0,
    start: () => {}, ref: () => {}, unref: () => {},
  };
  const exited = Promise.withResolvers<number>();
  return { process: { pid: 41, stdin, stdout: new ReadableStream(), stderr: new ReadableStream(),
    exited: exited.promise, stdio: [null, null, null, fd] }, reap: exited.resolve };
}

test("post-spawn missing control retains helper ownership, fences input and cannot report drain", async () => {
  const child = controlledProcess(undefined);
  const controller = new PrivateHelperController({ spawn: () => child.process,
    openControl: () => { throw new Error("must not open absent fd"); }, closeControl: () => {} });
  const handle = controller.launch({ generation, registerHeldHelper: async () => {} });
  expect(handle.helperPid).toBe(41);
  expect(() => handle.stdin.write("request")).toThrow("NATIVE_ADMISSION_CLOSED");
  await expect(handle.ready).rejects.toMatchObject({ code: "HELPER_CONTROL_UNAVAILABLE" });
  expect(handle.control.nativeIdentity).toBeUndefined();
  let completion = "pending";
  void handle.completed.then(() => { completion = "drained"; }, () => { completion = "unresolved"; });
  await Promise.resolve();
  expect(completion).toBe("pending");
  child.reap(0);
  expect(await handle.helperExited).toBe(0);
  await expect(handle.completed).rejects.toMatchObject({ code: "PRIVATE_DOMAIN_UNRESOLVED" });
  expect(completion).toBe("unresolved");
});

test("failing pipe and raw-fd closure still fence input and retain the unresolved helper handle", async () => {
  const child = controlledProcess(17, true);
  let closeAttempts = 0;
  const controller = new PrivateHelperController({ spawn: () => child.process,
    openControl: () => { throw new Error("secret socket failure"); },
    closeControl: () => { closeAttempts++; throw new Error("secret fd failure"); } });
  const handle = controller.launch({ generation, registerHeldHelper: async () => {} });
  await expect(handle.ready).rejects.toMatchObject({ code: "HELPER_CONTROL_UNAVAILABLE", causeCode: "UNCLASSIFIED" });
  expect(() => handle.stdin.write("request")).toThrow("NATIVE_ADMISSION_CLOSED");
  handle.disconnectControl();
  expect(closeAttempts).toBe(1);
  child.reap(74);
  await expect(handle.completed).rejects.toMatchObject({ code: "PRIVATE_DOMAIN_UNRESOLVED" });
});

class ControlledSocket extends EventEmitter {
  readonly written: string[] = [];
  writeFault = false;
  write(bytes: Uint8Array, callback: (error?: Error | null) => void): void {
    if (this.writeFault) throw Object.assign(new Error("secret control path"), { code: "EPIPE" });
    this.written.push(new TextDecoder().decode(bytes));
    callback();
  }
  destroy(): void { this.emit("close"); }
  receive(frame: string): void { this.emit("data", Buffer.from(frame)); }
}

test("controller keeps the start barrier through status verification and completion through receipt plus reap", async () => {
  const child = controlledProcess(17);
  const socket = new ControlledSocket();
  const status = Promise.withResolvers<void>();
  const controller = new PrivateHelperController({ spawn: () => child.process,
    openControl: () => socket, closeControl: () => {} });
  const handle = controller.launch({ generation, registerHeldHelper: async () => status.promise });
  socket.receive(`HELLO ${generation} 41 123 42 124\n`);
  await Promise.resolve();
  expect(socket.written).toEqual([]);
  status.resolve();
  expect((await handle.ready).nativePid).toBe(42);
  expect(socket.written).toEqual([`START ${generation}\n`]);
  socket.receive(`ROOT_EXIT ${generation} 0 0\nCOMPLETE ${generation}\n`);
  socket.emit("end"); socket.emit("close"); socket.emit("close"); socket.emit("end");
  let complete = false;
  void handle.completed.then(() => { complete = true; });
  await Promise.resolve();
  expect(complete).toBe(false);
  child.reap(0);
  await handle.completed;
  expect(complete).toBe(true);
});

test("the accepted Native root exit is observable before helper reap and survives a later duplicate", async () => {
  const child = controlledProcess(17);
  const socket = new ControlledSocket();
  const controller = new PrivateHelperController({ spawn: () => child.process,
    openControl: () => socket, closeControl: () => {} });
  const handle = controller.launch({ generation, registerHeldHelper: async () => {} });
  socket.receive(`HELLO ${generation} 41 123 42 124\n`);
  await handle.ready;

  socket.receive(`ROOT_EXIT ${generation} 0`);
  socket.receive(" 15\n");
  const observed = { kind: "rootExit", generation, exitCode: 0, signal: 15 } as const;
  expect(await handle.rootExit).toEqual(observed);
  expect(handle.control.helperReportedComplete).toBe(false);

  socket.receive(`ROOT_EXIT ${generation} 19 0\nCOMPLETE ${generation}\n`);
  socket.emit("end");
  child.reap(0);
  expect(await handle.helperExited).toBe(0);
  await expect(handle.completed).rejects.toMatchObject({
    code: "PRIVATE_DOMAIN_UNRESOLVED", causeCode: "CONTROL_SEQUENCE",
  });
  expect(await handle.rootExit).toEqual(observed);
});

for (const [loss, frame, causeCode] of [
  ["close without receipt", undefined, "PRIVATE_DOMAIN_UNRESOLVED"],
  ["wrong generation", `ROOT_EXIT ${"b".repeat(64)} 0 0\n`, "CONTROL_GENERATION"],
  ["invalid exit status", `ROOT_EXIT ${generation} 19 15\n`, "CONTROL_PROTOCOL"],
] as const) {
  test(`${loss} leaves Native root exit unobserved even with a successful helper reap`, async () => {
    const child = controlledProcess(17);
    const socket = new ControlledSocket();
    const controller = new PrivateHelperController({ spawn: () => child.process,
      openControl: () => socket, closeControl: () => {} });
    const handle = controller.launch({ generation, registerHeldHelper: async () => {} });
    socket.receive(`HELLO ${generation} 41 123 42 124\n`);
    await handle.ready;

    if (frame === undefined) socket.emit("close");
    else socket.receive(frame);
    await expect(handle.rootExit).rejects.toMatchObject({ code: "PRIVATE_ROOT_EXIT_UNOBSERVED", causeCode });

    child.reap(0);
    expect(await handle.helperExited).toBe(0);
    await expect(handle.completed).rejects.toMatchObject({ code: "PRIVATE_DOMAIN_UNRESOLVED" });
  });
}

for (const ending of ["close-only COMPLETE", "close-only truncated COMPLETE", "partial EOF"] as const) {
  test(`${ending} cannot report private drain after successful direct reap`, async () => {
    const child = controlledProcess(17);
    const socket = new ControlledSocket();
    const controller = new PrivateHelperController({ spawn: () => child.process,
      openControl: () => socket, closeControl: () => {} });
    const handle = controller.launch({ generation, registerHeldHelper: async () => {} });
    socket.receive(`HELLO ${generation} 41 123 42 124\n`);
    await handle.ready;
    const tail = ending === "close-only COMPLETE" ? "" : "truncated";
    socket.receive(`ROOT_EXIT ${generation} 0 0\nCOMPLETE ${generation}\n${tail}`);
    socket.emit(ending === "partial EOF" ? "end" : "close");
    socket.emit("close");
    let result = "pending";
    void handle.completed.then(() => { result = "drained"; }, () => { result = "unresolved"; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(result).toBe("pending");
    expect(handle.helperPid).toBe(41);
    child.reap(0);
    expect(await handle.helperExited).toBe(0);
    await expect(handle.completed).rejects.toMatchObject({ code: "PRIVATE_DOMAIN_UNRESOLVED" });
    expect(() => handle.stdin.write("request")).toThrow("NATIVE_ADMISSION_CLOSED");
    expect(result).toBe("unresolved");
  });
}

for (const loss of ["error", "disconnect"] as const) {
  test(`${loss} after clean EOF keeps private COMPLETE unresolved through direct reap`, async () => {
    const child = controlledProcess(17);
    const socket = new ControlledSocket();
    const controller = new PrivateHelperController({ spawn: () => child.process,
      openControl: () => socket, closeControl: () => {} });
    const handle = controller.launch({ generation, registerHeldHelper: async () => {} });
    socket.receive(`HELLO ${generation} 41 123 42 124\n`);
    await handle.ready;
    socket.receive(`ROOT_EXIT ${generation} 0 0\nCOMPLETE ${generation}\n`);
    socket.emit("end");
    await new Promise<void>(resolve => setImmediate(resolve));
    if (loss === "error") socket.emit("error");
    else handle.disconnectControl();
    child.reap(0);
    expect(await handle.helperExited).toBe(0);
    await expect(handle.completed).rejects.toMatchObject({ code: "PRIVATE_DOMAIN_UNRESOLVED" });
    expect(() => handle.stdin.write("request")).toThrow("NATIVE_ADMISSION_CLOSED");
  });
}

test("a synchronous control-write failure fences Native admission and remains a coded unresolved lifetime", async () => {
  const child = controlledProcess(17);
  const socket = new ControlledSocket();
  const controller = new PrivateHelperController({ spawn: () => child.process,
    openControl: () => socket, closeControl: () => {} });
  const handle = controller.launch({ generation, registerHeldHelper: async () => {} });
  socket.receive(`HELLO ${generation} 41 123 42 124\n`);
  await handle.ready;
  socket.writeFault = true;
  await expect(handle.control.ordinaryStop()).rejects.toMatchObject({ code: "CONTROL_WRITE_FAILED", causeCode: "EPIPE" });
  expect(() => handle.stdin.write("request")).toThrow("NATIVE_ADMISSION_CLOSED");
  child.reap(0);
  await expect(handle.completed).rejects.toMatchObject({ code: "PRIVATE_DOMAIN_UNRESOLVED" });
});

test("socket construction failure closes the raw control fd and retains unresolved reap ownership", async () => {
  const child = controlledProcess(17);
  let closedFd: number | undefined;
  const controller = new PrivateHelperController({ spawn: () => child.process,
    openControl: () => { throw Object.assign(new Error("secret socket path"), { code: "EMFILE" }); },
    closeControl: fd => { closedFd = fd; } });
  const handle = controller.launch({ generation, registerHeldHelper: async () => {} });
  expect(closedFd).toBe(17);
  await expect(handle.ready).rejects.toMatchObject({ code: "HELPER_CONTROL_UNAVAILABLE", causeCode: "EMFILE" });
  expect(() => handle.stdin.write("request")).toThrow("NATIVE_ADMISSION_CLOSED");
  child.reap(0);
  expect(await handle.helperExited).toBe(0);
  await expect(handle.completed).rejects.toMatchObject({ code: "PRIVATE_DOMAIN_UNRESOLVED" });
});

test("listener setup failure retains the transferred socket and returns a fenced owning handle", async () => {
  const child = controlledProcess(17);
  let closed = false;
  const controller = new PrivateHelperController({ spawn: () => child.process,
    openControl: () => ({ on: () => { throw new Error("secret socket setup data"); }, write: () => {},
      destroy: () => { closed = true; } }),
    closeControl: () => { throw new Error("fd already transferred"); } });
  const handle = controller.launch({ generation, registerHeldHelper: async () => {} });
  expect(closed).toBe(true);
  await expect(handle.ready).rejects.toMatchObject({ code: "HELPER_CONTROL_UNAVAILABLE", causeCode: "UNCLASSIFIED" });
  expect(() => handle.stdin.write("request")).toThrow("NATIVE_ADMISSION_CLOSED");
  child.reap(0);
  await expect(handle.completed).rejects.toMatchObject({ code: "PRIVATE_DOMAIN_UNRESOLVED" });
});
