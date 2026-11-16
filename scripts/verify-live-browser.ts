/** Owned synthetic workers are always drained and profiles removed, including assertion failure. */
import {startLiveFixture} from '../apps/live-fixture/server.ts';
for(const warmup of [true,false]){
  const fixture=await startLiveFixture(0,{warmup,trace:true});
  try {
    const child=Bun.spawn(['python3','tests/browser/live-browser.py'],{env:{PATH:process.env.PATH??'/usr/bin:/bin',
      LIVE_URL:fixture.server.url.href,LIVE_MODE:warmup?'stable':'first-materialization'},stdout:'inherit',stderr:'inherit'});
    if(await child.exited!==0)throw Error('LIVE_BROWSER_FAILED');

  }finally{console.log(JSON.stringify({mode:warmup?'stable':'first-materialization',...await fixture.stop()}));}
}
