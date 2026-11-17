import { expect, test } from "bun:test";
import { ControlIoError } from "../../packages/control-io/errors.ts";
import { createOwnedControlIo, type ControlIoSystem, type ControlScheduler } from "../../packages/control-io/socket.ts";

/** Controlled OS adapter: peer bytes and readiness are independent from the transport implementation. No FFI. */
class Peer implements ControlIoSystem {
  incoming: Uint8Array[] = [];
  outgoing: number[] = [];
  eof = false;
  blocked = false;
  sendLimit = 512;
  closed = 0;
  disposed = false;
  interruptedReads = 0;
  reads = 0;
  writes = 0;
  closeError: ControlIoError | undefined;
  disposalError: ControlIoError | undefined;
  #next = 16;
  #owned = new Map<number, number>();
  adopt(fd: number) {
    if ([...this.#owned.values()].includes(fd)) throw new ControlIoError("CONTROL_IO_ADOPT_FAILED");
    const handle = ++this.#next; this.#owned.set(handle, fd); return handle;
  }
  #valid(handle: number) {
    if (!this.#owned.has(handle)) throw new Error("CONTROLLED_OS_STALE_HANDLE");
  }
  receive(_handle: number, bytes: Uint8Array) {
    this.#valid(_handle); this.reads++;
    if (this.interruptedReads > 0) { this.interruptedReads--; return { kind: "interrupted" as const }; }
    const chunk = this.incoming.shift();
    if (!chunk) return this.eof ? { kind: "eof" as const } : { kind: "blocked" as const };
    bytes.set(chunk);
    return { kind: "bytes" as const, count: chunk.byteLength };
  }
  send(_handle: number, bytes: Uint8Array) {
    this.#valid(_handle); this.writes++;
    if (this.blocked) return { kind: "blocked" as const };
    const count = Math.min(this.sendLimit, bytes.byteLength);
    this.outgoing.push(...bytes.subarray(0, count));
    return { kind: "bytes" as const, count };
  }
  close(handle: number) {
    this.#valid(handle); this.#owned.delete(handle); this.closed++;
    if (this.closeError) throw this.closeError;
  }
  async dispose() { this.disposed = true; if (this.disposalError) throw this.disposalError; }
}
class Clock implements ControlScheduler {
  next = 0;
  callbacks = new Map<number, () => void>();
  schedule(callback: () => void) { const token = ++this.next; this.callbacks.set(token, callback); return token; }
  cancel(token: number) { this.callbacks.delete(token); }
  turn() {
    const current = [...this.callbacks.values()]; this.callbacks.clear();
    for (const callback of current) callback();
  }
}

test("control socket sends while its peer is idle and drains tail before EOF and close", async () => {
  const peer = new Peer(); const clock = new Clock();
  const module = createOwnedControlIo(peer, clock);
  const socket = module.openControl(9);
  const seen: string[] = [];
  socket.on("data", bytes => seen.push(bytes.toString("ascii")));
  socket.on("end", () => seen.push("end"));
  socket.on("close", () => seen.push("close"));
  socket.write(new TextEncoder().encode("CMD\n"), error => seen.push(error ? "failed" : "written"));
  clock.turn();
  expect(peer.outgoing).toEqual([67, 77, 68, 10]);
  peer.incoming.push(new TextEncoder().encode("TAIL\n")); peer.eof = true;
  clock.turn();
  expect(seen).toEqual(["written", "TAIL\n", "end", "close"]);
  expect(peer.closed).toBe(1);
  expect(clock.callbacks.size).toBe(0);
  await module.close();
  expect(peer.disposed).toBe(true);
});

test("callbacks may disconnect but cannot unload a library still returning from a poll turn", async () => {
  const peer = new Peer(); const clock = new Clock();
  const module = createOwnedControlIo(peer, clock); const socket = module.openControl(9);
  let closing: Promise<void> | undefined;
  socket.on("data", () => { socket.destroy(); closing = module.close(); });
  peer.incoming.push(new Uint8Array([65]), new Uint8Array([66]));
  clock.turn();
  await expect(closing).rejects.toMatchObject({ code: "CONTROL_IO_BUSY" });
  expect(peer.closed).toBe(1);
  expect(peer.incoming).toEqual([new Uint8Array([66])]);
  expect(clock.callbacks.size).toBe(0);
  await module.close();
});

test("a shared library cannot unload through a second module during another module's final callback", async () => {
  const first = new Peer(); const second = new Peer(); const clock = new Clock();
  const a = createOwnedControlIo(first, clock); const b = createOwnedControlIo(second, clock);
  const socket = a.openControl(9);
  let closing: Promise<void> | undefined;
  socket.on("close", () => { closing = b.close(); });
  socket.destroy();
  await expect(closing).rejects.toMatchObject({ code: "CONTROL_IO_BUSY" });
  expect(second.disposed).toBe(false);
  await a.close(); await b.close();
});

test("partial writes preserve FIFO and own a byte copy across would-block and interrupted reads", async () => {
  const peer = new Peer(); const clock = new Clock(); const module = createOwnedControlIo(peer, clock);
  const socket = module.openControl(9); const results: string[] = [];
  const first = new Uint8Array([65, 66, 67]); peer.blocked = true; peer.sendLimit = 1; peer.interruptedReads = 1;
  socket.write(first, error => results.push(error ? "failed" : "ABC")); first.fill(90);
  socket.write(new Uint8Array([68, 69]), error => results.push(error ? "failed" : "DE"));
  clock.turn(); expect(results).toEqual([]); expect(peer.outgoing).toEqual([]);
  peer.blocked = false; clock.turn();
  expect(peer.outgoing).toEqual([65, 66, 67, 68, 69]); expect(results).toEqual(["ABC", "DE"]);
  socket.destroy(); await module.close();
});

test("disconnect cancels blocked writes once and a stale scheduled turn cannot touch a reused descriptor", async () => {
  const peer = new Peer(); const clock = new Clock(); const module = createOwnedControlIo(peer, clock);
  const socket = module.openControl(9); peer.blocked = true;
  const errors: string[] = [];
  socket.write(new Uint8Array([65]), error => errors.push(error?.message ?? "success"));
  const staleTurn = [...clock.callbacks.values()][0];
  clock.turn(); socket.destroy(); socket.destroy();
  staleTurn?.();
  expect(errors).toEqual(["CONTROL_IO_CLOSED"]);
  expect(peer.closed).toBe(1); expect(peer.outgoing).toEqual([]); expect(clock.callbacks.size).toBe(0);
  await module.close();
});

test("write completion may destroy the socket before the next read", async () => {
  const peer = new Peer(); const clock = new Clock(); const module = createOwnedControlIo(peer, clock);
  const socket = module.openControl(9); peer.incoming.push(new Uint8Array([88]));
  socket.write(new Uint8Array([65]), () => socket.destroy()); clock.turn();
  expect(peer.incoming).toEqual([new Uint8Array([88])]); expect(peer.closed).toBe(1);
  await module.close();
});

test("the seventeenth queued frame fails closed and rejects all writes exactly once", async () => {
  const peer = new Peer(); const clock = new Clock(); const module = createOwnedControlIo(peer, clock);
  const socket = module.openControl(9); let failed = 0;
  for (let index = 0; index < 17; index++) socket.write(new Uint8Array(512), error => { if (error) failed++; });
  expect(failed).toBe(17); expect(socket.failure?.code).toBe("CONTROL_IO_LIMIT");
  expect(peer.closed).toBe(1); expect(peer.outgoing).toEqual([]); expect(clock.callbacks.size).toBe(0);
  await module.close();
});

test("read-heavy turns yield within 64 syscalls and 16 KiB, keeping the tail for later turns", async () => {
  const peer = new Peer(); const clock = new Clock(); const module = createOwnedControlIo(peer, clock);
  const socket = module.openControl(9); let received = 0;
  socket.on("data", bytes => { received += bytes.byteLength; });
  for (let index = 0; index < 40; index++) peer.incoming.push(new Uint8Array(512));
  clock.turn(); expect(received).toBe(16_384); expect(peer.reads).toBeLessThanOrEqual(64);
  expect(peer.incoming.length).toBe(8); clock.turn(); expect(received).toBe(20_480);
  socket.destroy(); await module.close();
});

test("close EINTR is unresolved and never retries the invalidated handle", async () => {
  const peer = new Peer(); const clock = new Clock(); const module = createOwnedControlIo(peer, clock);
  const socket = module.openControl(9); const events: string[] = [];
  socket.on("error", () => events.push("error")); socket.on("close", () => events.push("close"));
  peer.closeError = new ControlIoError("CONTROL_IO_CLOSE_UNCERTAIN", 4);
  socket.destroy(); socket.destroy(); clock.turn();
  expect(socket.failure).toMatchObject({ code: "CONTROL_IO_CLOSE_UNCERTAIN", errno: 4 });
  expect(events).toEqual(["error", "close"]); expect(peer.closed).toBe(1);
  await expect(module.close()).rejects.toMatchObject({ code: "CONTROL_IO_CLOSE_UNCERTAIN" });
  expect(peer.disposed).toBe(false);
});

test("64 adopted sockets exhaust the process budget without taking the next caller's descriptor", async () => {
  const peer = new Peer(); const clock = new Clock(); const module = createOwnedControlIo(peer, clock);
  const sockets = Array.from({ length: 64 }, (_, index) => module.openControl(index + 10));
  expect(() => module.openControl(99)).toThrow("CONTROL_IO_LIMIT");
  for (const socket of sockets) socket.destroy();
  const last = module.openControl(99); last.destroy();
  expect(peer.closed).toBe(65); await module.close();
});

test("failed adoption preserves existing socket ownership and permits a later new descriptor", async () => {
  const peer = new Peer(); const clock = new Clock(); const module = createOwnedControlIo(peer, clock);
  const first = module.openControl(9);
  expect(() => module.openControl(9)).toThrow("CONTROL_IO_ADOPT_FAILED");
  first.write(new Uint8Array([65]), () => undefined); clock.turn();
  expect(peer.outgoing).toEqual([65]);
  first.destroy(); const next = module.openControl(9); next.destroy();
  expect(peer.closed).toBe(2); await module.close();
});

test("an uncertain library shutdown never allows new adoption through a possibly unloaded library", async () => {
  const peer = new Peer(); const clock = new Clock(); const module = createOwnedControlIo(peer, clock);
  peer.disposalError = new ControlIoError("CONTROL_IO_LOAD_FAILED");
  await expect(module.close()).rejects.toMatchObject({ code: "CONTROL_IO_LOAD_FAILED" });
  expect(() => module.openControl(9)).toThrow("CONTROL_IO_CLOSED");
  await expect(module.close()).rejects.toMatchObject({ code: "CONTROL_IO_LOAD_FAILED" });
});
