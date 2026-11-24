import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { ExternalProtectorController, type ExternalProtectorProcess } from "../../../packages/supervision/external.ts";

const generation = "a".repeat(64);
class Control extends EventEmitter {
  readonly written: string[] = [];
  holdWrites = false;
  finishWrite: (() => void) | undefined;
  write(bytes: Uint8Array, callback: (error?: Error | null) => void): void {
    this.written.push(new TextDecoder().decode(bytes));
    if (this.holdWrites) this.finishWrite = callback;
    else callback();
  }
  destroy(): void { this.emit("close"); }
  receive(frame: string): void { this.emit("data", Buffer.from(frame)); }
}
function controlled() {
  const socket = new Control();
  const reap = Promise.withResolvers<number>();
  const process: ExternalProtectorProcess = { pid: 41, exited: reap.promise, stdio: [null, null, null, 17] };
  const controller = new ExternalProtectorController({ spawn: () => process, openControl: () => socket,
    closeControl: () => {} });
  return { socket, reap, controller };
}

test("external broker start waits for independent dispatcher verification and completion also waits for reap", async () => {
  const os = controlled();
  const verified = Promise.withResolvers<void>();
  const handle = os.controller.launch({ generation, registerHeldProtector: async () => verified.promise });
  os.socket.receive(`HELLO ${generation} 41 123 42 124\nSTATE ${generation} waiting\n`);
  await Promise.resolve();
  expect(os.socket.written).toEqual([]);
  verified.resolve();
  expect((await handle.ready).nativePid).toBe(42);
  expect(os.socket.written).toEqual([`START ${generation}\n`]);
  os.socket.receive(`STATE ${generation} running\nROOT_EXIT ${generation} 0 0\nCOMPLETE ${generation}\n`);
  os.socket.emit("end");
  let drained = false;
  void handle.completed.then(() => { drained = true; });
  await Promise.resolve();
  expect(drained).toBe(false);
  os.reap.resolve(0);
  await handle.completed;
  expect(drained).toBe(true);
});

test("a delivered COMPLETE remains provisional if protector finalization exits unsuccessfully", async () => {
  const os = controlled();
  const handle = os.controller.launch({ generation, registerHeldProtector: async () => {} });
  os.socket.receive(`HELLO ${generation} 41 123 42 124\n`);
  await handle.ready;
  os.socket.receive(`ROOT_EXIT ${generation} 0 0\nCOMPLETE ${generation}\n`);
  os.socket.emit("end");
  os.reap.resolve(75);
  expect(await handle.protectorExited).toBe(75);
  await expect(handle.completed).rejects.toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
});

test("queued ROOT_EXIT and COMPLETE survive end followed by close after startup", async () => {
  const os = controlled();
  const handle = os.controller.launch({ generation, registerHeldProtector: async () => {} });
  os.socket.receive(`HELLO ${generation} 41 123 42 124\n`);
  await handle.ready;
  os.socket.receive(`ROOT_EXIT ${generation} 0 0\n`);
  os.socket.receive(`COMPLETE ${generation}\n`);
  os.socket.emit("end"); os.socket.emit("close"); os.socket.emit("close"); os.socket.emit("end");
  os.reap.resolve(0);
  await handle.completed;
  expect(os.socket.written).toEqual([`START ${generation}\n`]);
});

test("close without clean EOF rejects COMPLETE with a truncated trailing frame and retains direct reap", async () => {
  const os = controlled();
  const handle = os.controller.launch({ generation, registerHeldProtector: async () => {} });
  os.socket.receive(`HELLO ${generation} 41 123 42 124\n`);
  await handle.ready;
  os.socket.receive(`ROOT_EXIT ${generation} 0 0\nCOMPLETE ${generation}\ntruncated`);
  os.socket.emit("close");
  let result = "pending";
  void handle.completed.then(() => { result = "completed"; }, () => { result = "unresolved"; });
  await nextTurn();
  expect(result).toBe("pending");
  expect(handle.protectorPid).toBe(41);
  os.reap.resolve(0);
  expect(await handle.protectorExited).toBe(0);
  await expect(handle.completed).rejects.toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
  expect(result).toBe("unresolved");
});

