/** Authored native live/history sources, resolved against actual upstream types.
 * Unrelated upstream files are outside this check and are not reported as passing. */
import ts from "typescript";
import { resolve } from "node:path";
const root=resolve("vendor/omp/packages/coding-agent/src");
const files=["session/history-context.ts","session/live-message-observation.ts","session/agent-session.ts","session/session-manager.ts",
  "modes/rpc/rpc-history.ts","modes/rpc/history-client.ts","modes/rpc/rpc-session-events.ts","modes/rpc/wire/history.ts"].map(file=>resolve(root,file));
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
}else console.info("Authored native live/history modules: strict TypeScript PASS (unrelated upstream diagnostics excluded)");
