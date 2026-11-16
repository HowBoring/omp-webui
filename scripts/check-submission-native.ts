/** Authored native submission sources, resolved against actual upstream types.
 * Unrelated upstream files are outside this check and are not reported as passing. */
import ts from "typescript";
import { resolve } from "node:path";
const root=resolve("vendor/omp/packages/coding-agent/src");
const files=["session/submission-provenance.ts", "session/session-required-features.ts", "session/session-manager.ts", "session/agent-session.ts", "session/session-entries.ts", "session/session-generation.ts", "session/session-loader.ts", "modes/rpc/rpc-submissions.ts", "modes/rpc/submission-client.ts", "modes/rpc/rpc-mode.ts", "modes/rpc/rpc-types.ts", "modes/rpc/wire/submissions.ts"].map(file=>resolve(root,file));
const configFile=resolve("vendor/omp/packages/coding-agent/tsconfig.json");
const config=ts.readConfigFile(configFile,ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,resolve("vendor/omp/packages/coding-agent"));
const program=ts.createProgram(files,{...parsed.options,allowJs:true,checkJs:false});
const diagnostics=files.flatMap(file=>{
  const source=program.getSourceFile(file);if(!source)throw new Error("NATIVE_LIVE_SOURCE_MISSING");
  return [...program.getSyntacticDiagnostics(source),...program.getSemanticDiagnostics(source)];
});
if(diagnostics.length){
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{
    getCurrentDirectory:()=>process.cwd(),getCanonicalFileName:name=>name,getNewLine:()=>"\n"}));
  process.exitCode=1;
}else console.info("Authored native submission modules: strict TypeScript PASS (unrelated upstream diagnostics excluded)");