for (const ending of ["close", "partial EOF"] as const) {
  test(`${ending} cannot turn a provisional external COMPLETE into verified terminal completion`, async () => {
    const os = controlled();
    const handle = os.controller.launch({ generation, registerHeldProtector: async () => {} });
    os.socket.receive(`HELLO ${generation} 41 123 42 124\n`);
    await handle.ready;
    os.socket.receive(`ROOT_EXIT ${generation} 0 0\nCOMPLETE ${generation}\n${ending === "partial EOF" ? "tail" : ""}`);
    os.socket.emit(ending === "close" ? "close" : "end");
    os.socket.emit("close");
    os.reap.resolve(0);
    expect(await handle.protectorExited).toBe(0);
    await expect(handle.completed).rejects.toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
    expect(os.socket.written).toEqual([`START ${generation}\n`]);
  });
}

for (const loss of ["error", "disconnect"] as const) {
  for (const cleanEof of [false, true]) {
    test(`${loss} ${cleanEof ? "after" : "before"} EOF invalidates external COMPLETE until direct reap`, async () => {
      const os = controlled();
      const handle = os.controller.launch({ generation, registerHeldProtector: async () => {} });
      os.socket.receive(`HELLO ${generation} 41 123 42 124\n`);
      await handle.ready;
      os.socket.receive(`ROOT_EXIT ${generation} 0 0\nCOMPLETE ${generation}\n`);
      if (cleanEof) { os.socket.emit("end"); await nextTurn(); }
      if (loss === "error") os.socket.emit("error");
      else handle.disconnectControl();
      os.socket.emit("end"); os.socket.emit("close");
      let settled = false;
      void handle.completed.then(() => { settled = true; }, () => { settled = true; });
      await nextTurn();
      expect(settled).toBe(false);
      os.reap.resolve(0);
      expect(await handle.protectorExited).toBe(0);
      await expect(handle.completed).rejects.toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
    });
  }
}

test("lost external control during verification never releases START or reports a drained tree", async () => {
  const os = controlled();
  const verified = Promise.withResolvers<void>();
  const handle = os.controller.launch({ generation, registerHeldProtector: async () => verified.promise });
  os.socket.receive(`HELLO ${generation} 41 123 42 124\n`);
  await Promise.resolve();
  handle.disconnectControl();
  await expect(handle.ready).rejects.toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
  verified.resolve();
  await Promise.resolve();
  expect(os.socket.written).toEqual([]);
  os.reap.resolve(0);
  await expect(handle.completed).rejects.toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
});

test("broker root reap and clean protector exit cannot replace descendant extinction acknowledgement", async () => {
  const os = controlled();
  const handle = os.controller.launch({ generation, registerHeldProtector: async () => {} });
  os.socket.receive(`HELLO ${generation} 41 123 42 124\n`);
  await handle.ready;
  os.socket.receive(`ROOT_EXIT ${generation} 0 0\n`);
  os.socket.emit("end");
  os.reap.resolve(0);
  await expect(handle.completed).rejects.toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
  expect(os.socket.written).toEqual([`START ${generation}\n`]);
});

test("external controller refuses private escalation states without sending a cleanup command", async () => {
  const os = controlled();
  const handle = os.controller.launch({ generation, registerHeldProtector: async () => {} });
  os.socket.receive(`HELLO ${generation} 41 123 42 124\n`);
  await handle.ready;
  os.socket.receive(`STATE ${generation} kill\nROOT_EXIT ${generation} 0 0\nCOMPLETE ${generation}\n`);
  os.reap.resolve(0);
  await expect(handle.completed).rejects.toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
  expect(os.socket.written).toEqual([`START ${generation}\n`]);
});

