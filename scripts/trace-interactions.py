"""Actual isolated native interaction syscall proof; browser loopback proof is separate."""
import hashlib, json, os, subprocess, tempfile
from pathlib import Path

root=Path.cwd()
out=root/'vendor/interactions-native-evidence'
out.mkdir(parents=True,exist_ok=True)
bun=os.environ['BUN_EXECUTABLE']
with tempfile.TemporaryDirectory(prefix='interaction-trace-') as home:
    trace=out/'native.strace'
    result=subprocess.run(['/usr/bin/strace','-f','-e','trace=network,process','-o',str(trace),
        bun,'--no-env-file','test','tests/interactions'],cwd=root,
        env={'HOME':home,'TMPDIR':home,'PATH':str(Path(bun).parent)+':/usr/bin:/bin',
             'PI_CODING_AGENT_DIR':home+'/profile','XDG_CONFIG_HOME':home+'/config',
             'XDG_CACHE_HOME':home+'/cache','BUN_RUNTIME_TRANSPILER_CACHE_PATH':'0'},
        capture_output=True,text=True,timeout=100)
    (out/'test-output.txt').write_text(result.stdout+result.stderr)
    lines=trace.read_text().splitlines()
    inet=[line for line in lines if ('AF_INET' in line or 'AF_INET6' in line)]
    dispatch=[line for line in inet if any(call in line for call in ['connect(','sendto(','sendmsg(','sendmmsg('])]
    assert result.returncode==0,(result.stdout,result.stderr)
    assert not dispatch,dispatch
    summary={'kind':'actual-native-interaction-worker-process-network-trace','status':'PASS',
      'scope':'synthetic profiles; guarded public rpc-ui workers; no real provider/model calls',
      'exitCode':result.returncode,'traceLines':len(lines),
      'inetSyscalls':len(inet),'inetDispatchSyscalls':len(dispatch),
      'unixSocketpairs':sum('socketpair(AF_UNIX' in line for line in lines),
      'execveCount':sum('execve(' in line for line in lines),
      'guardBoundaryInjectedAttempts':15,
      'publicClientBlockedMetadataAttempts':3,'actualSdkLoopBlockedMetadataAttempts':3,
      'attemptCountEvidence':'asserted by native-client.ts/native-core-loop.ts stderr observers; injected guard tests are separate',
      'traceSha256':hashlib.sha256(trace.read_bytes()).hexdigest(),
      'testOutputSha256':hashlib.sha256((out/'test-output.txt').read_bytes()).hexdigest(),
      'OMP':json.loads((root/'packages/contracts/generated/identity.ts').read_text().split(' = ',1)[1].strip().rstrip(';'))}
    (out/'trace-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary))
