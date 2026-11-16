"""Real Linux candidate catalog syscall trace over synthetic data, never a real profile."""
import hashlib,json,os,subprocess,tempfile
from pathlib import Path
root=Path.cwd()
out=root/'vendor/catalog-evidence'
out.mkdir(parents=True,exist_ok=True)
bun=os.environ['BUN_EXECUTABLE']
with tempfile.TemporaryDirectory(prefix='catalog-trace-') as home:
    profile=Path(home)
    fixture_code='import {sessionManagerFixture} from '+json.dumps(str(root/'tests/catalog/fixture.ts'))+'; console.log(JSON.stringify(await sessionManagerFixture(process.env.HOME)));'
    authored=subprocess.run([bun,'--no-env-file','-e',fixture_code],cwd=root,
        env={'HOME':home,'BUN_RUNTIME_TRANSPILER_CACHE_PATH':'0'},capture_output=True,text=True,timeout=20)
    assert authored.returncode==0 and not authored.stderr,authored.stderr
    native=json.loads(authored.stdout)
    trace=out/'catalog.strace'
    result=subprocess.run(['/usr/bin/strace','-f','-e','trace=%file,process,socket,bind,connect',
        '-o',str(trace),bun,'--no-env-file',str(root/'vendor/omp-candidate/cli.js'),'--rpc-catalog'],
        cwd=home,env={'HOME':home,'TMPDIR':home,'BUN_RUNTIME_TRANSPILER_CACHE_PATH':'0'},
        input='{"id":"n","type":"negotiate_protocol","protocolVersion":2}\n'
              '{"id":"s","type":"catalog_sources"}\n{"id":"p","type":"catalog_page"}\n',
        capture_output=True,text=True,timeout=10)
    lines=trace.read_text().splitlines()
    unsafe=[line for line in lines if any(word in line for word in ['O_CREAT','O_WRONLY','O_RDWR','O_TRUNC',
        'O_APPEND','mkdir(','rename(','unlink(','cli-runtime.ts','agent-session.ts','session-manager.ts','session-listing.ts'])]
    binds=[line for line in lines if 'bind(' in line]
    network=[line for line in lines if 'connect(' in line and 'AF_UNIX' not in line]
    frames=[json.loads(line) for line in result.stdout.splitlines()]
    assert result.returncode==0 and not result.stderr and not unsafe and not binds and not network,(result.stderr,unsafe,binds,network)
    page=next(frame['data'] for frame in frames if frame.get('id')=='p')
    assert {item['nativeSessionId'] for item in page['items']}=={native['id'],native['emptyId']} and page['status']=='complete'
    assert next(item for item in page['items'] if item['nativeSessionId']==native['id'])['title']=='Actual native slot title'
    summary={'kind':'actual-native-readonly-catalog-file-process-and-socket-trace','result':'PASS',
        'fixture':'two actual pinned SessionManager-authored files in isolated temporary HOME/cwd; deliberate fixture writes precede the traced readonly child; no user profile',
        'actualNativeFiles':2,
        'frames':[frame['type'] for frame in frames],'exitCode':result.returncode,'stderrBytes':len(result.stderr),
        'traceLines':len(lines),'unsafeWriteOrOrdinarySessionImportObservations':unsafe,
        'bindSyscalls':len(binds),'nonUnixConnectSyscalls':len(network),
        'nativeLeaseObservationConnects':sum('connect(' in line for line in lines),
        'execveCount':sum('execve(' in line for line in lines),
        'traceSha256':hashlib.sha256(trace.read_bytes()).hexdigest()}
    (out/'trace-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary))
