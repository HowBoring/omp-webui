/** Focused authored strict-continuation check; unrelated upstream diagnostics are not reported as passing. */
import ts from "typescript";
import { resolve } from "node:path";
const root = resolve("vendor/omp/packages/coding-agent/src");
const files = ["modes/rpc/strict-context.ts", "modes/rpc/strict-reservation.ts", "modes/rpc/strict-mode.ts",
  "session/strict-session-storage.ts"].map(file => resolve(root, file));
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const program = ts.createProgram(files, { ...parsed.options, allowJs: true, checkJs: false });
const diagnostics = files.flatMap(file => {
  const source = program.getSourceFile(file);
  if (!source) throw new Error("NATIVE_STRICT_SOURCE_MISSING");
  return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)];
});
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => process.cwd(), getCanonicalFileName: name => name, getNewLine: () => "\n",
  })); process.exitCode = 1;
} else console.info("Authored native strict-continuation modules: strict TypeScript PASS (unrelated upstream diagnostics excluded)");
