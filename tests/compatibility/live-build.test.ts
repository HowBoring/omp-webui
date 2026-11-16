/** Shipped fixture source admission, with all source faults confined to an owned clone. */
import {test,expect} from 'bun:test';
import {cp,mkdtemp,mkdir,readdir,symlink,rm,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
const root=resolve(import.meta.dir,'../..'),require=createRequire(import.meta.url);
const actual=resolve(dirname(require.resolve('@deepseek-ai/dsh-api-gateway/package.json')),'../../..');
test('live fixture refuses an undeclared consumed DSH tree before writing browser assets',async()=>{
  const dir=await mkdtemp(resolve(tmpdir(),'live-build-'));
  try{
    for(const file of ['apps/live-fixture','packages','scripts/dsh-source.ts','scripts/build-identities.ts','compatibility/dsh','package.json','upstreams.lock.json']){
      await mkdir(resolve(dir,file,'..'),{recursive:true});await cp(resolve(root,file),resolve(dir,file),{recursive:true});
    }
    await mkdir(resolve(dir,'node_modules/@deepseek-ai'),{recursive:true});
    for(const name of await readdir(resolve(root,'node_modules'))){if(name!=='@deepseek-ai')await symlink(resolve(root,'node_modules',name),resolve(dir,'node_modules',name));}
    for(const name of await readdir(resolve(root,'node_modules/@deepseek-ai')))await symlink(resolve(root,'node_modules/@deepseek-ai',name),resolve(dir,'node_modules/@deepseek-ai',name));
    const clone=Bun.spawnSync(['git','clone','--shared','--no-checkout',actual,resolve(dir,'source')]);expect(clone.exitCode).toBe(0);
    expect(Bun.spawnSync(['git','-C',resolve(dir,'source'),'checkout','--detach','38a6a5c965aa99ab525161efb7cc5cf1fe62fced']).exitCode).toBe(0);
    const gateway=resolve(dir,'node_modules/@deepseek-ai/dsh-api-gateway');await rm(gateway);await symlink(resolve(dir,'source/packages/api/gateway'),gateway);
    await writeFile(resolve(dir,'source/.env'),'SYNTHETIC_UNDECLARED_STARTUP=1\n');
    const child=Bun.spawn([process.execPath,'--no-env-file','apps/live-fixture/build.ts'],{cwd:dir,env:{PATH:process.env.PATH??'/usr/bin:/bin'},stdout:'ignore',stderr:'pipe'});
    const error=await new Response(child.stderr).text();expect(await child.exited).toBe(1);expect(error).toContain('DSH_UNRECORDED_IGNORED_SOURCE');
    expect(await Bun.file(resolve(dir,'vendor/dsh-live/client.js')).exists()).toBe(false);
    expect(await Bun.file(resolve(dir,'vendor/dsh-live/manifest.json')).exists()).toBe(false);
  }finally{await rm(dir,{recursive:true,force:true});}
},30000);
