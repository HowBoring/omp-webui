"""Exercise the standalone staging CLI with the frozen offline inputs."""

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class StrictRuntimeStageTest(unittest.TestCase):
    def test_rejects_competing_ancestor_node_modules(self):
        catalog, compiler, _, bun, work = map(Path, sys.argv[1:6])
        stage = Path(__file__).with_name("stage-strict-runtime.py")
        with tempfile.TemporaryDirectory(dir=work) as scratch:
            parent = Path(scratch) / "ancestor"
            registry = parent / "registry"
            registry.mkdir(parents=True)
            os.symlink("missing", parent / "node_modules")
            output = Path(scratch) / "candidate"
            result = subprocess.run(
                [sys.executable, "-B", stage, "stage", catalog, bun, output, compiler, registry],
                env={"PATH": os.defpath}, text=True, capture_output=True,
            )
            self.assertNotEqual(result.returncode, 0, result.stdout)
            self.assertIn(f"Competing dependency directory: {parent / 'node_modules'}", result.stderr)
            self.assertFalse(output.exists())

    def test_staging_and_exact_bundle_readback(self):
        catalog, compiler, registry, bun, work = map(Path, sys.argv[1:6])
        stage = Path(__file__).with_name("stage-strict-runtime.py")
        with tempfile.TemporaryDirectory(dir=work) as scratch:
            output = Path(scratch) / "candidate"
            command = [sys.executable, "-B", str(stage)]
            inputs = [str(catalog), str(bun), str(output)]
            result = subprocess.run(
                [*command, "stage", *inputs, str(compiler), str(registry)],
                env={"PATH": os.defpath}, text=True, capture_output=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('"status": "UNREGISTERED_STRICT_RUNTIME"', result.stdout)
            worker = output / "bundle/worker.ts"
            self.assertTrue(worker.is_file(), "StrictStart requires the sibling attachment worker")
            verify = [*command, "verify", *inputs]
            verified = subprocess.run(verify, env={"PATH": os.defpath}, text=True, capture_output=True)
            self.assertEqual(verified.returncode, 0, verified.stderr)
            self.assertIn('"status": "STRICT_RUNTIME_IDENTITY"', verified.stdout)

            launcher = output / "bundle/omp"
            launcher.unlink()
            os.symlink("cli.js/", launcher)
            self.assertEqual(os.readlink(launcher), "cli.js/")
            rejected = subprocess.run(verify, env={"PATH": os.defpath}, text=True, capture_output=True)
            self.assertNotEqual(rejected.returncode, 0, rejected.stdout)
            self.assertIn("Unexpected StrictStart link target: bundle/omp", rejected.stderr)
            launcher.unlink()
            os.symlink("cli.js", launcher)

            held_worker = Path(scratch) / worker.name
            worker.rename(held_worker)
            missing = subprocess.run(verify, env={"PATH": os.defpath}, text=True, capture_output=True)
            self.assertNotEqual(missing.returncode, 0, missing.stdout)
            self.assertIn(f"Stage entries missing in {worker.parent}: ['worker.ts']", missing.stderr)
            held_worker.rename(worker)

            with worker.open("r+b") as stream:
                first = stream.read(1)
                stream.seek(0)
                stream.write(bytes([first[0] ^ 1]))
            changed = subprocess.run(verify, env={"PATH": os.defpath}, text=True, capture_output=True)
            self.assertNotEqual(changed.returncode, 0, changed.stdout)
            self.assertIn(f"File SHA-256 differs: {worker}", changed.stderr)


if __name__ == "__main__":
    if len(sys.argv) != 6:
        raise SystemExit("expected catalog, compiler, registry, Bun and scratch parent")
    unittest.main(argv=[sys.argv[0]])
