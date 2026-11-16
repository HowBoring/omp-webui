import { expect, test, spyOn } from "bun:test";
import { PreflightTransport } from "../../packages/compatibility/transport.ts";

test("real candidate transport negotiates public v2 then drains and reaps after the report", async () => {
  const client = await PreflightTransport.open({
    argv: [process.execPath, "vendor/omp-candidate/cli.js", "--rpc-preflight"], env: {},
  });
  const report = await client.inspect();
  expect(report.candidate).toBe("omp-webui-s0");
  expect(report.sessionAdmission).toBe("blocked");
  expect(await client.close()).toEqual({ code: 0, forced: false, stderrBytes: 0 });
});

const fixture = (mode: string, timeoutMs = 500, readyDelayMs = 0, negotiateDelayMs = 0) => PreflightTransport.open({
  argv: [process.execPath, "tests/fixtures/preflight-peer.ts", mode, String(readyDelayMs), String(negotiateDelayMs)],
  env: {}, timeoutMs,
  // Cold Bun startup is unrelated to the deliberately short request and shutdown deadlines.
  readyTimeoutMs: 3000,
});

test("slow ready and negotiation do not consume the short late-response request budget", async () => {
  const client = await fixture("late", 50, 150, 150);
  try { await expect(client.inspect()).rejects.toThrow("RPC_REQUEST_TIMEOUT"); }
  finally { await client.close(); }
});

test("ready and negotiation share one independently bounded startup deadline", async () => {
  const start = performance.now();
  await expect(PreflightTransport.open({
    argv: [process.execPath, "tests/fixtures/preflight-peer.ts", "late", "150", "150"],
    env: {}, timeoutMs: 1000, readyTimeoutMs: 200,
  })).rejects.toThrow("RPC_READY_TIMEOUT");
  expect(performance.now() - start).toBeLessThan(1200);
});

test("omitting the startup override preserves the selected timeout for ready", async () => {
  await expect(PreflightTransport.open({
    argv: [process.execPath, "tests/fixtures/preflight-peer.ts", "late", "150"], env: {}, timeoutMs: 50,
  })).rejects.toThrow("RPC_READY_TIMEOUT");
});

test("public request IDs correlate concurrent responses completed in reverse order", async () => {
  const client = await fixture("out-of-order");
  try {
    const order: string[] = [];
    const first = client.inspect().then(value => { order.push("first"); return value; });
    const second = client.inspect().then(value => { order.push("second"); return value; });
    expect((await first).capabilities).toEqual(["first"]);
    expect((await second).capabilities).toEqual(["second"]);
    expect(order).toEqual(["second", "first"]);
  } finally { await client.close(); }
});

test("a valid report followed by partial EOF is a failed drain, never successful diagnostics", async () => {
  const client = await fixture("tail");
  await client.inspect();
  const drain = await client.close();
  expect(drain.protocolFailure).toBe("RPC_PROTOCOL");
});

for (const mode of ["wrong-id", "wrong-command", "invalid-result", "missing-policy"]) {
  test(`public transport rejects ${mode} without treating acknowledgement as compatibility`, async () => {
    const client = await fixture(mode);
    try { await expect(client.inspect()).rejects.toThrow(["invalid-result","missing-policy"].includes(mode) ? "RPC_RESULT_SCHEMA" : "RPC_PROTOCOL"); }
    finally { await client.close(); }
  });
}

for (const mode of ["duplicate", "invalid-utf8"]) {
  test(`a ${mode} terminal frame cannot turn into a successful diagnostic drain`, async () => {
    const client = await fixture(mode);
    await client.inspect();
    expect((await client.close()).protocolFailure).toBe("RPC_PROTOCOL");
  });
}

test("late response after timeout cannot revive a request, but its bytes are drained", async () => {
  const client = await fixture("late", 50);
  await expect(client.inspect()).rejects.toThrow("RPC_REQUEST_TIMEOUT");
  expect((await client.close()).protocolFailure).toBeUndefined();
});

test("stderr stays separate and its sensitive fixture contents are never returned", async () => {
  const client = await fixture("stderr-secret");
  await client.inspect();
  const result = await client.close();
  expect(result.stderrBytes).toBe(37);
  expect(JSON.stringify(result)).not.toContain("secret-fixture");
});

test("EOF drain reaps a non-exiting process within the diagnostic termination budget", async () => {
  const client = await fixture("hung", 50, 150);
  await client.inspect();
  const start = performance.now();
  const result = await client.close();
  expect(result.forced).toBe(true);
  expect(result.code).not.toBe(0);
  expect(performance.now() - start).toBeLessThan(1200);
});

test("cancellation rejects pending work and reaps without replay", async () => {
  const abort = new AbortController();
  const client = await PreflightTransport.open({
    argv: [process.execPath, "tests/fixtures/preflight-peer.ts", "no-response"], env: {}, signal: abort.signal,
  });
  const pending = Array.from({ length: 32 }, () => client.inspect());
  const settled = Promise.allSettled(pending);
  abort.abort();
  for (const request of pending) await expect(request).rejects.toThrow("RPC_CANCELLED");
  await settled;
  const start = performance.now();
  const result = await client.close();
  expect(result.protocolFailure).toBe("RPC_CANCELLED");
  expect(result.code).not.toBe(0);
  expect(performance.now() - start).toBeLessThan(1200);
});

test("blocked stdin keeps queued work bounded while shutdown still reaps the process", async () => {
  const client = await fixture("never-read", 10);
  try {
    // Offer over 500 KiB of small public commands; the fixture consumes none after negotiation.
    // Once flush blocks, timed-out pending slots cannot admit more queued writes.
    for (let round = 0; round < 256; round++) {
      await Promise.allSettled(Array.from({ length: 32 }, () => client.inspect()));
    }
    await expect(client.inspect()).rejects.toThrow("RPC_PENDING_LIMIT");
  } finally {
    const start = performance.now();
    const result = await client.close();
    expect(result.forced).toBe(true);
    expect(result.code).not.toBe(0);
    expect(performance.now() - start).toBeLessThan(1200);
    // The killed non-reader releases an actual pending flush with a broken-stdin failure.
    expect(result.protocolFailure).toBe("RPC_STDIN");
  }
}, 15_000);

test("stdin EOF still drains a valid pending response before observing actual exit", async () => {
  const client = await fixture("eof-response");
  const report = client.inspect();
  const closing = client.close();
  expect((await report).candidate).toBe("omp-webui-s0");
  expect(await closing).toEqual({ code: 0, forced: false, stderrBytes: 0 });
});


test("preflight rejects a duplicate generated ID without replacing its pending waiter", async () => {
  const client = await fixture("late", 500);
  const uuid = spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000030");
  try {
    const first = client.inspect();
    await expect(client.inspect()).rejects.toThrow("RPC_DUPLICATE_ID");
    expect((await first).sessionAdmission).toBe("blocked");
    expect(await client.close()).toEqual({ code: 0, forced: false, stderrBytes: 0 });
  } finally { uuid.mockRestore(); await client.close(); }
});


test("v2 negotiation applies before an adjacent chunk in the same pipe packet", async () => {
  const client = await fixture("coalesced-v2", 1000);
  try {
    expect((await client.inspect()).sessionAdmission).toBe("blocked");
    expect(await client.close()).toEqual({ code: 0, forced: false, stderrBytes: 0 });
  } finally { await client.close(); }
});

for (const mode of ["chunk-before-ack", "wrong-ack-then-chunk"]) {
  test(`${mode} cannot enable v2 chunks`, async () => {
    await expect(fixture(mode, 1000)).rejects.toThrow("RPC_PROTOCOL");
  });
}
