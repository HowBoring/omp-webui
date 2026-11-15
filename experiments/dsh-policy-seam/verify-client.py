"""Run the affected upstream Client suites; never select Host/model/browser-replay suites."""
import json
import subprocess
import sys
from pathlib import Path

upstream = Path(sys.argv[1]).resolve()
evidence = Path(sys.argv[2]).resolve()
evidence.mkdir(parents=True, exist_ok=True)
roots = [
    'packages/api/session-controller/tests', 'packages/api/workspace-controller/tests',
    'packages/client/ui-workspace/tests', 'packages/client/modules/tests',
    'packages/client/ui-conversation/tests',
]
paths = sorted(str(p.relative_to(upstream)) for root in roots for p in (upstream / root).rglob('*')
               if '.client.spec.' in p.name)
if not paths:
    raise SystemExit('No Client specifications found')
command = ['corepack', 'pnpm', 'exec', 'vitest', 'run', *paths]
with (evidence / 'client-tests.log').open('w') as log:
    result = subprocess.run(command, cwd=upstream, stdout=log, stderr=subprocess.STDOUT)
(evidence / 'client-test-selection.json').write_text(json.dumps({
    'command': command, 'files': len(paths), 'exitCode': result.returncode,
}, indent=2) + '\n')
print(json.dumps({'files': len(paths), 'exitCode': result.returncode}))
raise SystemExit(result.returncode)
