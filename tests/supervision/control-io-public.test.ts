import { expect, test } from "bun:test";
import * as publicModule from "../../packages/control-io/index.ts";

test("public control I/O entry exposes the approved loader without authorizing test construction", () => {
  expect(Object.keys(publicModule).sort()).toEqual(["ControlIoError", "loadOwnedControlIo"]);
});
