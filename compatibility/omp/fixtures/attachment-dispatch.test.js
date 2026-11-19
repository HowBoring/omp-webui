import { expect, test } from "bun:test";
import { RpcInputDispatcher } from "../../../vendor/omp/packages/coding-agent/src/modes/rpc/rpc-mode";

test("native dispatcher refuses excess retained commands before their handlers can run", async () => {
  const release = Promise.withResolvers();
  const frames = [], handled = [];
  const dispatcher = new RpcInputDispatcher({ deps: {
    async handleCommand(command) {
      handled.push(command.id); await release.promise;
      return { type: "response", id: command.id, command: command.type, success: true };
    },
    output: frame => frames.push(frame), errorResponse: (id, command, message, code) => ({
      type: "response", id, command, success: false, error: message, code,
    }), pendingExtensionRequests: new Map(), onHostToolResult() {}, onHostToolUpdate() {}, onHostUriResult() {},
  } });
  for (let i = 0; i < 33; i++) dispatcher.dispatch({ id: `queued-${i}`, type: "get_state" });
  await Promise.resolve();
  expect(frames).toContainEqual(expect.objectContaining({ id: "queued-32", success: false, error: "RPC_INPUT_QUEUE_LIMIT" }));
  release.resolve(); await dispatcher.drain();
  expect(handled).toHaveLength(32);
  expect(handled).not.toContain("queued-32");
});
