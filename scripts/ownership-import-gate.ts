import * as ts from "typescript";

/** Structural build rule for the source-only public client/worker graph. Never executes a parsed module. */
export function ownershipClientImports(source: string): readonly string[] {
  const file = ts.createSourceFile("ownership-client.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports: string[] = [];
  const fail = (): never => { throw new Error("OWNERSHIP_CLIENT_IMPORT_REFUSED"); };
  const add = (node: ts.Expression | undefined): void => {
    if (!node || !ts.isStringLiteralLike(node)) return fail();
    const name = node.text, module = name.split("/").at(-1)?.replace(/\.[cm]?[jt]s$/, "");
    if (name === "bun:ffi" || name.startsWith("@omp-webui/control-io")
      || ["server", "linux-bridge", "linux-system", "entry", "control-io-owner", "control-io-generation"].includes(module ?? "")) fail();
    imports.push(name);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause, bindings = clause?.namedBindings;
      const onlyTypes = clause?.isTypeOnly || (clause && !clause.name && bindings && ts.isNamedImports(bindings)
        && bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly));
      if (!onlyTypes) add(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const onlyTypes = node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause)
        && node.exportClause.elements.length > 0 && node.exportClause.elements.every(element => element.isTypeOnly));
      if (!onlyTypes) add(node.moduleSpecifier);
    } else if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(file); return imports;
}

/** Bun may hoist external static imports while bundling a deferred local module. Inspect emitted ESM, never run it. */
export function assertOwnershipFfiDeferred(source: string): void {
  const file = ts.createSourceFile("dispatcher.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const fail = (): never => { throw new Error("OWNERSHIP_EAGER_FFI_IMPORT_REFUSED"); };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
      && ts.isStringLiteralLike(node.moduleSpecifier) && node.moduleSpecifier.text === "bun:ffi") fail();
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      const target = node.arguments[0];
      if (target && ts.isStringLiteralLike(target) && target.text === "bun:ffi") fail();
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}
