/** Build the labelled fixture plugin and record each consumed input and emitted byte. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {BuildIdentities,assetIdentities,sha256} from '../../scripts/build-identities.ts';
import {verifyDshSource} from '../../scripts/dsh-source.ts';
const outdir=resolve('vendor/projection-fixture/controls'),identities=new BuildIdentities();
const result=await Bun.build({entrypoints:[resolve('experiments/projection-seam/fixture/client.js')],target:'browser',format:'iife',outdir,
  plugins:[{name:'projection-fixture-inputs',setup(build){build.onLoad({filter:/\.[cm]?[jt]s$/},async args=>{
    const contents=await readFile(args.path,'utf8');await identities.record(args.path,contents);
    return {contents,loader:args.path.endsWith('ts')?'ts':'js'};
  });}}]});
if(!result.success)throw new AggregateError(result.logs,'projection fixture build failed');
const manifest={kind:'isolated-projection-rebuild-plugin',runtime:{name:'bun',version:Bun.version},
  dshSource:await verifyDshSource(resolve('vendor/dsh'),'candidate'),...identities.snapshot(),
  lockSha256:sha256(await readFile('upstreams.lock.json')),
  assets:await assetIdentities(resolve('vendor/projection-fixture'),['controls/client.js','controls/index.js','controls/package.json',
    'navigation/client.js','navigation/index.js','navigation/package.json'])};
await writeFile(resolve('vendor/projection-fixture/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({...manifest,inputs:manifest.sourceInputs+' per-file identities retained'}));
