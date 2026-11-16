import { expect, test } from "bun:test";
import { RpcFrameEncoder } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame";
import { PhysicalFrames } from "../../packages/compatibility/framing.ts";

test("public OMP decoder reassembles chunked UTF-8 frames across arbitrary byte boundaries", () => {
  const encoder = new RpcFrameEncoder();
  encoder.setProtocolVersion(2);
  const value = { type: "response", id: "a", command: "x", success: true, data: "汉".repeat(400_000) };
  const bytes = new TextEncoder().encode(encoder.encode(value));
  const carrier = new PhysicalFrames(2);
  const frames: object[] = [];
  for (let offset = 0; offset < bytes.length; offset += 1337) {
    frames.push(...carrier.push(bytes.subarray(offset, offset + 1337)));
  }
  carrier.finish();
  expect(frames).toEqual([value]);
});