test("a missing post-spawn control fd preserves the owning external handle through failure and direct reap", async () => {
  const reap = Promise.withResolvers<number>();
  const controller = new ExternalProtectorController({
    spawn: () => ({ pid: 41, exited: reap.promise, stdio: [] }),
    openControl: () => { throw new Error("not reached"); }, closeControl: () => {},
  });
  const handle = controller.launch({ generation, registerHeldProtector: async () => {} });
  expect(handle.protectorPid).toBe(41);
  await expect(handle.ready).rejects.toMatchObject({ code: "EXTERNAL_CONTROL_UNAVAILABLE" });
  reap.resolve(0);
  expect(await handle.protectorExited).toBe(0);
  await expect(handle.completed).rejects.toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
});

test("uncertain raw control close is never retried and retains failed startup through original direct reap", async () => {
  const reap = Promise.withResolvers<number>();
  const closed: number[] = [];
  let registered = false;
  const controller = new ExternalProtectorController({
    spawn: () => ({ pid: 41, exited: reap.promise, stdio: [null, null, null, 17] }),
    openControl: () => { throw Object.assign(new Error("private open detail"), { code: "EACCES" }); },
    closeControl: fd => {
      closed.push(fd);
      throw Object.assign(new Error("uncertain close detail"), { code: "EIO" });
    },
  });
  const handle = controller.launch({ generation, registerHeldProtector: async () => { registered = true; } });
  const failure: unknown = await handle.ready.catch((error: unknown) => error);
  expect(failure).toMatchObject({ code: "EXTERNAL_CONTROL_UNAVAILABLE", causeCode: "EACCES" });
  expect(String(failure)).toBe("ExternalProtectorError: EXTERNAL_CONTROL_UNAVAILABLE");
  let completion = "pending";
  let exited = false;
  void handle.completed.then(() => { completion = "completed"; }, () => { completion = "unresolved"; });
  void handle.protectorExited.then(() => { exited = true; });
  handle.disconnectControl(); handle.disconnectControl();
  await nextTurn();
  expect(handle.protectorPid).toBe(41);
  expect(registered).toBe(false);
  expect(exited).toBe(false);
  expect(completion).toBe("pending");
  expect(await handle.ready.catch((error: unknown) => error)).toBe(failure);
  reap.resolve(0);
  expect(await handle.protectorExited).toBe(0);
  await expect(handle.completed).rejects.toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
  handle.disconnectControl();
  await nextTurn();
  expect(completion).toBe("unresolved");
  expect(closed).toEqual([17]);
});

test("failed independent registration leaves START held and exposes only a finite diagnostic category", async () => {
  const os = controlled();
  const handle = os.controller.launch({ generation, registerHeldProtector: async () => {
    throw Object.assign(new Error("secret dispatcher data"), { code: "unexpected-secret-code" });
  } });
  os.socket.receive(`HELLO ${generation} 41 123 42 124\n`);
  const failure: unknown = await handle.ready.catch((error: unknown) => error);
  expect(failure).toMatchObject({ code: "EXTERNAL_REGISTRATION_FAILED", causeCode: "UNCLASSIFIED" });
  expect(String(failure)).toBe("ExternalProtectorError: EXTERNAL_REGISTRATION_FAILED");
  expect(os.socket.written).toEqual([]);
  os.reap.resolve(0);
  await expect(handle.completed).rejects.toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
});

test("an external incomplete report remains unresolved even if later frames claim complete extinction", async () => {
  const os = controlled();
  const handle = os.controller.launch({ generation, registerHeldProtector: async () => {} });
  os.socket.receive(`HELLO ${generation} 41 123 42 124\n`);
  await handle.ready;
  os.socket.receive(`STATE ${generation} incomplete\nROOT_EXIT ${generation} 0 0\nCOMPLETE ${generation}\n`);
  os.socket.emit("end");
  os.reap.resolve(0);
  await expect(handle.completed).rejects.toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
});

const nextTurn = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

