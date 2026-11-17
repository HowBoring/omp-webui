import { expect, test } from "bun:test";
import { assertOwnershipFfiDeferred, ownershipClientImports } from "../../scripts/ownership-import-gate";

test("client/worker rule rejects runtime FFI, server, public loader and nonliteral module imports", () => {
  for (const source of [
    'import { dlopen } from "bun:ffi";',
    'export * from "./server";',
    'import "./control-io-owner.ts";',
    'import { loadOwnedControlIo } from "@omp-webui/control-io";',
    'const module = await import(target);',
    'const module = require("./linux-bridge");',
  ]) expect(() => ownershipClientImports(source)).toThrow("OWNERSHIP_CLIENT_IMPORT_REFUSED");
  expect(ownershipClientImports('import type { LinuxOwnershipBridge } from "./linux-bridge";\n'
    + 'import { type OwnedControlIo } from "@omp-webui/control-io";\n'
    + 'import { connectProcessOwnershipClient } from "./bootstrap";'))
    .toEqual(["./bootstrap"]);
});

test("bundled dispatcher rejects hoisted FFI imports while allowing guarded dynamic loading", () => {
  expect(() => assertOwnershipFfiDeferred('import { dlopen } from "bun:ffi"; export async function open() {}'))
    .toThrow("OWNERSHIP_EAGER_FFI_IMPORT_REFUSED");
  expect(() => assertOwnershipFfiDeferred('const ffi = await import("bun:ffi");'))
    .toThrow("OWNERSHIP_EAGER_FFI_IMPORT_REFUSED");
  assertOwnershipFfiDeferred('export async function open() { const ffi = await import("bun:ffi"); }');
});
