/** Actual native worker lifetime; disposable projection journals never own its shutdown. */
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {InteractionBridge} from '../../packages/interactions/bridge.ts';
import {LiveJournal} from '../../packages/projection/live-journal.ts';
import {parseProjectionBinding} from '@deepseek-ai/dsh-api-session-controller/projection';
import {openSharedNative} from './native-transport.ts';
import {verifyProjectionNative} from './native-identity.ts';
import {PreflightTransport} from '../../packages/compatibility/transport.ts';
import {compatibilityBuild} from '../../packages/contracts/generated/identity.ts';

export async function openNativeProjection(){
  const closure=await verifyProjectionNative();
  const profile=await mkdtemp(join(tmpdir(),'omp-projection-native-'));
  await Bun.write(join(profile,'config.yml'),'compaction:\n  enabled: false\nask:\n  timeout: 120\n  notify: "off"\nspeech:\n  enabled: false\n');
  const probe=await PreflightTransport.open({argv:[process.execPath,'--no-env-file',resolve('vendor/omp-candidate/cli.js'),'--rpc-preflight'],cwd:profile,
    env:{HOME:profile,PI_CODING_AGENT_DIR:profile}});
  let preflight;
  try {preflight=await probe.inspect();
    if(preflight.base!==compatibilityBuild.base||preflight.sourceSha256!==compatibilityBuild.sourceSha256
      ||preflight.patchSha256!==compatibilityBuild.patchSha256||preflight.schemaSha256!==compatibilityBuild.schemaSha256
      ||preflight.runtime.version!==Bun.version||preflight.runtime.platform!==process.platform||preflight.runtime.arch!==process.arch)throw Error('projection_native_identity_mismatch');
  }finally{const drained=await probe.close();if(drained.code!==0||drained.forced||drained.protocolFailure)throw Error('projection_preflight_unclean');}
  const argv=[process.execPath,'--no-env-file','--preload',resolve('compatibility/omp/fixtures/history-network-guard.js'),
    resolve('vendor/omp-candidate/cli.js'),'--mode','rpc-ui','--offline','--model','s0-projection/first',
    '--no-lsp','--no-skills','--no-rules','--no-prewalk','--no-spotlight','--no-judge','--tools','ask',
    '--trusted-extension',resolve('experiments/projection-seam/native-provider.ts')];
  const port=await openSharedNative({argv:['strace','--kill-on-exit','-f','-e','trace=network','-o',join(profile,'network.strace'),...argv],cwd:profile,
    env:{HOME:profile,PI_CODING_AGENT_DIR:profile,OMP_HISTORY_FIXTURE_PROFILE:profile,PATH:process.env.PATH??'/usr/bin:/bin'},readyTimeoutMs:20000});
  const bridge=new InteractionBridge(port,{waitMs:120000});
  try {
    await port.prompt('NATIVE WARMUP');
    for(let index=0;index<400;index++){const state=await port.state();if(state.isSettled&&!state.isStreaming)break;
      if(index===399)throw Error('native_projection_warmup_timeout');await Bun.sleep(25);}
    let journal=await LiveJournal.open(port.history);bridge.bindSession(journal.sessionId);
    let generation=crypto.randomUUID();let rebuilding:Promise<void>|undefined;let failure:string|undefined;let stopped=false;
    const listeners=new Set<()=>void>();
    const binding=()=>parseProjectionBinding({source:JSON.stringify([journal.opened.cut.sourceId,journal.sessionId]),generation});
    let polling=false;
    async function rebuild(){
      generation=crypto.randomUUID();failure=undefined;
      for(const listener of listeners)listener();
      try {const successor=await LiveJournal.open(port.history);if(!stopped)journal=successor;}
      catch(error){failure=String(error);throw error;}
    }
    async function poll(){if(stopped||polling||rebuilding||failure)return;polling=true;
      const captured=journal;
      try {const result=await port.history.poll(captured.opened.cut.workerId,captured.after);if(captured===journal)captured.accept(result);}
      catch(error){if(captured===journal){captured.invalidate(String(error));rebuilding=rebuild();try{await rebuilding;}catch{}finally{rebuilding=undefined;}}}
      finally{polling=false;}}
    const timer=setInterval(()=>{void poll();},25);
    return {port,bridge,get journal(){return journal;},binding,
      async ready(signal?:AbortSignal){
        const cancelled=Promise.withResolvers<never>();
        const abort=()=>cancelled.reject(signal?.reason??Error('projection_open_cancelled'));
        signal?.addEventListener('abort',abort,{once:true});
        try{
          if(signal?.aborted)abort();
          for(;;){const pending=rebuilding;await Promise.race([pending,cancelled.promise]);
            if(pending!==rebuilding)continue;if(failure)throw Error(failure);return;}
        }finally{signal?.removeEventListener('abort',abort);}
      },
      info(){return {sessionId:journal.sessionId,projection:binding(),cut:journal.opened.cut,failure,
        historyFault:port.historyFault(),rebuilding:rebuilding!==undefined,interaction:bridge.snapshot(),process:port.frames.find(frame=>frame.type==='extension_ui_request'&&typeof frame.message==='string'&&frame.message.includes('projection-native-process')),
        compatibility:compatibilityBuild,preflight,closure};},
      subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
      async retry(){if(!failure)return;failure=undefined;
        rebuilding=(async()=>{try{journal=await LiveJournal.open(port.history);}catch(error){failure=String(error);throw error;}})();
        try{await rebuilding;}finally{rebuilding=undefined;}},
      async close(){stopped=true;port.releaseHistory(true);clearInterval(timer);bridge.dispose();const drain=await port.close();
        try {const trace=await Bun.file(join(profile,'network.strace')).text();const audit=await Bun.file(join(profile,'network-audit.json')).json();
          return {drain,audit,traceSha256:Bun.SHA256.hash(trace,'hex'),inetConnects:trace.split('\n').filter(line=>/connect\(.*sa_family=AF_INET6?\b/.test(line)).length,
            inetSends:trace.split('\n').filter(line=>/send(to|msg)\(.*sa_family=AF_INET6?\b/.test(line)).length,trace};}
        finally{await rm(profile,{recursive:true,force:true});}}
    };
  }catch(error){bridge.dispose();await port.close();await rm(profile,{recursive:true,force:true});throw error;}
}
