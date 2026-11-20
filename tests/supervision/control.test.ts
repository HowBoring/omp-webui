import { expect, test } from "bun:test";
import { ControlDecoder, encodeControlCommand } from "../../packages/supervision/control.ts";

const generation = "a".repeat(64);
test("trusted control keeps actual Native identity distinct and handles split frames", () => {
  const decoder = new ControlDecoder(generation);
  expect(decoder.push(new TextEncoder().encode(`HELLO ${generation} 41 123 42`))).toEqual([]);
  expect(decoder.push(new TextEncoder().encode(" 124\n"))).toEqual([
    { kind: "hello", generation, helperPid: 41, helperStartTime: "123", nativePid: 42, nativeStartTime: "124" },
  ]);
});

test("control rejects stale generations, forged identity, oversized and non-ASCII frames", () => {
  for (const frame of [
    `COMPLETE ${"b".repeat(64)}\n`, `HELLO ${generation} 41 123 41 123\n`,
    `COMPLETE ${generation} extra\n`, `ROOT_EXIT ${generation} 0 65\n`,
    `STATE ${generation} running\r\n`, "x".repeat(512), "\u0080",
  ]) {
    expect(() => new ControlDecoder(generation).push(new TextEncoder().encode(frame))).toThrow();
  }
  expect(new TextDecoder().decode(encodeControlCommand("START", generation))).toBe(`START ${generation}\n`);
});

test("control rejects truncation and poisoned-stream recovery", () => {
  const decoder = new ControlDecoder(generation);
  decoder.push(new TextEncoder().encode(`COMPLETE ${generation}`));
  expect(() => decoder.finish()).toThrow();
  const poisoned = new ControlDecoder(generation);
  expect(() => poisoned.push(new Uint8Array([0]))).toThrow();
  expect(() => poisoned.push(new TextEncoder().encode(`COMPLETE ${generation}\n`))).toThrow();
});
