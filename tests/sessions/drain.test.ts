import { expect, test } from "bun:test";
import { BoundedStdioTransport } from "../../packages/compatibility/stdio-transport.ts";
import { resolve } from "node:path";

test("owned noncooperative process is terminated then forced within the selected drain policy", async () => {
  const transport = await BoundedStdioTransport.open({ argv: [process.execPath, resolve("tests/sessions/stubborn-peer.ts")],
    env: { PATH: process.env.PATH ?? "" }, timeoutMs: 1000 }, {
    validateCommand: () => true, acceptReady: () => true, remoteError: () => "RPC_REMOTE_REJECTED",
    physicalFrameBytes: 262144, allowChunks: false, commandBytes: 16384,
  });
  const start = performance.now();
  const result = await transport.close({ cooperativeMs: 80, terminationGraceMs: 60, readerGraceMs: 100 });
  expect(performance.now() - start).toBeGreaterThanOrEqual(130);
  expect(result).toMatchObject({ forced: true, terminationSent: true, forceSent: true, stdoutEOF: true, stderrEOF: true });
  expect(await transport.exited).not.toBe(0);
});
