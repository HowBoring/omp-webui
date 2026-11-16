"""Read-only final source/artifact/native evidence admission; writes only the resulting report."""
import gzip,hashlib,json,os,re,shutil,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
os.chdir(ROOT)
HERE=Path('experiments/projection-seam')
def read(path):return json.loads(Path(path).read_text())
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
bun=shutil.which('bun')
if not bun:raise SystemExit('Bun 1.4.4 must be on PATH')
def execute(argv):return subprocess.check_output(argv,text=True).strip()
source=json.loads(execute([bun,'--no-env-file','scripts/dsh-source.ts','vendor/dsh']))
record=json.loads(execute([bun,'--no-env-file','-e',"import {readClientBuildRecord} from './vendor/dsh/scripts/client-build-environment.ts'; console.log(JSON.stringify(readClientBuildRecord(process.cwd()+'/vendor/dsh')))"]))
closure=json.loads(execute([bun,'--no-env-file','-e',"import {verifyProjectionNative} from './experiments/projection-seam/native-identity.ts'; console.log(JSON.stringify(await verifyProjectionNative()))"]))
patches=read('compatibility/dsh/patches.json')
for patch in patches['patches']:assert sha(Path('compatibility/dsh')/patch['path'])==patch['sha256']
assert source['sourceTree']==patches['patches'][-1]['treeAfter']
assert source['sourceHead']==source['baseCommit']==patches['baseCommit']
fixture=read('vendor/projection-fixture/manifest.json')
assert fixture['dshSource']==source and fixture['sourceInputs']==len(fixture['inputs'])
browser={};served={}
for folder,count in [('evidence',13),('native-evidence',6)]:
    base=HERE/folder
    assert read(base/'source.json')==source
    assert read(base/'fixture-build.json')==fixture
    report=read(base/'browser.json')
    assert len(report['checks'])==count and not report['pageErrors'] and not report['consoleErrors']
    browser[folder]={'checks':count,'platform':report['platform'],'chromium':report['chromium'],'reportSha256':sha(base/'browser.json')}
    served[folder]=read(base/'served-assets.json')
assert served['evidence']==served['native-evidence']
performance=read(HERE/'evidence/performance.json')
assert performance['fixedSourceTree']==source['sourceTree']
assert performance['measurement']['order'].startswith('reviewed/fixed pairs')
assert performance['reviewedSourceTree']=='89f725caab557041ab8ad5fb97ce4d296c1f6c92'
assert performance['algorithms']['fixed']['sourceFileSha256']==sha('vendor/dsh/packages/api/session-controller/src/client/sessions/projection-store.ts')
for algorithm in performance['algorithms'].values():
    assert len(algorithm['samples'])==7
    assert all(sample['gcAvailable'] and sample['finalPhase']=='rebuilding' for sample in algorithm['samples'])
native=read(HERE/'native-evidence/browser.json')
assert native['before']['closure']==closure
assert native['answeredWhileFailed']
assert native['joiningAfterRecovery']['projection']['phase']=='ready'
assert native['joiningAfterRecovery']['bindingStable']
assert len(native['states'])==3
assert all(state['projection']['binding']['generation']==native['afterRewind']['projection']['generation'] for state in native['states'])
identity=closure['build']
for field,value in identity.items():assert native['before']['preflight'][field]==value
for other in ['afterContextChange','afterRewind']:
    assert native['before']['process']==native[other]['process']
    assert native['before']['sessionId']==native[other]['sessionId']
    assert native['before']['cut']['workerId']==native[other]['cut']['workerId']
closed=read(HERE/'native-evidence/native-closed.json')
trace=gzip.decompress((HERE/'native-evidence/native.network.strace.gz').read_bytes())
assert hashlib.sha256(trace).hexdigest()==closed['traceSha256']
assert not re.search(rb'connect\(.*sa_family=AF_INET6?\b',trace)
assert not re.search(rb'send(to|msg)\(.*sa_family=AF_INET6?\b',trace)
native_pid=json.loads(native['before']['process']['message'])['pid']
assert re.search(str(native_pid).encode()+rb'\s+\+\+\+ exited with 0 \+\+\+',trace)
assert native['afterContextChange']['interaction']['pending'][0]==native['nativeQuestion']
assert native['afterContextChange']['state']['isStreaming'] and not native['afterContextChange']['state']['isSettled']
assert closed['drain']['code']==0 and not closed['drain']['forced'] and not closed['drain'].get('protocolFailure')
assert closed['audit']['actualNetworkDispatches']==closed['inetConnects']==closed['inetSends']==0
checks=[
 ('artifacts-final.log','complete DSH artifact build',8),('aggregate-final.log','Host and Client aggregate checks',2),
 ('affected-final.log','affected DSH regression suites',760),('root-regressions.log','native live and InteractionBridge regressions',12),
 ('lint-final.log','changed DSH TypeScript lint',None),('jsdoc-final.log','global DSH exported API JSDoc',None),
 ('translation-final.log','paired DSH documentation checks',6),('root-types.log','Host workspace typecheck',None),
 ('root-build.log','Host build',None),('native-types.log','fixture and native public API typecheck',None),
]
dsh_tests=[
 'packages/api/session-controller/tests/'+name+'.client.spec.ts' for name in
 ['projection-rebuild','sessions-service','manager','transport','session-pending-submissions','projection-store','assistant-stream','scope','session','client-apply','reference-ownership']
]+['packages/client/ui-conversation/tests/semantic-drafts.client.spec.ts','packages/client/ui-conversation/tests/conversation-registry.client.spec.ts',
   'packages/client/ui-session/tests/ui-session.client.spec.ts','packages/client/ui-chat/tests/chat-store.client.spec.ts',
   'packages/client/ui-workspace/tests/workspaces-service.client.spec.ts']
