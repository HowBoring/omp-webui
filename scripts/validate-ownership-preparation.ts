import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Ajv from "ajv";

/** Explicit source-only public Native module/schema check. It never imports the CLI, Session or provider graph. */
const source = process.argv[2];
if (!source || process.argv.length !== 3) throw new Error("USAGE: validate-ownership-preparation.ts <owned-native-source>");
const modulePath = resolve(source, "packages/coding-agent/src/launch/ownership");
const { decodeOwnershipRequest } = await import(pathToFileURL(resolve(modulePath, "protocol.ts")).href);
const schema: unknown = await Bun.file(resolve(modulePath, "wire.schema.json")).json();
const ajv = new Ajv({ allErrors: true, strict: true });
if (typeof schema !== "object" || schema === null || Array.isArray(schema)) throw new Error("OWNERSHIP_SCHEMA_OBJECT");
ajv.addSchema(schema, "ownership");
const validate = ajv.compile({ $ref: "ownership#/definitions/request" });
const validateResponse = ajv.compile({ $ref: "ownership#/definitions/response" });
const base = { version: "omp-execution-ownership/1", id: "request-00000001",
  identity: { closure: "a".repeat(64), schema: "b".repeat(64) } };
const cases: { operation: unknown; expected: boolean }[] = [
  { operation: { op: "classify" }, expected: true },
  { operation: { op: "broker", scope: { kind: "project", directory: "/work/project" } }, expected: true },
  { operation: { op: "publish", scope: { kind: "global", service: "text-predict" },
    generation: "generation-00001" }, expected: true },
  { operation: { op: "classify", pid: 42 }, expected: false },
  { operation: { op: "broker", scope: { kind: "project", directory: "/work/../elsewhere" } }, expected: false },
  { operation: { op: "broker", scope: { kind: "project", directory: "/work//project" } }, expected: false },
  { operation: { op: "broker", scope: { kind: "global", service: "arbitrary-executable" } }, expected: false },
  { operation: { op: "broker", scope: { kind: "project", directory: "/work" }, argv: ["sh"] }, expected: false },
];
for (const [index, item] of cases.entries()) {
  const value = { ...base, operation: item.operation };
  let decoded = true;
  try { decodeOwnershipRequest(JSON.stringify(value)); } catch { decoded = false; }
  if (Boolean(validate(value)) !== item.expected || decoded !== item.expected) throw new Error(`OWNERSHIP_SCHEMA_CASE_${index}`);
}
const success = { version: base.version, id: base.id, ok: true, identity: base.identity,
  result: { op: "broker", scope: { kind: "project", directory: "/work" }, generation: "generation-00001",
    runtimeDirectory: "/run/native", token: "d".repeat(64) } };
const responseCases = [
  { value: success, expected: true },
  { value: { version: base.version, id: base.id, ok: false, error: "maintenance_fenced" }, expected: true },
  { value: { ...success, executable: "/bin/sh" }, expected: false },
  { value: { ...success, result: { ...success.result, token: "not-a-token" } }, expected: false },
  { value: { ...success, result: { ...success.result, runtimeDirectory: "/run/../elsewhere" } }, expected: false },
  { value: { version: base.version, id: base.id, ok: false, error: "unknown-success-fallback" }, expected: false },
];
for (const [index, item] of responseCases.entries()) {
  if (Boolean(validateResponse(item.value)) !== item.expected) throw new Error(`OWNERSHIP_RESPONSE_SCHEMA_CASE_${index}`);
}
process.stdout.write(JSON.stringify({ scope: "source-only-public-module-schema", requestCases: cases.length,
  responseCases: responseCases.length, passed: cases.length + responseCases.length,
  kernel: "NOT RUN", nativeRuntime: "NOT RUN", actualGlobal: "BLOCKED" }) + "\n");
