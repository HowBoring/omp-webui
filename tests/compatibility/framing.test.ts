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

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value) + "\n");
const chunk = { type: "rpc_chunk", chunkId: "fixture", index: 0, count: 2, byteLength: 1048576, data: "YQ==" };

test("physical byte ceiling includes newline and rejects a line before unbounded buffering", () => {
  const prefix = '{"x":"';
  const suffix = '"}\n';
  const exact = new TextEncoder().encode(prefix + "a".repeat(1048576 - prefix.length - suffix.length) + suffix);
  const frames = new PhysicalFrames();
  expect(frames.push(exact)).toHaveLength(1);
  expect(() => new PhysicalFrames().push(new Uint8Array(1048577).fill(32))).toThrow("RPC_PHYSICAL_LIMIT");
});

test("invalid physical UTF-8 and partial JSON EOF are explicit protocol failures", () => {
  expect(() => new PhysicalFrames().push(new Uint8Array([255, 10]))).toThrow();
  const frames = new PhysicalFrames();
  frames.push(new TextEncoder().encode('{"type":'));
  expect(() => frames.finish()).toThrow("RPC_PARTIAL_EOF");
});

test("chunked frames are refused until public v2 negotiation completes", () => {
  expect(() => new PhysicalFrames().push(encode(chunk))).toThrow("RPC_CHUNK_BEFORE_NEGOTIATION");
});

for (const [name, changes] of [
  ["logical byte ceiling", { byteLength: 67108865 }],
  ["count ceiling", { count: 257 }],
  ["nonintegral metadata", { index: 0.5 }],
  ["sequence must begin at zero", { index: 1 }],
  ["canonical base64", { data: "YQ=garbage" }],
] satisfies [string, Record<string, unknown>][]) {
  test(`public OMP decoder rejects ${name}`, () => {
    expect(() => new PhysicalFrames(2).push(encode({ ...chunk, ...changes }))).toThrow();
  });
}

test("chunk interleaving and incomplete chunk EOF are never silently ignored", () => {
  const frames = new PhysicalFrames(2);
  frames.push(encode(chunk));
  expect(() => frames.push(encode({ type: "ready" }))).toThrow("rpc chunk sequence interrupted");
  expect(() => frames.finish()).toThrow("RPC_PARTIAL_EOF");
});

test("chunk metadata remains bound to one ordered logical frame", () => {
  const frames = new PhysicalFrames(2);
  frames.push(encode(chunk));
  expect(() => frames.push(encode({ ...chunk, index: 1, chunkId: "other" }))).toThrow("rpc chunk sequence mismatch");
});

test("public decoder refuses declared length mismatches after the final chunk", () => {
  const frames = new PhysicalFrames(2);
  frames.push(encode(chunk));
  expect(() => frames.push(encode({ ...chunk, index: 1 }))).toThrow("rpc chunk sequence length mismatch");
});

test("logical UTF-8 is validated after public chunk reassembly", () => {
  const frames = new PhysicalFrames(2);
  const data = Buffer.alloc(262144, 255).toString("base64");
  for (let index = 0; index < 3; index++) frames.push(encode({ ...chunk, index, count: 4, data }));
  expect(() => frames.push(encode({ ...chunk, index: 3, count: 4, data }))).toThrow();
});
