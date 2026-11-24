import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { openInteractionPort } from "./fixture-transport.ts";
export type { Frame } from "./fixture-transport.ts";
import { z } from "zod";
import { PreflightTransport } from "../../packages/compatibility/transport.ts";
import validPolicy from "../../packages/contracts/generated/interaction-policy.js";
import { compatibilityBuild } from "../../packages/contracts/generated/identity.ts";

/** Native fixture launcher. Paths and argv are fixed by source, never accepted from Remote/browser input. */
export async function prepareNativeInteractionFixture(options:{root?:string;scripted?:boolean}={}) {
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
    if(report.base !== compatibilityBuild.base || report.sourceSha256 !== compatibilityBuild.sourceSha256 ||
      report.patchSha256 !== compatibilityBuild.patchSha256 || report.schemaSha256 !== compatibilityBuild.schemaSha256 ||
      report.runtime.version !== Bun.version || report.runtime.platform !== process.platform || report.runtime.arch !== process.arch) {
      throw new Error("S0_PREFLIGHT_IDENTITY_MISMATCH");
    }
  } finally {
    const drained=await probe.close();
    if(drained.code !== 0 || drained.forced || drained.protocolFailure)throw new Error("S0_POLICY_PREFLIGHT_UNCLEAN");
  }
  await mkdir(join(home,"profile"));
  // Static public model catalog only; no native Session/configuration files are read.
  const catalog=z.object({providers:z.array(z.array(z.unknown()))}).parse(
    await Bun.file(resolve(root,"vendor/omp/packages/catalog/src/models.json")).json());
  // CLI resolves its initial model before extensions register custom providers.
  const provider="openai";
  const disabled=["ollama","lm-studio","llama.cpp","apple",...catalog.providers.map(row=>z.string().parse(row[0]))]
    .filter(candidate=>candidate !== provider);
  await Bun.write(join(home,"profile/config.yml"), `disabledProviders: ${JSON.stringify(disabled)}\ncompaction:\n  enabled: false\nask:\n  timeout: ${options.scripted ? 1 : 0}\n  notify: "off"\nspeech:\n  enabled: false\n`);
  const source = resolve(root,"vendor/omp/packages/coding-agent/src");
  let extension = await Bun.file(resolve(root,"tests/interactions/native-extension.ts")).text();
  for (const suffix of ["extensibility/extensions","tools/ask","tools/context","config/settings"]) {
    extension = extension.replaceAll(`@oh-my-pi/pi-coding-agent/${suffix}`, `${source}/${suffix}.ts`);
  }
  extension=extension.replaceAll("@oh-my-pi/pi-ai",resolve(root,"vendor/omp/packages/ai/src/index.ts"));
  const extensionPath=join(home,"extension.ts");
  await Bun.write(extensionPath,extension);
  const argv=[process.execPath,"--no-env-file","--preload",resolve(root,"tests/interactions/no-provider.ts"),resolve(root,"vendor/omp-candidate/omp"),
    "--mode","rpc-ui","--offline","--provider",provider,"--model","gpt-4o","--no-skills","--no-rules",...(options.scripted ? ["--tools","ask","--thinking","off","--no-judge","--no-spotlight"] : ["--no-tools"]),"--no-extensions","--extension",extensionPath];
  const env={HOME:home,PATH:process.env.PATH ?? "/usr/bin:/bin",TMPDIR:home,
    PI_CODING_AGENT_DIR:join(home,"profile"),XDG_CONFIG_HOME:join(home,"config"),XDG_CACHE_HOME:join(home,"cache"),
    XDG_DATA_HOME:join(home,"data"),NO_COLOR:"1",PI_NOTIFICATIONS:"off",OPENAI_API_KEY:"synthetic-unused-no-provider-calls"};
  return {home,argv,env,cwd:home};
}

export async function startNativeInteractionFixture(options:{root?:string}={}) {
  const selection=await prepareNativeInteractionFixture(options);
  try {
    const port=await openInteractionPort(selection);
    return {...port,async close(){try{return await port.close();}finally{await rm(selection.home,{recursive:true,force:true});}}};
  } catch(error){await rm(selection.home,{recursive:true,force:true});throw error;}
}

