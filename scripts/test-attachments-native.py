"""Run the native conversion seam with a pre-import network guard and a private synthetic profile."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
bun = Path("/workspace/work/rpc-public-module-probe/tooling/bun/package/bin/bun")
with tempfile.TemporaryDirectory(prefix="omp-attachment-") as profile:
    env = {
        "PATH": f"{bun.parent}:/usr/bin:/bin", "HOME": profile, "PI_CODING_AGENT_DIR": profile,
        "OMP_HISTORY_FIXTURE_PROFILE": profile, "TMPDIR": profile, "OMP_OFFLINE": "1",
    }
    result = subprocess.run([
        str(bun), "test", "--timeout", "30000", "--preload", str(root / "compatibility/omp/fixtures/history-network-guard.js"),
        *(sys.argv[1:] or ["compatibility/omp/fixtures/attachment-native.test.js"]),
    ], cwd=root, env=env)
    audit = json.loads(Path(profile, "network-audit.json").read_text())
    if audit["actualNetworkDispatches"] != 0:
        raise RuntimeError("attachment_fixture_network_dispatched")
    raise SystemExit(result.returncode)
