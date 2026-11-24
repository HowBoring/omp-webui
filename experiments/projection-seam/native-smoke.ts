import {openNativeProjection} from './native.ts';
const native=await openNativeProjection();
try{
  console.log(JSON.stringify({before:native.info()}));
  await native.port.prompt('ASK_FOR_PROJECTION_PROOF');
  for(let index=0;index<200;index++){if(native.bridge.snapshot().pending.length)break;await Bun.sleep(25);}
  const pending=native.bridge.snapshot().pending[0];if(!pending)throw Error('native_ask_missing');
  console.log(JSON.stringify({pending}));
  await native.port.model();
  await Bun.sleep(300);
  console.log(JSON.stringify({after:native.info()}));
  console.log(JSON.stringify({answer:await native.bridge.answer(pending.generation,pending.id,{type:'value',value:'chosen'})}));
  for(let index=0;index<200;index++){const next=native.bridge.snapshot().pending[0];if(next){console.log(JSON.stringify({next}));await native.bridge.answer(next.generation,next.id,{type:'value',value:'explicit native reason'});break;}await Bun.sleep(25);}
  for(let index=0;index<200;index++){const state=await native.port.state();if(state.isSettled&&!state.isStreaming)break;await Bun.sleep(25);}
  await native.retry();console.log(JSON.stringify({final:native.info()}));
}finally{const closed=await native.close();const {trace,...result}=closed;console.log(JSON.stringify({closed:result}));}
