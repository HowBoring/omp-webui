/** Read-only verification of the paired external native source and built artifacts. */
import {mkdtemp,rm,readFile,readdir,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {ompBase,ompPatches,authoredPaths,temporaryPaths} from '../../scripts/omp-source.ts';
import {compatibilityBuild} from '../../packages/contracts/generated/identity.ts';

const hash=(bytes:string|Uint8Array)=>Bun.SHA256.hash(bytes,'hex');
function git(dir:string,...args:string[]){const result=Bun.spawnSync(['git','-C',dir,...args],{env:{PATH:process.env.PATH??'/usr/bin:/bin'}});
  if(result.exitCode!==0)throw Error('projection_native_identity_git');return result.stdout;}
export async function verifyProjectionNative(){
  const source=await realpath(resolve('vendor/omp')),candidate=await realpath(resolve('vendor/omp-candidate'));
  if(await realpath(resolve(candidate,'../omp'))!==source)throw Error('projection_native_unpaired_runtime');
  if(git(source,'rev-parse','HEAD').toString().trim()!==ompBase)throw Error('projection_native_source_base');
  const generated=['packages/coding-agent/src/modes/rpc/wire/rpc-wire.generated.ts','packages/coding-agent/src/modes/rpc/wire/rpc-wire.schema.json',
    'sdk/go/omp-rpc/wire.go','sdk/python/omp-rpc/src/omp_rpc/_wire.py','sdk/rust/omp-rpc/src/wire.rs'];
  const allowed=new Set([...authoredPaths,...generated]);
  for(const file of git(source,'diff','HEAD','--name-only').toString().trim().split('\n').filter(Boolean))if(!allowed.has(file))throw Error('projection_native_undeclared_change');
  for(const file of git(source,'ls-files','--others').toString().trim().split('\n').filter(Boolean))if(!temporaryPaths.includes(file)&&!authoredPaths.includes(file))throw Error('projection_native_undeclared_file');
  const patches=await Promise.all(ompPatches.map(name=>readFile(resolve('compatibility/omp',name),'utf8')));
  if(hash(patches.join(''))!==compatibilityBuild.patchSha256||hash(ompBase+'\n'+patches.join(''))!==compatibilityBuild.sourceSha256)throw Error('projection_native_patch_identity');
  const temp=await mkdtemp(join(tmpdir(),'omp-projection-identity-'));
  try{
    // Shared objects are read-only. The index and every new patch object belong to this temporary clone.
    const clone=Bun.spawnSync(['git','clone','--shared','--no-checkout',source,temp],{env:{PATH:process.env.PATH??'/usr/bin:/bin'}});
    if(clone.exitCode!==0)throw Error('projection_native_identity_clone');
    git(temp,'read-tree',ompBase);
    for(const patch of ompPatches)git(temp,'apply','--cached',resolve('compatibility/omp',patch));
    const tree=git(temp,'write-tree').toString().trim();const files:Record<string,string>={};
    for(const file of authoredPaths){const actual=await readFile(join(source,file));if(hash(actual)!==hash(git(temp,'show',tree+':'+file)))throw Error('projection_native_authored_mismatch');files[file]=hash(actual);}
    const schema=await readFile(join(candidate,'rpc-wire.schema.json'));
    if(hash(schema)!==compatibilityBuild.schemaSha256||hash(schema)!==hash(await readFile('packages/contracts/generated/omp.schema.json')))throw Error('projection_native_schema_identity');
    const generatedSourceSchema=hash(await readFile(join(source,generated[1]!)));
    const artifacts:Record<string,string>={};for(const entry of await readdir(candidate,{withFileTypes:true}))if(entry.isFile())artifacts[entry.name]=hash(await readFile(join(candidate,entry.name)));
    return {source,candidate,tree,build:compatibilityBuild,generatedSourceSchema,authoredFiles:files,artifacts};
  }finally{await rm(temp,{recursive:true,force:true});}
}
