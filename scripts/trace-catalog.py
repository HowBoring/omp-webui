"""Real Linux candidate catalog syscall trace over synthetic data, never a real profile."""
import hashlib,json,os,subprocess,tempfile
from pathlib import Path
root=Path.cwd()
out=root/'vendor/catalog-evidence'
out.mkdir(parents=True,exist_ok=True)
bun=os.environ['BUN_EXECUTABLE']
with tempfile.TemporaryDirectory(prefix='catalog-trace-') as home:
    profile=Path(home)
    source=profile/'.omp/agent/sessions/bucket'
    source.mkdir(parents=True)
    (source/'native.jsonl').write_text(json.dumps({'type':'session','version':3,'id':'trace-native',
        'timestamp':'2026-01-01T00:00:00Z','cwd':'/synthetic-missing-project','title':'Trace fixture'})+'\n')
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
    assert page['items'][0]['nativeSessionId']=='trace-native' and page['status']=='complete'
    summary={'kind':'actual-native-readonly-catalog-file-process-and-socket-trace','result':'PASS',
        'fixture':'synthetic header in isolated temporary HOME/cwd; no actual user profile',
        'frames':[frame['type'] for frame in frames],'exitCode':result.returncode,'stderrBytes':len(result.stderr),
        'traceLines':len(lines),'unsafeWriteOrOrdinarySessionImportObservations':unsafe,
        'bindSyscalls':len(binds),'nonUnixConnectSyscalls':len(network),
        'nativeLeaseObservationConnects':sum('connect(' in line for line in lines),
        'execveCount':sum('execve(' in line for line in lines),
        'traceSha256':hashlib.sha256(trace.read_bytes()).hexdigest()}
    (out/'trace-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary))
