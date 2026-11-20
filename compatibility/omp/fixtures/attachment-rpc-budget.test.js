import { expect, test } from "bun:test";
import { measureAttachmentRpc, measureAttachmentOutput } from "../../../vendor/omp/packages/coding-agent/src/attachments/rpc-budget";

test("RPC accounting includes UTF-8, JSON escapes, command metadata and newline", () => {
  expect(measureAttachmentRpc({ type: "attachment_cancel", id: "a", preparationId: '界\n"' }))
    .toEqual({ logicalBytes: 64, wireBytes: 64, frames: 1 });
});

test("stdout aggregate budget refuses chunk overhead even when logical response JSON fits", () => {
  const frame = { type: "response", data: "A".repeat(9 * 1024 * 1024 - 128) };
  expect(() => measureAttachmentOutput(frame)).toThrow("ATTACHMENT_RPC_WIRE_BUDGET");
});
