import { rm } from "node:fs/promises";
import { prepareNativeInteractionFixture } from "./worker.ts";
/** Only the native public RpcClient test owns this raw process's stdin/stdout. Not imported by the Host. */
import type { Subprocess } from "bun";
export function observeClientProcess(child:Subprocess<"pipe","pipe","pipe">) {
  let stderrBytes=0;let networkDenials=0;let stderrText="";
  const stderr=(async()=>{
    let tail="";const decoder=new TextDecoder();
    for await(const bytes of child.stderr) {
      stderrBytes+=bytes.length;if(stderrBytes>65536)throw new Error("RPC_STDERR_LIMIT");
      const decoded=decoder.decode(bytes,{stream:true});stderrText+=decoded;
      tail+=decoded;const lines=tail.split("\n");tail=lines.pop() ?? "";
      networkDenials+=lines.filter(line=>/^S0_FIXTURE_NETWORK_DENIED:[a-zA-Z0-9.]+$/.test(line)).length;
    }
  })();
  void stderr.catch(()=>child.kill("SIGTERM"));
  return {child,peekStderr:()=>stderrText,async close(){
    child.stdin.end();let forced=false;
    const term=setTimeout(()=>{forced=true;child.kill("SIGTERM");},3000);
    const kill=setTimeout(()=>{forced=true;child.kill("SIGKILL");},3500);
    try {const code=await child.exited;await stderr;return {code,forced,stderrBytes,networkDenials};}
    finally{clearTimeout(term);clearTimeout(kill);}
  }};
}

export async function startRawNativeInteractionProcess(options:{root?:string;scripted?:boolean}={}) {
  const selection=await prepareNativeInteractionFixture(options);
  const fixture=observeClientProcess(Bun.spawn(selection.argv,{env:selection.env,cwd:selection.cwd,
    stdin:"pipe",stdout:"pipe",stderr:"pipe"}));
  return {...fixture,async close(){try{return await fixture.close();}finally{await rm(selection.home,{recursive:true,force:true});}}};
}
