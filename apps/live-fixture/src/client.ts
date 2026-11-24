import {Context} from '@deepseek-ai/cordis';
import {apply as connection} from '@deepseek-ai/dsh-client-connection/client';
import {apply as registry} from '@deepseek-ai/dsh-typert-registry/client';
import {apply as gateway} from '@deepseek-ai/dsh-api-gateway/client';
import {apply as sessions,type SessionReference} from '@deepseek-ai/dsh-api-session-controller/client';
import sessionContribution from '@deepseek-ai/dsh-api-session-controller/remote';
import {SessionId} from '@deepseek-ai/dsh-session/types';
import {UiConversation} from '@deepseek-ai/dsh-client-ui-conversation/client';
import {registerTrajectoryMessageDefinitions} from '@deepseek-ai/dsh-client-ui-trajectory/src/client/trajectory-message-definitions.ts';
import {registerTrajectoryAssistantDefinition} from '@deepseek-ai/dsh-client-ui-trajectory/src/client/trajectory-assistant-definition.ts';
import {registerTrajectoryConversationView} from '@deepseek-ai/dsh-client-ui-trajectory/src/client/trajectory-snapshot-builder.ts';
import {liveContribution} from '../../../packages/contracts/live-fixture.ts';
const ctx=new Context();
const element=(id:string):HTMLElement=>{const e=document.getElementById(id);if(!e)throw Error('missing_fixture_mount');return e;};
const status=element('status'),list=element('conversation'),evidence=element('evidence');
let reference:SessionReference|undefined,unsubscribe:(()=>void)|undefined;
let nativeId:SessionId|undefined;
let invalidated=false;
function fail(reason:string){invalidated=true;list.replaceChildren();status.textContent=`Projection invalidated: ${reason}. Manually release and reopen the full view.`;
  element('prompt').setAttribute('disabled','');element('rewind').setAttribute('disabled','');}
async function open(){
  const result=await ctx.remote.ompLiveFixture.action('info');if(!result.ok)throw Error('fixture_info_failed');
  nativeId=SessionId(result.value.sessionId);invalidated=false;
  reference=ctx.sessions.retain(nativeId,{source:'liveFixture'});const binding=await reference.ready;
  const target=ctx.uiConversation.binding(binding).target('trajectory');
  const render=()=>{if(invalidated)return;
    const snapshot=target.getSnapshot();list.replaceChildren();
    for(const node of snapshot?.eventNodes??[]){const row=document.createElement('pre');row.className='row';
      row.textContent=JSON.stringify(node);list.append(row);}
    if(snapshot?.partial){const partial=document.createElement('pre');partial.id='partial';partial.textContent=JSON.stringify(snapshot.partial);list.append(partial);}
    evidence.textContent=JSON.stringify({sessionId:nativeId,generation:result.value.generation,
      journal:binding.eventSource.getSnapshot().entries.map(entry=>({type:entry.type,seq:entry.event.seq,event:entry.event.type})),
      durability:'not_attested'},null,2);
  };unsubscribe=target.subscribe(render);render();status.textContent='Ready · real DSH controller and Conversation · native observation only';
  element('prompt').removeAttribute('disabled');element('rewind').removeAttribute('disabled');
}
element('prompt').onclick=()=>{void ctx.remote.ompLiveFixture.action('prompt').then(result=>{if(!result.ok)fail(result.error.message);});};
element('rewind').onclick=()=>{void ctx.remote.ompLiveFixture.action('rewind').then(result=>{if(!result.ok)fail(result.error.message);else if(result.value.phase==='invalidated')fail(result.value.reason??'source changed');});};
element('reopen').onclick=()=>{void (async()=>{unsubscribe?.();reference?.release();reference=undefined;
  for(let i=0;i<100;i++){const result=await ctx.remote.ompLiveFixture.action('reopen');if(result.ok){await open();return;}await new Promise(resolve=>setTimeout(resolve,25));}
  fail('full_view_release_not_completed');})();};
async function boot(){connection(ctx);registry(ctx);gateway(ctx);await ctx.remote.$mount(sessionContribution);await ctx.remote.$mount(liveContribution);
  sessions(ctx);new UiConversation(ctx,ctx.sessions);registerTrajectoryMessageDefinitions(ctx);registerTrajectoryAssistantDefinition(ctx);registerTrajectoryConversationView(ctx);
  let ready=false;ctx.connection.generation.subscribe(()=>{if(ctx.connection.generation.getSnapshot()!==undefined&&!ready){ready=true;void open().catch(error=>fail(String(error)));}});
  if(ctx.connection.generation.getSnapshot()!==undefined){ready=true;await open();}
  const watch=setInterval(()=>{void ctx.remote.ompLiveFixture.action('info').then(result=>{if(result.ok){if(result.value.phase==='invalidated')fail(result.value.reason??'source changed');
    else if(!invalidated)(element('rewind') as HTMLButtonElement).disabled=!result.value.settled;}});},100);
  window.addEventListener('pagehide',()=>{clearInterval(watch);unsubscribe?.();reference?.release();void ctx.fiber.dispose();},{once:true});
}
declare module '@deepseek-ai/dsh-api-session-controller/client'{interface SessionReferenceSourceMap{liveFixture:unknown}}
void boot().catch(error=>fail(String(error)));
