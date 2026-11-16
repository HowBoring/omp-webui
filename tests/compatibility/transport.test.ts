import { expect, test } from "bun:test";
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

const fixture = (mode: string, timeoutMs = 500) => PreflightTransport.open({
  argv: [process.execPath, "tests/fixtures/preflight-peer.ts", mode], env: {}, timeoutMs,
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

for (const mode of ["wrong-id", "wrong-command", "invalid-result"]) {
  test(`public transport rejects ${mode} without treating acknowledgement as compatibility`, async () => {
    const client = await fixture(mode);
    try { await expect(client.inspect()).rejects.toThrow(mode === "invalid-result" ? "RPC_RESULT_SCHEMA" : "RPC_PROTOCOL"); }
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
  const client = await fixture("hung", 50);
  await client.inspect();
  const result = await client.close();
  expect(result.forced).toBe(true);
  expect(result.code).not.toBe(0);
});

test("cancellation rejects pending work and reaps without replay", async () => {
  const abort = new AbortController();
  const client = await PreflightTransport.open({
    argv: [process.execPath, "tests/fixtures/preflight-peer.ts", "no-response"], env: {}, signal: abort.signal,
  });
  const pending = client.inspect();
  abort.abort();
  await expect(pending).rejects.toThrow("RPC_CANCELLED");
  expect((await client.close()).protocolFailure).toBe("RPC_CANCELLED");
});

test("blocked stdin flush cannot prevent EOF shutdown deadlines and process reaping", async () => {
  const client = await fixture("never-read", 50);
  // Enough bounded rounds to fill a real Linux pipe after the child stops reading.
  for (let round = 0; round < 8; round++) {
    await Promise.allSettled(Array.from({ length: 32 }, () => client.inspect()));
  }
  const start = performance.now();
  const result = await client.close();
  expect(result.forced).toBe(true);
  expect(result.code).not.toBe(0);
  expect(performance.now() - start).toBeLessThan(1200);
});

test("stdin EOF still drains a valid pending response before observing actual exit", async () => {
  const client = await fixture("eof-response");
  const report = client.inspect();
  const closing = client.close();
  expect((await report).candidate).toBe("omp-webui-s0");
  expect(await closing).toEqual({ code: 0, forced: false, stderrBytes: 0 });
});
