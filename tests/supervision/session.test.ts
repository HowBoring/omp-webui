import { expect, test } from "bun:test";
import { PrivateControlSession } from "../../packages/supervision/session.ts";

const generation = "a".repeat(64);
const hello = { kind: "hello" as const, generation, helperPid: 41, helperStartTime: "123",
  nativePid: 42, nativeStartTime: "124" };

test("Native exec remains held until independently authenticated dispatcher registration finishes", async () => {
  const written: string[] = [];
  let releaseRegistration: (() => void) | undefined;
  const registered = new Promise<void>(resolve => { releaseRegistration = resolve; });
  const session = new PrivateControlSession({ generation, now: () => 0,
    write: async bytes => { written.push(new TextDecoder().decode(bytes)); },
    registerHeldHelper: async () => registered, closeNativeAdmission: async () => {} });
  const admission = session.accept(hello);
  await Promise.resolve();
  expect(written).toEqual([]);
  releaseRegistration?.();
  await admission;
  expect(written).toEqual([`START ${generation}\n`]);
  expect(session.nativeIdentity).toEqual({ pid: 42, startTime: "124" });
});

test("the START fence preserves an already submitted control write", async () => {
  const submitted = Promise.withResolvers<string>();
  const flushed = Promise.withResolvers<void>();
  const session = new PrivateControlSession({ generation, now: () => 0,
    registerHeldHelper: async () => {}, closeNativeAdmission: async () => {},
    write: async bytes => {
      submitted.resolve(new TextDecoder().decode(bytes));
      await flushed.promise;
    },
  });
  const admission = session.accept(hello);
  const command = await submitted.promise;
  session.fenceStart();
  flushed.resolve();
  await admission;
  expect(command).toBe(`START ${generation}\n`);
  expect(session.nativeIdentity).toEqual({ pid: 42, startTime: "124" });
});

test("ordinary Stop and early Native exit never automatically force descendants", async () => {
  let now = 0;
  const written: string[] = [];
  const session = new PrivateControlSession({ generation, now: () => now,
    write: async bytes => { written.push(new TextDecoder().decode(bytes)); },
    registerHeldHelper: async () => {}, closeNativeAdmission: async () => { written.push("CLOSED"); } });
  await session.accept(hello);
  await session.ordinaryStop();
  await session.accept({ kind: "rootExit", generation, exitCode: 0, signal: 0 });
  now = 29_999;
  await expect(session.forceAfterUserConfirmation()).rejects.toMatchObject({ code: "FORCE_NOT_AVAILABLE" });
  now = 30_000;
  expect(session.forceAvailable).toBe(true);
  expect(session.helperReportedComplete).toBe(false);
  expect(written).toEqual([`START ${generation}\n`, `ORDINARY_STOP ${generation}\n`]);
  await session.forceAfterUserConfirmation();
  expect(written.slice(-2)).toEqual(["CLOSED", `FORCE ${generation}\n`]);
});

test("revocation during registration closes admission without releasing Native exec", async () => {
  const written: string[] = [];
  let releaseRegistration: (() => void) | undefined;
  const registered = new Promise<void>(resolve => { releaseRegistration = resolve; });
  const session = new PrivateControlSession({ generation, now: () => 0,
    write: async bytes => { written.push(new TextDecoder().decode(bytes)); },
    registerHeldHelper: async () => registered, closeNativeAdmission: async () => { written.push("CLOSED"); } });
  const admission = session.accept(hello);
  await session.mandatoryCleanup();
  releaseRegistration?.();
  await admission;
  expect(written).toEqual(["CLOSED", `MANDATORY ${generation}\n`]);
});

test("missing registration and root-only exit cannot become a cleanup receipt", async () => {
  const written: Uint8Array[] = [];
  const session = new PrivateControlSession({ generation, now: () => 0,
    write: async bytes => { written.push(bytes); }, registerHeldHelper: async () => { throw new Error("NO_KERNEL_PROOF"); },
    closeNativeAdmission: async () => {} });
  await expect(session.accept(hello)).rejects.toMatchObject({ code: "HELPER_REGISTRATION_FAILED", causeCode: "UNCLASSIFIED" });
  expect(written).toEqual([]);
  expect(session.nativeIdentity).toBeUndefined();
  await expect(session.accept({ kind: "complete", generation })).rejects.toMatchObject({ code: "CONTROL_SEQUENCE" });
});
