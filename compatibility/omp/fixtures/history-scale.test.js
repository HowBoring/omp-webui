import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const profile=await mkdtemp(join(tmpdir(),'omp-history-scale-'));
process.env.HOME=profile;process.env.PI_CODING_AGENT_DIR=profile;
const {SessionManager}=await import('../../../vendor/omp/packages/coding-agent/src/session/session-manager.ts');
const {RpcHistoryObservation}=await import('../../../vendor/omp/packages/coding-agent/src/modes/rpc/rpc-history.ts');

test('all 10000 entries and over 100 MiB native history remain reachable through bounded snapshot pages',async()=>{
  try {
    const manager=SessionManager.inMemory(profile);
    for(let index=0;index<10000;index++) {
      if(index===3000 || index===7000) manager.appendResetBoundary();
      else if(index===2000 || index===6000) manager.appendCompaction(`Native summary ${index}`,undefined,manager.getLeafId(),100);
      else manager.appendMessage({role:'user',content:`${String(index).padStart(5,'0')}:`+'x'.repeat(10486),timestamp:index});
    }
    const nativeBytes=manager.getEntries().reduce((sum,entry)=>sum+Buffer.byteLength(JSON.stringify(entry)),0);
    expect(nativeBytes).toBeGreaterThanOrEqual(100*1024*1024);
    const history=new RpcHistoryObservation(manager,()=>({messages:[],streaming:false,compacting:false}));
    const start=performance.now(),opened=history.open('tree');
    let cursor=opened.cursor,pages=0,rows=0,maxBytes=0;
    const seen=new Set();
    while(cursor) {
      const page=history.page(cursor);
      const bytes=Buffer.byteLength(JSON.stringify(page));
      maxBytes=Math.max(maxBytes,bytes);
      for(const item of page.items) {if(item.partIndex===0) {seen.add(item.entryId);rows++;}}
      cursor=page.nextCursor;pages++;
    }
    expect(rows).toBe(10000);expect(seen.size).toBe(10000);expect(maxBytes).toBeLessThan(768*1024);
    console.log(JSON.stringify({kind:'native-reachability-only-not-formal-performance',nativeBytes,entries:rows,pages,maxPageBytes:maxBytes,elapsedMs:performance.now()-start,scanMs:opened.scanMs,scannedBytes:opened.scannedBytes}));
  }finally{await rm(profile,{recursive:true,force:true});}
},180000);
