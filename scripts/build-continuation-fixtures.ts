/** Owned Linux native syscall fixture only. Never installed or admitted as a product runtime dependency. */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
await mkdir("vendor/strict-fixture", { recursive: true });
const result = Bun.spawnSync(["gcc", "-shared", "-fPIC", "-Wall", "-Wextra", "-Werror",
  "tests/continuation/native-faults.c", "-ldl", "-o", "vendor/strict-fixture/native-faults.so"],
  { stdout: "inherit", stderr: "inherit" });
if (result.exitCode !== 0) throw new Error("STRICT_FIXTURE_NATIVE_BUILD_FAILED");
console.info(JSON.stringify({ kind: "isolated-strict-syscall-fixture", platform: process.platform, arch: process.arch,
  source: Bun.SHA256.hash(await Bun.file("tests/continuation/native-faults.c").bytes(), "hex"),
  artifact: Bun.SHA256.hash(await Bun.file(resolve("vendor/strict-fixture/native-faults.so")).bytes(), "hex") }));
