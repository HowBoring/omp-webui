import { expect, test } from "bun:test";
import { HelperDrainHostGate } from "../../compatibility/omp/fixtures/native-helper-drain-gate";
import { assertHelperDrainLaunchRoster } from "../../compatibility/omp/fixtures/native-helper-drain-launch";

const generation = "a".repeat(64);
const hello = { generation, helperPid: 123, helperStartTime: "100", nativePid: 124, nativeStartTime: "101" };

test("launch roster equality normalizes observed field order and still rejects a changed mode", () => {
  const files = [{ path: ".", kind: "directory", identity: generation, mode: 0o700 }];
  const platform = Array.from({ length: 7 }, (_, index) => ({ path: `/platform/${index}`, kind: "file",
    identity: generation, mode: 0o755 }));
  const signed = { format: "omp-native-helper-drain-launch/1", members: files, platformDependencies: platform };
  const reordered = platform.map(({ path, kind, identity, mode }) => ({ mode, identity, kind, path }));
  expect(() => assertHelperDrainLaunchRoster(signed,
    files.map(({ path, kind, identity, mode }) => ({ mode, path, identity, kind })), reordered,
    { kind: "staged-runtime/1" })).not.toThrow();
  expect(() => assertHelperDrainLaunchRoster(signed, files,
    reordered.map((member, index) => index === 0 ? { ...member, mode: 0o700 } : member),
    { kind: "staged-runtime/1" })).toThrow("DRAIN_LAUNCH_CHANGED");
});

test("Host START registration stays held after signed status until original parent continues", async () => {
  const parent = Promise.withResolvers<void>();
  const registered = Promise.withResolvers<void>();
  let status: "pending" | "registered" = "pending", prepared = false, returned = false;
  const gate = new HelperDrainHostGate({ generation, originalHelperPid: () => 123,
    client: { prepareHelper: async () => { prepared = true; }, helperStatus: async () => status },
    registered: () => registered.resolve(), continueStart: () => parent.promise });
  await gate.prepareHelper(generation);
  expect(prepared).toBe(true);
  status = "registered";
  const release = gate.registerHeldHelper(hello).then(() => { returned = true; });
  await registered.promise;
  expect(returned).toBe(false);
  parent.resolve(); await release;
  expect(returned).toBe(true);
});

test("pending Native status cannot announce registered or release the Host START callback", async () => {
  let announced = false, continued = false;
  const gate = new HelperDrainHostGate({ generation, originalHelperPid: () => 123,
    client: { prepareHelper: async () => {}, helperStatus: async () => "pending" },
    registered: () => { announced = true; }, continueStart: async () => { continued = true; } });
  await gate.prepareHelper(generation);
  await expect(gate.registerHeldHelper(hello)).rejects.toThrow("DRAIN_HELPER_NOT_REGISTERED");
  expect(announced).toBe(false); expect(continued).toBe(false);
});

test("HELLO from another generation or helper cannot reach signed-status or parent release", async () => {
  let statusReads = 0;
  const gate = new HelperDrainHostGate({ generation, originalHelperPid: () => 123,
    client: { prepareHelper: async () => {}, helperStatus: async () => { statusReads++; return "pending"; } },
    registered: () => {}, continueStart: async () => {} });
  await gate.prepareHelper(generation);
  await expect(gate.registerHeldHelper({ ...hello, helperPid: 125 })).rejects.toThrow("DRAIN_HELLO_MISMATCH");
  await expect(gate.registerHeldHelper({ ...hello, generation: "b".repeat(64) })).rejects.toThrow("DRAIN_HELLO_MISMATCH");
  expect(statusReads).toBe(1); // Only the original prepare's pending-status check ran.
});

test("uncertain prepare cannot be retried or converted into a held START", async () => {
  const gate = new HelperDrainHostGate({ generation, originalHelperPid: () => 123,
    client: { prepareHelper: async () => { throw new Error("LOST_PREPARE_REPLY"); },
      helperStatus: async () => "registered" },
    registered: () => { throw new Error("UNEXPECTED_REGISTERED"); }, continueStart: async () => {} });
  await expect(gate.prepareHelper(generation)).rejects.toThrow("LOST_PREPARE_REPLY");
  await expect(gate.prepareHelper(generation)).rejects.toThrow("DRAIN_PREPARE_MISMATCH");
  await expect(gate.registerHeldHelper(hello)).rejects.toThrow("DRAIN_HELLO_MISMATCH");
});

test("a pending registration owns the sole parent START gate", async () => {
  const status = Promise.withResolvers<"pending" | "registered">();
  let prepared = false;
  const gate = new HelperDrainHostGate({ generation, originalHelperPid: () => 123,
    client: { prepareHelper: async () => {}, helperStatus: async () => prepared ? status.promise : "pending" },
    registered: () => {}, continueStart: async () => {} });
  await gate.prepareHelper(generation); prepared = true;
  const first = gate.registerHeldHelper(hello);
  const repeated = gate.registerHeldHelper(hello);
  status.resolve("registered");
  await first;
  await expect(repeated).rejects.toThrow("DRAIN_HELLO_MISMATCH");
});
