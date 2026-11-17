import { expect, test } from "bun:test";
import { helperDrainFailure } from "../../compatibility/omp/fixtures/native-helper-drain-diagnostics";

test("public OwnershipError codes survive without exposing arbitrary error payloads", () => {
  for (const code of ["ownership_protocol", "ownership_limit", "dispatcher_unavailable", "dispatcher_mismatch",
    "ownership_unresolved", "maintenance_fenced", "shared_service_unsupported", "ownership_backend_unavailable"]) {
    const error = Object.assign(new Error("SECRET message"), { code, payload: "SECRET payload" });
    expect(helperDrainFailure(error, "native_server_open")).toEqual({ code, codeSource: "public_code",
      phase: "native_server_open" });
  }
  expect(helperDrainFailure(new Error("DRAIN_NATIVE_ARGUMENTS"), "native_approval")).toEqual({
    code: "DRAIN_NATIVE_ARGUMENTS", codeSource: "fixture_message", phase: "native_approval" });
});

test("unknown codes, inherited properties, getters, proxies and messages stay scrubbed", () => {
  let getterReads = 0;
  const getter = Object.defineProperty(new Error("SECRET_PAYLOAD"), "code", {
    get() { getterReads++; throw new Error("SECRET getter"); } });
  const inherited = Object.create({ code: "ownership_unresolved", message: "DRAIN_NATIVE_ARGUMENTS" });
  const errors: unknown[] = [getter, inherited, { code: "SECRET_CODE", message: "SECRET_PAYLOAD" },
    { code: "ownership_unresolved\nSECRET", message: "SECRET text" },
    Object.defineProperty({}, "message", { get() { getterReads++; return "DRAIN_NATIVE_ARGUMENTS"; } }),
    new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("SECRET proxy"); } }), "ownership_unresolved"];
  for (const error of errors) expect(helperDrainFailure(error, "native_server_open")).toEqual({
    code: "DRAIN_UNRESOLVED", codeSource: "unrecognized", phase: "native_server_open" });
  expect(getterReads).toBe(0);
});

test("untrusted phase values cannot become diagnostic payloads", () => {
  const unknownPhase = { payload: "SECRET phase" };
  expect(helperDrainFailure({ code: "ownership_unresolved" }, unknownPhase)).toEqual({
    code: "ownership_unresolved", codeSource: "public_code", phase: "unrecognized" });
});
