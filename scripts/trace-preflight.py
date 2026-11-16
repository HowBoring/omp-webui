"""Linux-only actual public candidate trace; no real user profile is used."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path.cwd()
output = root / "vendor/native-evidence"
output.mkdir(parents=True, exist_ok=True)
bun = os.environ.get("BUN_EXECUTABLE") or shutil.which("bun")
if not bun:
    raise SystemExit("Put the selected Bun executable on PATH or set BUN_EXECUTABLE")
with tempfile.TemporaryDirectory(prefix="omp-s0-trace-") as profile:
    trace = output / "preflight.strace"
    result = subprocess.run([
        "/usr/bin/strace", "-f", "-e", "trace=%file,process", "-o", str(trace),
        bun, "--no-env-file", str(root / "vendor/omp-candidate/cli.js"), "--rpc-preflight",
    ], cwd=profile, env={"HOME": profile, "PI_CODING_AGENT_DIR": profile, "TMPDIR": profile},
        input='{"id":"n","type":"negotiate_protocol","protocolVersion":2}\n'
              '{"id":"c","type":"get_compatibility"}\n',
        text=True, capture_output=True, timeout=10)
    lines = trace.read_text().splitlines()
    unsafe = [line for line in lines if any(value in line for value in
              ["cli-runtime.ts", "session-manager", "O_CREAT", "/.omp/", "/home/"])]
    frames = [json.loads(line) for line in result.stdout.splitlines()]
    assert result.returncode == 0 and result.stderr == "" and len(frames) == 3
    assert not unsafe and os.listdir(profile) == []
    summary = {
        "kind": "actual-candidate-preflight-file-process-trace", "exitCode": 0,
        "stderrBytes": 0, "frames": [frame["type"] for frame in frames], "profileEntries": [],
        "traceLines": len(lines), "unsafeFileOrOrdinaryRuntimeImportObservations": [],
        "syntheticCwdHousekeeping": ["getcwd", "absent bunfig.toml probe", "directory read"],
        "execveCount": sum("execve(" in line for line in lines),
        "rawTraceSha256": hashlib.sha256(trace.read_bytes()).hexdigest(),
    }
    (output / "trace-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary))
