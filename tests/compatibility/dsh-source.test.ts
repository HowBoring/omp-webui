import { expect, test } from "bun:test";
import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyDshSource } from "../../scripts/dsh-source.ts";

const source = resolve(process.env.DSH_SOURCE ?? "vendor/dsh");

test("the declared complete source is accepted through the public DSH build gate", async () => {
  const identity = await verifyDshSource(source);
  expect(identity.baseCommit).toBe("38a6a5c965aa99ab525161efb7cc5cf1fe62fced");
  expect(["baseline", "candidate"]).toContain(identity.mode);
}, 30000);

test("an undeclared edit to a consumed DSH module blocks the build gate", async () => {
  const path = resolve(source, "packages/client/connection/src/client/index.ts");
  const original = await readFile(path);
  try {
    await writeFile(path, Buffer.concat([original, Buffer.from("\n// synthetic unrecorded source\n")]));
    await expect(verifyDshSource(source)).rejects.toThrow("DSH_AUTHORED_SOURCE_MISMATCH");
  } finally { await writeFile(path, original); }
}, 30000);

test("ignored startup environment files and undeclared untracked source cannot evade the gate", async () => {
  const env = resolve(source, ".env");
  const extra = resolve(source, "packages/client/ui-conversation/src/client/undeclared-ticket39.ts");
  await writeFile(env, "FIXTURE_UNTRUSTED_VALUE=synthetic\n", { flag: "wx" });
  let extraCreated = false;
  try {
    await expect(verifyDshSource(source)).rejects.toThrow("DSH_UNRECORDED_IGNORED_SOURCE");
    await rm(env);
    await writeFile(extra, "export const unrecorded = true;\n", { flag: "wx" });
    extraCreated = true;
    await expect(verifyDshSource(source)).rejects.toThrow("DSH_AUTHORED_SOURCE_MISMATCH");
  } finally { await Promise.all([rm(env, { force: true }), ...(extraCreated ? [rm(extra, { force: true })] : [])]); }
}, 30000);
