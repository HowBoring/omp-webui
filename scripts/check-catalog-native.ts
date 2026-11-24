/** Type-check the authored native catalog modules using actual transitive upstream types.
 * OMP's unrelated sources are outside this narrow check, not reported as passing. */
import ts from "typescript";
import {resolve} from "node:path";
const root=resolve("vendor/omp/packages/coding-agent/src/modes/rpc");
const files=["catalog-client.ts","catalog-metadata.ts","catalog-path.ts","catalog-native.ts","catalog-mode.ts"]
  .map(file=>resolve(root,file));
const config=ts.readConfigFile("tsconfig.json",ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,process.cwd());
const program=ts.createProgram(files,{...parsed.options,allowJs:true,checkJs:false});
const diagnostics=files.flatMap(file=>{
  const source=program.getSourceFile(file);
  if(!source)throw new Error("NATIVE_CATALOG_SOURCE_MISSING");
  return [...program.getSyntacticDiagnostics(source),...program.getSemanticDiagnostics(source)];
});
if(diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{
    getCurrentDirectory:()=>process.cwd(),getCanonicalFileName:name=>name,getNewLine:()=>"\n"}));
  process.exitCode=1;
} else console.info("Authored native catalog modules: strict TypeScript PASS (upstream unrelated diagnostics excluded)");
