/** Only the native public RpcClient test owns this raw process's stdin/stdout. Not imported by the Host. */
import type { Subprocess } from "bun";
export function observeClientProcess(child:Subprocess<"pipe","pipe","pipe">) {
  let stderrBytes=0;let networkDenials=0;
  const stderr=(async()=>{
    let tail="";const decoder=new TextDecoder();
    for await(const bytes of child.stderr) {
      stderrBytes+=bytes.length;if(stderrBytes>65536)throw new Error("RPC_STDERR_LIMIT");
      tail+=decoder.decode(bytes,{stream:true});const lines=tail.split("\n");tail=lines.pop() ?? "";
      networkDenials+=lines.filter(line=>/^S0_FIXTURE_NETWORK_DENIED:[a-zA-Z0-9.]+$/.test(line)).length;
    }
  })();
  void stderr.catch(()=>child.kill("SIGTERM"));
  return {child,async close(){
    child.stdin.end();let forced=false;
    const term=setTimeout(()=>{forced=true;child.kill("SIGTERM");},3000);
    const kill=setTimeout(()=>{forced=true;child.kill("SIGKILL");},3500);
    try {const code=await child.exited;await stderr;return {code,forced,stderrBytes,networkDenials};}
    finally{clearTimeout(term);clearTimeout(kill);}
  }};
}
