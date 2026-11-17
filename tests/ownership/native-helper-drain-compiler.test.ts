import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Isolate the compiler/receipt boundary without evaluating the producer's top-level stage actions.
const file = readFileSync(new URL("../../scripts/prepare-native-helper-drain.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("producer.ts", file, ts.ScriptTarget.Latest, true);
const compile = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "compile");
if (!compile) throw new Error("COMPILER_BOUNDARY_MISSING");
const code = ts.transpileModule(compile.getText(parsed), {
  compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.None },
}).outputText;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function runCompiler(exitCode: number) {
  const receipts: { file: string; value: Record<string, unknown> }[] = [];
  const inputs = new Map<string, string>();
  const boundary = runInNewContext(code + "; compile", {
    Buffer, Error, sourcePlan: {}, inputs, sha256: digest,
    fs: { lstat: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
      realpath: async (name: string) => name },
    assertHelperDrainSourceInput: async () => undefined,
    pin: async (name: string) => { if (name === "/source.c") inputs.set(name, "a".repeat(64)); },
    write: async (name: string, bytes: string) => receipts.push({ file: name, value: JSON.parse(bytes) }),
    Bun: { spawnSync: (_argv: string[], options: { maxBuffer?: number }) => {
      expect(options.maxBuffer).toBe(1048576);
      return { exitCode, success: exitCode === 0, signalCode: null, pid: 42, resourceUsage: { maxRSS: 9 },
        stdout: Buffer.from("literal stdout\u0000\ufffd"), stderr: Buffer.from("literal stderr\n") };
    } },
  }) as (source: string, output: string) => Promise<void>;
  try { await boundary("/source.c", "/output"); }
  catch (error) { return { receipts, error }; }
  return { receipts, error: undefined };
}

test("failed compiler result is retained before the stable build failure reaches the caller", async () => {
  const { receipts, error } = await runCompiler(7);
  expect((error as Error).message).toBe("DRAIN_C_BUILD_FAILED");
  expect(receipts).toHaveLength(1);
  const receipt = receipts[0]!;
  expect(receipt.file).toBe("/output.build.json");
  expect(receipt.value).toMatchObject({ status: "FAILED_NEVER_LOADED_OR_EXECUTED", source: "a".repeat(64),
    exitCode: 7, signalCode: null, success: false, captureLimitBytes: 1048576, sourcePath: "/source.c",
    pid: 42, resourceUsage: { maxRSS: 9 }, exitedDueToTimeout: false, exitedDueToMaxBuffer: false,
    argv: ["/usr/bin/gcc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2", "/source.c", "-o", "/output"] });
  for (const [name, literal] of [["stdout", "literal stdout\u0000\ufffd"], ["stderr", "literal stderr\n"]] as const) {
    expect(receipt.value[name]).toEqual({ encoding: "base64", bytes: Buffer.byteLength(literal),
      data: Buffer.from(literal).toString("base64"), sha256: digest(Buffer.from(literal)) });
  }
});

test("successful compiler keeps the existing success receipt contract", async () => {
  const { receipts, error } = await runCompiler(0);
  expect(error).toBeUndefined();
  expect(receipts[0]?.value).toEqual({ argv: ["/usr/bin/gcc", "-std=c11", "-Wall", "-Wextra", "-Werror",
    "-O2", "/source.c", "-o", "/output"], source: "a".repeat(64), diagnostics: "literal stderr\n",
    status: "COMPILED_NEVER_LOADED_OR_EXECUTED" });
});
