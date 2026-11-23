import { describe, expect, test } from "bun:test";
import { workspaceUnary } from "../../apps/host/src/session-remote-dispatch.ts";

describe("stock Workspace admission", () => {
  test("admits the layout verbs and leaves the distinguished directory picker unserved", () => {
    expect(workspaceUnary.has("workspace/initializeDefault")).toBe(true);
    expect(workspaceUnary.has("workspace/create")).toBe(true);
    expect(workspaceUnary.has("workspace/follow")).toBe(false);
    expect(workspaceUnary.has("workspace/pickDirectory")).toBe(false);
    expect(workspaceUnary.has("directoryPicker/pick")).toBe(false);
  });
});
