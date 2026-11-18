"""Exercise the standalone staging CLI with the frozen offline inputs."""

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class StrictRuntimeStageTest(unittest.TestCase):
    def test_staging_and_readback(self):
        catalog, compiler, registry, bun, work = map(Path, sys.argv[1:6])
        stage = Path(__file__).with_name("stage-strict-runtime.py")
        with tempfile.TemporaryDirectory(dir=work) as scratch:
            output = Path(scratch) / "candidate"
            command = [sys.executable, "-B", str(stage)]
            inputs = [str(catalog), str(bun), str(output)]
            result = subprocess.run([*command, "stage", *inputs, str(compiler), str(registry)], env={"PATH": os.defpath}, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('"status": "UNREGISTERED_STRICT_RUNTIME"', result.stdout)
            verified = subprocess.run(
                [*command, "verify", *inputs], env={"PATH": os.defpath}, text=True, capture_output=True
            )
            self.assertEqual(verified.returncode, 0, verified.stderr)
            self.assertIn('"status": "STRICT_RUNTIME_IDENTITY"', verified.stdout)


if __name__ == "__main__":
    if len(sys.argv) != 6:
        raise SystemExit("expected catalog, compiler, registry, Bun and scratch parent")
    unittest.main(argv=[sys.argv[0]])
