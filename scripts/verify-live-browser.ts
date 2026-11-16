/** Owned synthetic workers are always drained and profiles removed, including assertion failure. */
import {startLiveFixture} from '../apps/live-fixture/server.ts';
for(const mode of ['stable','first-materialization','active-opening','refusal','empty-error','rewind'] as const){
  const warmup=mode!=='first-materialization';
  const fixture=await startLiveFixture(0,{warmup,trace:true,activeOpening:mode==='active-opening',...(['refusal','empty-error','rewind'].includes(mode)?{scenario:mode as 'refusal'|'empty-error'|'rewind'}:{})});
  try {
    const child=Bun.spawn(['python3','tests/browser/live-browser.py'],{env:{PATH:process.env.PATH??'/usr/bin:/bin',
      LIVE_URL:fixture.server.url.href,LIVE_MODE:mode},stdout:'inherit',stderr:'inherit'});
    if(await child.exited!==0)throw Error('LIVE_BROWSER_FAILED');

  }finally{console.log(JSON.stringify({mode,...await fixture.stop()}));}
}
