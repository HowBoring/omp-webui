import { test, expect } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const isolated = await mkdtemp(join(tmpdir(),'omp-history-public-'));
process.env.HOME=isolated; process.env.PI_CODING_AGENT_DIR=isolated;
const { RpcClient } = await import('../../../vendor/omp/packages/coding-agent/src/modes/rpc/rpc-client.ts');

test('real public native client/schema/server pages and public rename mutation invalidate prior cuts', async () => {
  let stderr = '';
  const client = new RpcClient({spawn: () => {
    const child = Bun.spawn([process.execPath,'--no-env-file',resolve(import.meta.dir,'history-rpc.js')], {
      env:{PATH:process.env.PATH,HOME:isolated,PI_CODING_AGENT_DIR:isolated,OMP_HISTORY_FIXTURE_PROFILE:isolated},
      stdin:'pipe',stdout:'pipe',stderr:'pipe'});
    void new Response(child.stderr).text().then(text=>{stderr=text;});
    return {stdin:child.stdin,stdout:child.stdout,exited:child.exited,peekStderr:()=>stderr,kill:signal=>child.kill(signal)};
  }});
  try {
    await client.start();
    const opened = await client.historySnapshotOpen('tree');
    const page = await client.historySnapshotPage(opened.cursor);
    let cursor=page.nextCursor;
    while(cursor){const next=await client.historySnapshotPage(cursor);page.items.push(...next.items);cursor=next.nextCursor;}
    expect(page.items.some(row=>row.text==='Abandoned branch')).toBe(true);
    expect(page.items.some(row=>row.text==='Background branch' && !row.active)).toBe(true);
    expect(JSON.stringify(page)).not.toContain('SYNTHETIC_PRIVATE_TOKEN');
    const active = await client.historySnapshotPage(opened.cursors.active);
    expect(active.cut).toEqual(page.cut);
    expect(active.items.some(row=>row.text==='Abandoned branch')).toBe(false);
    await client.prompt('/rename Renamed synthetic fixture');
    await expect(client.historySnapshotPage(opened.cursor)).rejects.toThrow('history_changed');
    await client.historySnapshotClose(opened.snapshot);
    const newer = await client.historySnapshotOpen('tree');
    expect(newer.cut.contentRevision).not.toBe(opened.cut.contentRevision);
    await expect(client.historySnapshotPage('foreign')).rejects.toThrow('history_stale_cursor');
    const poll = await client.historyObservationPoll(opened.cut.workerId,opened.cut.observationSeq);
    expect(poll.events.some(event=>event.kind==='native_content_changed')).toBe(true);
  } finally { await client.stop();
    const audit=JSON.parse(await readFile(join(isolated,'network-audit.json'),'utf8'));
    expect(audit.actualNetworkDispatches).toBe(0);
    await rm(isolated,{recursive:true,force:true}); }
}, 30000);