for (const arrival of ["during registration", "with HELLO"] as const) {
  test(`root exit ${arrival} closes startup but permits verified terminal completion`, async () => {
    const os = controlled();
    const verified = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const handle = os.controller.launch({ generation, registerHeldProtector: async () => {
      entered.resolve(); await verified.promise;
    } });
    let readyResult: unknown;
    void handle.ready.then(hello => { readyResult = hello; }, error => { readyResult = error; });
    const rootExit = `ROOT_EXIT ${generation} 0 0\n`;
    os.socket.receive(`HELLO ${generation} 41 123 42 124\n${arrival === "with HELLO" ? rootExit : ""}`);
    await entered.promise;
    if (arrival === "during registration") os.socket.receive(rootExit);
    await nextTurn();
    const beforeVerification = readyResult;
    verified.resolve();
    await nextTurn();
    let completed = false;
    void handle.completed.then(() => { completed = true; });
    os.socket.receive(`COMPLETE ${generation}\n`);
    os.socket.emit("end");
    await nextTurn();
    expect(completed).toBe(false);
    os.reap.resolve(0);
    await handle.completed;
    expect(os.socket.written).toEqual([]);
    expect(beforeVerification).toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
    expect(readyResult).toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
    expect(await handle.protectorExited).toBe(0);
    expect(completed).toBe(true);
  });
}

test("root exit before START write completion rejects readiness while preserving verified terminal drain", async () => {
  const os = controlled();
  os.socket.holdWrites = true;
  const handle = os.controller.launch({ generation, registerHeldProtector: async () => {} });
  let readyResult: unknown;
  void handle.ready.then(hello => { readyResult = hello; }, error => { readyResult = error; });
  os.socket.receive(`HELLO ${generation} 41 123 42 124\n`);
  await nextTurn();
  expect(os.socket.written).toEqual([`START ${generation}\n`]);
  expect(readyResult).toBeUndefined();
  os.socket.receive(`ROOT_EXIT ${generation} 0 0\nCOMPLETE ${generation}\n`);
  os.socket.emit("end");
  await nextTurn();
  const beforeWriteCompletion = readyResult;
  os.socket.finishWrite?.();
  await nextTurn();
  os.reap.resolve(0);
  await handle.completed;
  expect(beforeWriteCompletion).toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
  expect(readyResult).toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
  expect(os.socket.written).toEqual([`START ${generation}\n`]);
  expect(await handle.protectorExited).toBe(0);
});

const invalidDuringVerification = [
  ...["ordinary", "cooperative", "term", "kill"].map(phase => ({
    name: `${phase} phase`, frame: `STATE ${generation} ${phase}\n`,
  })),
  { name: "duplicate HELLO", frame: `HELLO ${generation} 41 123 42 124\n` },
  { name: "duplicate ROOT_EXIT", frame: `ROOT_EXIT ${generation} 0 0\nROOT_EXIT ${generation} 0 0\n` },
];
for (const { invalid, arrival } of invalidDuringVerification.flatMap(invalid =>
  ["during registration", "with HELLO"].map(arrival => ({ invalid, arrival })))) {
  test(`${invalid.name} ${arrival} rejects readiness without releasing START or external ownership`, async () => {
    const os = controlled();
    const verified = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const handle = os.controller.launch({ generation, registerHeldProtector: async () => {
      entered.resolve(); await verified.promise;
    } });
    os.socket.receive(`HELLO ${generation} 41 123 42 124\n${arrival === "with HELLO" ? invalid.frame : ""}`);
    if (arrival === "during registration") await entered.promise;
    let readyResult: unknown;
    void handle.ready.then(hello => { readyResult = hello; }, error => { readyResult = error; });
    let completionSettled = false;
    void handle.completed.then(() => { completionSettled = true; }, () => { completionSettled = true; });
    if (arrival === "during registration") os.socket.receive(invalid.frame);
    await nextTurn();
    const beforeVerification = readyResult;
    expect(completionSettled).toBe(false);
    expect(handle.protectorPid).toBe(41);
    verified.resolve();
    await nextTurn();
    expect(os.socket.written).toEqual([]);
    expect(beforeVerification).toMatchObject({ code: "EXTERNAL_PROTOCOL" });
    expect(readyResult).toMatchObject({ code: "EXTERNAL_PROTOCOL" });
    os.reap.resolve(0);
    expect(await handle.protectorExited).toBe(0);
    await expect(handle.completed).rejects.toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
  });
}