changed_ts=execute(['git','-C','vendor/dsh','diff','--name-only','c0b09e15c170a82894608c397a363a7a96e5d05c']).splitlines()
changed_ts=[name for name in changed_ts if name.endswith(('.ts','.tsx'))]
pairs=['docs/subsystems/conversation.md','docs/subsystems/web-client.md','packages/api/session-controller/README.md',
       'packages/client/ui-conversation/README.md','packages/client/ui-chat/README.md','packages/test-support/client-runtime/README.md']
command_args={
 'artifacts-final.log':['node','--import','tsx/esm','scripts/build.ts','--scope','artifacts','--serial'],
 'aggregate-final.log':['node','--import','tsx/esm','scripts/build.ts','--scope','check','--serial'],
 'affected-final.log':['node','node_modules/vitest/vitest.mjs','run',*dsh_tests,'--maxWorkers=2','--reporter=dot'],
 'root-regressions.log':['bun','test','tests/live/projection.test.ts','tests/live/settlement.test.ts','tests/interactions/bridge.test.ts'],
 'lint-final.log':['node','--import','tsx/esm','scripts/run-oxlint.ts',*changed_ts],
 'jsdoc-final.log':['node','--import','tsx/esm','scripts/verify-export-jsdoc.ts'],
 'translation-final.log':['node','--import','tsx/esm','scripts/verify-translation-pairing.ts',*pairs],
 'root-types.log':['bun','run','typecheck'],'root-build.log':['bun','run','build'],
 'native-types.log':['bun','x','--no-install','tsc','-p','experiments/projection-seam/tsconfig.json'],
}
commands=[]
for file,name,count in checks:
    path=Path('/tmp/t40-review')/file
    commands.append({'name':name,'status':'pass','exitCode':0,'count':count,'originalLog':str(path),'originalLogTracked':False,'sha256':sha(path),'argv':command_args[file],'cwd':'.' if file.startswith(('root-','native-')) else 'vendor/dsh'})
files={str(path):sha(path) for path in sorted(HERE.rglob('*')) if path.is_file()
       and not {'evidence','native-evidence','__pycache__'}&set(path.relative_to(HERE).parts)}
report={'issue':40,'scope':'isolated synthetic component; product/private Session admission blocked',
 'integrationParent':execute(['git','merge-base','HEAD','mvp/spec-29']),'dshSource':source,'clientArtifacts':record,'fixtureBuild':fixture,
 'browser':browser,'servedAssets':served,'nativeClosure':closure,'nativeShutdown':closed,'nativeExecutionPid':native_pid,
 'rawNativeTrace':{'file':str((ROOT/HERE/'native-evidence/native.network.strace.gz').resolve()),'tracked':False,'compressedSha256':sha(HERE/'native-evidence/native.network.strace.gz'),'decompressedSha256':closed['traceSha256']},
 'developmentRed':[{'originalLog':str(Path('/tmp/t40-review')/file),'tracked':False,'sha256':sha(Path('/tmp/t40-review')/file),'status':'expected failure before review fix'} for file in ['budget-red.log','native-red.log','control-recovery-red.log','native-recovery-red.log','control-withdraw-red.log']],'checks':commands,'originalProjectionRed':{'originalLog':'/tmp/t40/reconnect-red.log','tracked':False,'sha256':sha('/tmp/t40/reconnect-red.log'),'status':'historical expected failure before original #40 control-baseline fix'},'fixtureSources':files,
 'rawCaptureProvenance':[{'file':str((ROOT/HERE/folder/name).resolve()),'tracked':False,'sha256':sha(HERE/folder/name)} for folder in ['evidence','native-evidence'] for name in ['server.json','calls.json']],
 'performance':{'report':'experiments/projection-seam/evidence/performance.json','sha256':sha(HERE/'evidence/performance.json'),'scoredSamplesPerAlgorithm':5},
 'buildRuntime':{'node':'24.22.1','bun':'1.4.4','npm_config_verify_deps_before_run':'false','npm_config_verifydepsbeforerun':'false','executionLogsTracked':False},
 'limits':['Native cuts and navigation remain not_attested; durable navigation belongs to #37.',
           'The fixed in-process provider is literal synthetic output, not real AI inference.',
           'Product Broker/admission, private Sessions, global installation and Windows/WSL2 acceptance are separate work.']}
(HERE/'evidence/validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'sourceTree':source['sourceTree'],'artifacts':record['artifacts'],'browser':browser,'nativeNetworkDispatches':0,'checks':len(checks)}))
