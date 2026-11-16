import { expect, test } from "bun:test";
import { readFile, writeFile, rm } from "node:fs/promises";
import { verifySource } from "../../scripts/omp-source.ts";
import { resolve } from "node:path";

const upstream = resolve("vendor/omp");

test("a consumed public decoder changed outside the recorded patch blocks the candidate build", async () => {
  const path = resolve(upstream, "packages/coding-agent/src/modes/rpc/rpc-frame.ts");
  const original = await readFile(path);
  try {
    await writeFile(path, Buffer.concat([original, Buffer.from("\n// unrecorded-source-fixture\n")]));
    await expect(verifySource(upstream)).rejects.toThrow("OMP_UNRECORDED_SOURCE_CHANGE");
  } finally { await writeFile(path, original); }
});

test("even an ignored extra startup environment file is rejected before importing generators", async () => {
  const path = resolve(upstream, ".env.s0-untrusted");
  try {
    await writeFile(path, "S0_SYNTHETIC_VALUE=untrusted\n");
    await expect(verifySource(upstream)).rejects.toThrow("OMP_UNRECORDED_SOURCE_FILE");
  } finally { await rm(path, { force: true }); }
});
