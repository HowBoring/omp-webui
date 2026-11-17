import ts from "typescript";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

// Evidence tooling only. Parse selected sources; never evaluate them or invoke a builder/native module.
interface Selected {
  path: string;
  selectedSha256: string;
  sourceSha256: string;
  transformation: "none" | "historical notice";
}
interface Manifest {
  selected: Selected[];
  preserved: { path: string; sha256: string }[];
  pureSuites: string[];
}
const root = process.cwd();
const manifest: Manifest = JSON.parse(readFileSync("docs/evidence/ticket-41-external-composed-selection.json", "utf8"));
const digest = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
for (const item of manifest.selected) {
  const bytes = readFileSync(item.path);
  if (digest(bytes) !== item.selectedSha256) throw new Error(`Selected source changed: ${item.path}`);
  const original = item.transformation === "none" ? bytes : bytes.subarray(bytes.indexOf("\n\n") + 2);
  if (digest(original) !== item.sourceSha256) throw new Error(`Selected source provenance changed: ${item.path}`);
}
for (const item of manifest.preserved) {
  if (digest(readFileSync(item.path)) !== item.sha256) throw new Error(`Preserved dependency changed: ${item.path}`);
}
interface Edge { from: string; to: string; typeOnly: boolean; dynamic: boolean }
const edges: Edge[] = [];
const seen = new Set<string>();
function visit(path: string): void {
  if (seen.has(path) || !path.endsWith(".ts")) return;
  seen.add(path);
  const ast = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  function edge(spec: string, typeOnly: boolean, dynamic = false): void {
    const local = spec.startsWith(".");
    const target = local ? relative(root, resolve(dirname(path), spec)) : spec;
    if (local && !existsSync(target)) throw new Error(`Missing source ${path} -> ${target}`);
    edges.push({ from: path, to: target, typeOnly, dynamic });
    if (local) visit(target);
  }
  function walk(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
      const bindings = clause?.namedBindings;
      const typeOnly = (ts.isExportDeclaration(node) && node.isTypeOnly) || clause?.isTypeOnly === true
        || (!clause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0
          && bindings.elements.every(item => item.isTypeOnly));
      edge(node.moduleSpecifier.text, !!typeOnly);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) edge(node.arguments[0].text, false, true);
    ts.forEachChild(node, walk);
  }
  walk(ast);
}
for (const item of manifest.selected) visit(item.path);
for (const path of manifest.pureSuites) visit(path);
const runtime = new Set<string>();
function runtimeVisit(path: string): void {
  if (runtime.has(path)) return;
  runtime.add(path);
  for (const edge of edges.filter(item => item.from === path && !item.typeOnly && !item.dynamic)) {
    if (edge.to.endsWith(".ts")) runtimeVisit(edge.to);
    if (edge.to === "bun:ffi") throw new Error(`Pure tests statically import FFI: ${path}`);
  }
}
for (const path of manifest.pureSuites) runtimeVisit(path);
if (runtime.has("packages/delivery/maintenance.ts")) throw new Error("Pure tests reach maintenance FFI dependency");
if (edges.some(edge => edge.from.startsWith("packages/control-io/") && edge.to.startsWith("packages/")
  && !edge.to.startsWith("packages/control-io/"))) throw new Error("Public control-I/O reverse Host dependency");
const report = {
  format: "ticket-41-external-composed-static-closure-v1",
  method: "TypeScript 6.0.3 AST and SHA-256 only; selected sources never evaluated",
  files: [...seen].sort(), edges, pureStaticRuntime: [...runtime].sort(),
  limits: ["Dynamic imports require separate source path inspection; graph does not establish runtime unreachability",
    "Builder and build-refusal suite reach maintenance static FFI and are not executed",
    "C includes/configuration and maintenance semantics require the manifest and ADR manual source analysis",
    "No runtime, Native, artifact approval or admission proof"],
};
writeFileSync("docs/evidence/ticket-41-external-composed-static-closure.json", JSON.stringify(report, null, 2) + "\n");
console.log(`AST closure: ${seen.size} sources, ${edges.length} edges, ${runtime.size} pure runtime modules; hashes agree.`);