for (const arrival of ["end", "close", "incomplete"] as const) {
  test(`${arrival} during held verification rejects readiness and cannot release a late START`, async () => {
    const os = controlled();
    const verified = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const handle = os.controller.launch({ generation, registerHeldProtector: async () => {
      entered.resolve(); await verified.promise;
    } });
    os.socket.receive(`HELLO ${generation} 41 123 42 124\n`);
    await entered.promise;
    let readyResult: unknown;
    void handle.ready.then(hello => { readyResult = hello; }, error => { readyResult = error; });
    let completionSettled = false;
    void handle.completed.then(() => { completionSettled = true; }, () => { completionSettled = true; });
    if (arrival === "incomplete") os.socket.receive(`STATE ${generation} incomplete\n`);
    else os.socket.emit(arrival);
    await nextTurn();
    const observedBeforeVerification = readyResult;
    expect(completionSettled).toBe(false);
    expect(handle.protectorPid).toBe(41);
    verified.resolve();
    await nextTurn();
    expect(os.socket.written).toEqual([]);
    expect(observedBeforeVerification).toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
    expect(readyResult).toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
    os.reap.resolve(0);
    expect(await handle.protectorExited).toBe(0);
    await expect(handle.completed).rejects.toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
  });
}

test("COMPLETE before ROOT_EXIT keeps external ownership unresolved even after a clean direct reap", async () => {
  const os = controlled();
  const handle = os.controller.launch({ generation, registerHeldProtector: async () => {} });
  os.socket.receive(`HELLO ${generation} 41 123 42 124\n`);
  await handle.ready;
  os.socket.receive(`COMPLETE ${generation}\nROOT_EXIT ${generation} 0 0\n`);
  let settled = false;
  void handle.completed.then(() => { settled = true; }, () => { settled = true; });
  await nextTurn();
  expect(handle.protectorPid).toBe(41);
  expect(settled).toBe(false);
  os.reap.resolve(0);
  expect(await handle.protectorExited).toBe(0);
  await expect(handle.completed).rejects.toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
});

test("COMPLETE before HELLO never registers or releases a late START", async () => {
  const os = controlled();
  const registrations: number[] = [];
  const handle = os.controller.launch({ generation, registerHeldProtector: async hello => {
    registrations.push(hello.helperPid);
  } });
  os.socket.receive(`COMPLETE ${generation}\nHELLO ${generation} 41 123 42 124\n`);
  await expect(handle.ready).rejects.toMatchObject({ code: "EXTERNAL_PROTOCOL" });
  expect(registrations).toEqual([]);
  expect(os.socket.written).toEqual([]);
  expect(handle.protectorPid).toBe(41);
  os.reap.resolve(0);
  await expect(handle.completed).rejects.toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
});

test("COMPLETE received during held registration rejects readiness and cannot release START after verification", async () => {
  const os = controlled();
  const verified = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const handle = os.controller.launch({ generation, registerHeldProtector: async () => {
    entered.resolve(); await verified.promise;
  } });
  os.socket.receive(`HELLO ${generation} 41 123 42 124\n`);
  await entered.promise;
  os.socket.receive(`ROOT_EXIT ${generation} 0 0\nCOMPLETE ${generation}\n`);
  let readyFailure: unknown;
  void handle.ready.catch(error => { readyFailure = error; });
  let completionSettled = false;
  void handle.completed.then(() => { completionSettled = true; }, () => { completionSettled = true; });
  await nextTurn();
  expect(readyFailure).toMatchObject({ code: "EXTERNAL_PROTOCOL" });
  expect(completionSettled).toBe(false);
  expect(handle.protectorPid).toBe(41);
  verified.resolve();
  await nextTurn();
  expect(os.socket.written).toEqual([]);
  os.reap.resolve(0);
  expect(await handle.protectorExited).toBe(0);
  await expect(handle.completed).rejects.toMatchObject({ code: "EXTERNAL_UNRESOLVED" });
});
