import { expect, test } from "bun:test";
import { readRpcInputFrames } from "../../../vendor/omp/packages/coding-agent/src/modes/rpc/rpc-input";

const stream = bytes => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });

test("native stdin rejects invalid UTF-8 instead of dispatching replacement text", async () => {
  const bytes = Buffer.concat([Buffer.from('{"type":"prompt","message":"'), Buffer.from([255]), Buffer.from('"}\n')]);
  const frames = [], errors = [];
  await readRpcInputFrames(stream(bytes), frame => frames.push(frame), error => errors.push(error));
  expect(frames).toEqual([]);
  expect(errors).toEqual(["RPC_INPUT_INVALID_UTF8"]);
});

test("partial stdin EOF never admits an otherwise valid unterminated command", async () => {
  const frames = [], errors = [];
  await readRpcInputFrames(stream(Buffer.from('{"type":"abort"}')), frame => frames.push(frame), error => errors.push(error));
  expect(frames).toEqual([]);
  expect(errors).toEqual(["RPC_INPUT_PARTIAL_EOF"]);
});
