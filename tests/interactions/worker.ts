import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { PhysicalFrames } from "../../packages/compatibility/framing.ts";
import { z } from "zod";

export const frameSchema = z.object({ type:z.string(), id:z.string().optional() }).catchall(z.unknown());
export type Frame = z.infer<typeof frameSchema>;
/** Native fixture launcher. Paths and argv are fixed by source, never accepted from Remote/browser input. */
export async function startNativeInteractionFixture(options:{root?:string;readProtocol?:boolean}={}) {
  const root=options.root ?? process.cwd();
  const home = await mkdtemp(join(tmpdir(), "omp-native-interactions-"));
  await mkdir(join(home,"profile"));
  // Static public model catalog only; no native Session/configuration files are read.
  const catalog=z.object({providers:z.array(z.array(z.unknown()))}).parse(
    await Bun.file(resolve(root,"vendor/omp/packages/catalog/src/models.json")).json());
  const disabled=["ollama","lm-studio","llama.cpp","apple",...catalog.providers.map(row=>z.string().parse(row[0]))]
    .filter(provider=>provider !== "openai");
  await Bun.write(join(home,"profile/config.yml"), `disabledProviders: ${JSON.stringify(disabled)}\n`);
  const source = resolve(root,"vendor/omp/packages/coding-agent/src");
  let extension = await Bun.file(resolve(root,"tests/interactions/native-extension.ts")).text();
  for (const suffix of ["extensibility/extensions","tools/ask","config/settings"]) {
    extension = extension.replaceAll(`@oh-my-pi/pi-coding-agent/${suffix}`, `${source}/${suffix}.ts`);
  }
  const extensionPath=join(home,"extension.ts");
  await Bun.write(extensionPath,extension);
  const child=Bun.spawn([process.execPath,"--no-env-file","--preload",resolve(root,"tests/interactions/no-provider.ts"),resolve(root,"vendor/omp-candidate/omp"),
    "--mode","rpc-ui","--offline","--provider","openai","--model","gpt-4o","--no-skills","--no-rules","--no-tools","--no-extensions","--extension",extensionPath], {
    cwd:home,env:{HOME:home,PATH:process.env.PATH ?? "/usr/bin:/bin",TMPDIR:home,
      PI_CODING_AGENT_DIR:join(home,"profile"),XDG_CONFIG_HOME:join(home,"config"),
      XDG_CACHE_HOME:join(home,"cache"),XDG_DATA_HOME:join(home,"data"),NO_COLOR:"1",PI_NOTIFICATIONS:"off",OPENAI_API_KEY:"synthetic-unused-no-provider-calls"},
    stdin:"pipe",stdout:"pipe",stderr:"pipe",
  });
  const stderr=new Response(child.stderr).text();
  const frames:Frame[]=[];
  const subscribers=new Set<(frame:Frame)=>void>();
  const physical=new PhysicalFrames();
  let serial=0;
  let finished=false;
  const reader=(async()=>{
    if(options.readProtocol === false)return;
    for await (const chunk of child.stdout) for(const value of physical.push(chunk)) {
      const frame=frameSchema.parse(value);
      if(frame.type === "response" && frame.command === "negotiate_protocol" && frame.success === true) physical.negotiate(2);
      frames.push(frame); for(const fn of subscribers) fn(frame);
    }
    physical.finish(); finished=true;
  })();
  reader.catch(()=>{});
  const send=(command: object) => { child.stdin.write(JSON.stringify(command)+"\n"); };
  const wait=async(predicate:(frame:Frame)=>boolean, after=0):Promise<Frame>=>{
    const found=frames.slice(after).find(predicate); if(found) return found;
    const result=Promise.withResolvers<Frame>();
    const listener=(frame:Frame)=>{if(predicate(frame))result.resolve(frame);};
    const timer=setTimeout(()=>result.reject(new Error("Native interaction frame timed out")),10_000);
    subscribers.add(listener);
    void child.exited.then(async code=>result.reject(new Error(`Native worker exited ${code}: ${(await stderr).slice(0,1000)}`)));
    try{return await result.promise;}finally{clearTimeout(timer);subscribers.delete(listener);}
  };
  const command=async(fields:object):Promise<Frame>=>{
    const id=`interaction-${++serial}`; send({...fields,id});return wait(f=>f.type === "response" && f.id === id);
  };
  return { child, exited:child.exited, frames, send, wait, command,
    subscribe(listener:(frame:Frame)=>void):()=>void {subscribers.add(listener);return()=>{subscribers.delete(listener);};},
    async close() {

      child.stdin.end();
      const timer=setTimeout(()=>child.kill("SIGTERM"),3000);
      try {
        const code=await child.exited;await reader; const diagnostics=await stderr;
        return {code,stdoutDrained:finished,stderrBytes:diagnostics.length,networkEntries:[...new Set(diagnostics.trim().split("\n"))],networkDenials:diagnostics.split("S0_FIXTURE_NETWORK_DENIED").length-1};
      } finally {clearTimeout(timer);await rm(home,{recursive:true,force:true});}
    },
  };
}
