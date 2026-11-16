"""Retain sanitized summaries; full bundles/logs/traces stay in ignored vendor outputs."""
import hashlib, json
from pathlib import Path

root=Path.cwd();destination=root/'apps/interactions/evidence'
destination.mkdir(parents=True,exist_ok=True)
sha=lambda data:hashlib.sha256(data).hexdigest()
identity=json.loads((root/'packages/contracts/generated/identity.ts').read_text().split(' = ',1)[1].strip().rstrip(';'))
counts=[]
for directory,name,expected in [('interactions-browser-final','linux-browser',10),
                       ('interactions-browser-configured-final','configured-browser',11)]:
    source=root/'vendor'/directory
    result=json.loads((source/'summary.json').read_text())
    assert result['status']=='PASS' and result['OMP']==identity and len(result['cases'])==expected
    counts.append(len(result['cases']))
    for kind,directory in [('Host','host-interactions'),('DSH','dsh-interactions')]:
        assert result[kind]==json.loads((root/'vendor'/directory/'manifest.json').read_text())
    native=json.loads((source/'host.log').read_text().splitlines()[-1])
    assert native['code']==0 and not native['forced'] and native['stdoutDrained'],native
    aborts=sum(item=={'type':'abort','outcome':'acknowledged'} for item in native['commands'])
    assert aborts>=2,aborts
    result['nativeWorker']={'code':native['code'],'forced':native['forced'],
       'stdoutDrained':native['stdoutDrained'],'stderrBytes':native['stderrBytes'],
       'acknowledgedAbortCommands':aborts}
    for kind in ['Host','DSH']:
        manifest=result[kind]
        if isinstance(manifest.get('inputs'),list):
            manifest['inputSetSha256']=sha(json.dumps(manifest['inputs'],sort_keys=True,separators=(',',':')).encode())
            manifest['inputs']=len(manifest['inputs'])
    result['rawArtifacts']={filename:sha((source/filename).read_bytes())
       for filename in ['summary.json','host.log','trace.zip','root-Slot.png']}
    (destination/(name+'.json')).write_text(json.dumps(result,indent=2)+'\n')
trace=json.loads((root/'vendor/interactions-native-evidence/trace-summary.json').read_text())
assert trace['status']=='PASS' and trace['OMP']==identity and trace['inetDispatchSyscalls']==0
(destination/'native-trace.json').write_text(json.dumps(trace,indent=2)+'\n')
tuple={'kind':'ticket33-isolated-explicit-interaction-linux-candidate','OMP':identity,
  'nativeSourceFreeze':'13fd5508440af24e877ec9cbb607e983962b1bc2','orderedPatches':[
    {'file':path.name,'sha256':sha(path.read_bytes())} for path in sorted((root/'compatibility/omp').glob('*.patch'))],
  'Host':json.loads((destination/'linux-browser.json').read_text())['Host'],
  'DSH':json.loads((destination/'linux-browser.json').read_text())['DSH'],
  'sourceManifestSha256':{path:sha((root/path).read_bytes()) for path in [
    'vendor/host-interactions/manifest.json','vendor/dsh-interactions/manifest.json',
    'tests/interactions/no-provider.ts','tests/interactions/native-extension.ts',
    'tests/interactions/native-core-loop.ts','tests/interactions/native-client.ts','bun.lock']}}
(destination/'tuple.json').write_text(json.dumps(tuple,indent=2)+'\n')
print(json.dumps({'status':'retained','browserCases':counts,'nativeInetDispatchSyscalls':trace['inetDispatchSyscalls']}))
