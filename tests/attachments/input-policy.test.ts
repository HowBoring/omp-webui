import { expect, test } from "bun:test";
import { acceptsAttachmentInputPolicy } from "../../packages/compatibility/attachment-transport.ts";
const ready = { type: "ready" as const, rpcInputPolicy: { version: "bounded-jsonl-input-v1" as const,
  encoding: "fatal-utf8" as const, framing: "unchunked-jsonl" as const, malformed: "sanitized-drop-line" as const,
  partialEof: "reject" as const, maxLineBytes: 48 * 1024 * 1024, maxPendingBytes: 64 * 1024 * 1024,
  maxPendingFrames: 32, maxStartupBytes: 48 * 1024 * 1024, maxStartupFrames: 8 } };
test("larger outbound commands require an explicit bounded native stdin policy", () => {
  expect(acceptsAttachmentInputPolicy({ type: "ready" })).toBe(false);
  expect(acceptsAttachmentInputPolicy(ready)).toBe(true);
  expect(acceptsAttachmentInputPolicy({ ...ready, rpcInputPolicy: { ...ready.rpcInputPolicy, maxPendingBytes: 1024 * 1024 * 1024 } })).toBe(false);
  expect(acceptsAttachmentInputPolicy({ ...ready, rpcInputPolicy: { ...ready.rpcInputPolicy, maxStartupFrames: 0 } })).toBe(false);
});
