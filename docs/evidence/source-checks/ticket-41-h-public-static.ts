import ts from 'typescript';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
const root=process.cwd();
const manifest: { selected: { path: string; selectedSha256: string }[] } = JSON.parse(readFileSync('docs/evidence/ticket-41-h-public-source-selection.json','utf8'));
for (const item of manifest.selected) {
 if (createHash('sha256').update(readFileSync(item.path)).digest('hex') !== item.selectedSha256) {
  throw new Error(`Selected source changed: ${item.path}`);
 }
}
const selected=new Set<string>(manifest.selected.map(v=>v.path));
const edges: {from: string; to: string; typeOnly: boolean; dynamic: boolean; selected: boolean}[]=[];
const seen=new Set<string>();
function visit(path:string) {
 if(seen.has(path)||!path.endsWith('.ts'))return; seen.add(path);
 const ast=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);
 function edge(spec:string,typeOnly:boolean,dynamic=false) {
  const local=spec.startsWith('.');
  const target=local?relative(root,resolve(dirname(path),spec)):spec;
  if(local&&!existsSync(target))throw new Error(`Missing source ${path} -> ${target}`);
  edges.push({from:path,to:target,typeOnly,dynamic,selected:selected.has(target)});
  if(local)visit(target);
 }
 function walk(n: ts.Node) {
  if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier)) {
   const clause=ts.isImportDeclaration(n)?n.importClause:undefined; const bindings=clause?.namedBindings;
   const types=(ts.isExportDeclaration(n)&&n.isTypeOnly)||clause?.isTypeOnly===true||(!clause?.name&&bindings&&ts.isNamedImports(bindings)&&bindings.elements.length>0&&bindings.elements.every(x=>x.isTypeOnly));
   edge(n.moduleSpecifier.text,!!types);
  }
  if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword&&n.arguments[0] && ts.isStringLiteral(n.arguments[0]))edge(n.arguments[0].text,false,true);
  ts.forEachChild(n,walk);
 }
 walk(ast);
}
for(const p of selected)visit(p);
const publicPaths=[...seen].filter(x=>x.startsWith('packages/control-io/'));
if(edges.some(x=>publicPaths.includes(x.from)&&x.to.startsWith('packages/')&&!x.to.startsWith('packages/control-io/')))throw new Error('reverse public Host dependency');
const runtime=new Set<string>();
function runtimeVisit(path:string){if(runtime.has(path))return;runtime.add(path);for(const e of edges.filter(x=>x.from===path&&!x.typeOnly&&!x.dynamic&&x.to.endsWith('.ts')))runtimeVisit(e.to);}
for(const p of selected)if(p.startsWith('tests/supervision/'))runtimeVisit(p);
if(runtime.has('packages/delivery/maintenance.ts'))throw new Error('pure tests reach maintenance FFI import');
if(edges.some(x=>runtime.has(x.from)&&x.to==='bun:ffi'&&!x.dynamic))throw new Error('pure test static FFI import');
const report={format:'ticket-41-static-source-closure-v1',method:'TypeScript 6.0.3 AST only; no selected source evaluated',files:[...seen].sort(),edges,pureTestStaticRuntime:[...runtime].sort(),limits:['dynamic import presence does not prove a runtime call is unreachable','typechecking and pure tests do not prove native/load/process semantics','builder inputs and C includes/configuration also require the manual manifest dependency notes']};
writeFileSync('docs/evidence/ticket-41-h-public-static-closure.json',JSON.stringify(report,null,2)+'\n');
console.log(`AST closure: ${seen.size} TS sources, ${edges.length} imports/exports, ${runtime.size} pure-test static runtime modules; no static FFI or maintenance reachability.`);
