/** Actual CLI rpc-ui worker in an allowlisted synthetic environment; controlled provider only. */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {LiveTransport} from '../../../packages/compatibility/live-transport.ts';
export async function openLiveFixture(warmup=true,options:{trace?:boolean;tools?:boolean;burst?:boolean;seed?:number;delayMs?:number;scenario?:"empty-error"|"refusal"|"empty-overflow"|"rewind"|"transform"|"handled"}={}){
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'omp-live-cli-'));
  const argv=[process.execPath,'--no-env-file','--preload',
    path.resolve('compatibility/omp/fixtures/history-network-guard.js'),path.resolve('vendor/omp-candidate/cli.js'),
    '--mode','rpc-ui','--offline','--model','s0-controlled/deterministic-live',
    '--no-lsp','--no-skills','--no-rules','--no-prewalk','--no-spotlight','--no-judge',
    '--trusted-extension',path.resolve('compatibility/omp/fixtures/live-provider.ts')];
  const transport=await LiveTransport.open({argv:options.trace?['strace','--kill-on-exit','-f','-e','trace=network','-o',path.join(profile,'network.strace'),...argv]:argv,
    cwd:profile,env:{HOME:profile,PI_CODING_AGENT_DIR:profile,OMP_HISTORY_FIXTURE_PROFILE:profile,
      PATH:process.env.PATH??'/usr/bin:/bin',...(options.tools?{OMP_LIVE_FIXTURE_TOOLS:'1'}:{}),...(options.burst?{OMP_LIVE_FIXTURE_BURST:'1'}:{}),
      ...(options.seed?{OMP_LIVE_FIXTURE_SEED:String(options.seed)}:{}),...(options.delayMs?{OMP_LIVE_FIXTURE_DELAY_MS:String(options.delayMs)}:{}),...(options.scenario?{OMP_LIVE_FIXTURE_SCENARIO:options.scenario}:{})},readyTimeoutMs:20000}).catch(async error=>{await fs.rm(profile,{recursive:true,force:true});throw error;});
  try {
    // Native lazy materialization is a source replacement. Warm up through public prompt before opening DSH.
    if(warmup)await transport.prompt();
    for(let i=0;i<400;i++){const state=await transport.state();if(state.isSettled&&!state.isStreaming)break;
      if(i===399)throw Error('live_warmup_not_settled');await Bun.sleep(25);}
  }catch(error){await transport.close();await fs.rm(profile,{recursive:true,force:true});throw error;}
  return {profile,transport,async close(){
    const drain=await transport.close();
    try {
      const audit=await Bun.file(path.join(profile,'network-audit.json')).json();
      const controlledFile=Bun.file(path.join(profile,'controlled-provider.json'));
      const controlled=await controlledFile.exists()?await controlledFile.json():null;
      const traceFile=Bun.file(path.join(profile,'network.strace'));
      const trace=await traceFile.exists()?await traceFile.text():undefined;
      if(trace){await fs.mkdir('vendor/live-evidence',{recursive:true});await Bun.write(path.join('vendor/live-evidence',path.basename(profile)+'.network.strace'),trace);}
      return {drain,audit,controlled,...(trace?{trace:{sha256:Bun.SHA256.hash(trace,'hex'),
        inetConnects:trace.split('\n').filter(line=>/connect\(.*sa_family=AF_INET6?\b/.test(line)).length,
        inetSends:trace.split('\n').filter(line=>/send(to|msg)\(.*sa_family=AF_INET6?\b/.test(line)).length}}:{})};
    }finally{await fs.rm(profile,{recursive:true,force:true});}
  }};
}
