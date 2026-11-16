/** Authored preparation source check against actual pinned native types; unrelated upstream files are excluded. */
import ts from "typescript";
import * as path from "node:path";
const root = path.resolve("vendor/omp/packages/coding-agent");
const files = ["src/attachments/limits.ts", "src/attachments/input-policy.ts", "src/slash-commands/acp-builtins.ts", "src/attachments/prepare.ts", "src/attachments/document.ts", "src/attachments/package.ts",
  "src/attachments/isolated.ts", "src/attachments/worker.ts", "src/attachments/deny-network.ts", "src/attachments/receipts.ts", "src/attachments/rpc-budget.ts",
  "src/modes/rpc/rpc-attachments.ts", "src/modes/rpc/attachment-client.ts", "src/modes/rpc/wire/attachments.ts",
  "src/modes/rpc/rpc-input.ts", "src/modes/rpc/rpc-input-policy.ts",
  "src/attachments/validation.ts", "src/attachments/entry-parts.ts", "src/session/submission-provenance.ts", "src/session/submission-records.ts",
  "src/attachments/provider-guard.ts", "src/extensibility/extensions/runner.ts",
  "src/session/messages.ts",
  "src/attachments/model-binding.ts", "src/sdk.ts",
  "src/session/session-manager.ts", "src/session/session-required-features.ts", "src/modes/rpc/rpc-submissions.ts",
  "src/modes/rpc/rpc-mode.ts", "src/modes/rpc/rpc-types.ts", "src/markit/types.ts",
  "src/markit/converters/pdf/index.ts", "src/markit/converters/docx.ts", "src/markit/converters/pptx.ts", "src/markit/converters/xlsx.ts", "src/markit/converters/epub.ts",
  "scripts/gen-rpc/model.ts", "scripts/gen-rpc/python.ts", "../utils/src/image-animation.ts", "../utils/src/stream.ts"]
  .map(file => path.resolve(root, file));
const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(files, { ...parsed.options, allowJs: true, checkJs: false });
const diagnostics = files.flatMap(file => {
  const source = program.getSourceFile(file);
  if (!source) throw new Error("ATTACHMENT_NATIVE_SOURCE_MISSING");
  return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)];
});
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => process.cwd(), getCanonicalFileName: name => name, getNewLine: () => "\n",
  })); process.exitCode = 1;
} else console.info("Authored native attachment modules: strict TypeScript PASS (unrelated upstream diagnostics excluded)");
