import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { FixtureTransport } from "./fixture-transport.ts";
export type { Frame } from "./fixture-transport.ts";
import { z } from "zod";
import { PreflightTransport } from "../../packages/compatibility/transport.ts";
import validPolicy from "../../packages/contracts/generated/interaction-policy.js";

/** Native fixture launcher. Paths and argv are fixed by source, never accepted from Remote/browser input. */
export async function startNativeInteractionFixture(options:{root?:string;readProtocol?:boolean}={}) {
  const root=options.root ?? process.cwd();
  const home = await mkdtemp(join(tmpdir(), "omp-native-interactions-"));
  // Verify the immutable effective policy through safe public preflight BEFORE
  // an ordinary worker, extension startup UI or native timer can exist.
  const probe=await PreflightTransport.open({argv:[process.execPath,"--no-env-file",
    resolve(root,"vendor/omp-candidate/omp"),"--rpc-preflight"],
    cwd:home,env:{HOME:home,PI_CODING_AGENT_DIR:join(home,"profile"),TMPDIR:home,
      XDG_CONFIG_HOME:join(home,"config"),XDG_CACHE_HOME:join(home,"cache")}});
  try {
    const report=await probe.inspect();if(!validPolicy(report.rpcUiInteractionPolicy))throw new Error("S0_EXPLICIT_POLICY_REQUIRED");
  } finally {
    const drained=await probe.close();
    if(drained.code !== 0 || drained.forced || drained.protocolFailure)throw new Error("S0_POLICY_PREFLIGHT_UNCLEAN");
  }
  await mkdir(join(home,"profile"));
  // Static public model catalog only; no native Session/configuration files are read.
  const catalog=z.object({providers:z.array(z.array(z.unknown()))}).parse(
    await Bun.file(resolve(root,"vendor/omp/packages/catalog/src/models.json")).json());
  const disabled=["ollama","lm-studio","llama.cpp","apple",...catalog.providers.map(row=>z.string().parse(row[0]))]
    .filter(provider=>provider !== "openai");
  await Bun.write(join(home,"profile/config.yml"), `disabledProviders: ${JSON.stringify(disabled)}\n`);
  const source = resolve(root,"vendor/omp/packages/coding-agent/src");
  let extension = await Bun.file(resolve(root,"tests/interactions/native-extension.ts")).text();
  for (const suffix of ["extensibility/extensions","tools/ask","tools/context","config/settings"]) {
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
  const transport=new FixtureTransport(child,options.readProtocol !== false);
  return {child,exited:transport.exited,frames:transport.frames,
    send:(frame:object)=>transport.send(frame),wait:(predicate:Parameters<FixtureTransport["wait"]>[0],after=0)=>transport.wait(predicate,after),
    command:(fields:object)=>transport.command(fields),subscribe:(listener:Parameters<FixtureTransport["subscribe"]>[0])=>transport.subscribe(listener),
    async close() {try{return await transport.close();}finally{await rm(home,{recursive:true,force:true});}},
  };
}
