"""Pure Root-frozen manifest admission boundary. Never imports retainer/ctypes or executes launch/kernel code."""
import ast
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[2] / "scripts/retain-native-signed-probe.py"
tree = ast.parse(SOURCE.read_text())
selected = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in {
    "digest", "verify_ready", "input_owner_matches"} or isinstance(node, ast.Assign)
    and any(isinstance(target, ast.Name) and target.id in {"PYTHON", "SYSTEM_INPUTS"} for target in node.targets)]
scope = {"__file__": str(SOURCE), "Path": Path, "hashlib": hashlib, "json": json, "os": os, "stat": stat, "sys": sys}
exec(compile(ast.Module(body=selected, type_ignores=[]), str(SOURCE), "exec"), scope)


class ReadyManifestTest(unittest.TestCase):
    def setUp(self):
        self.stage = Path(tempfile.mkdtemp(prefix="native-signed-probe-ready-unit-"))
        names = ["launch/bin/omp", "launch/runtime/bun", "launch/runtime/bunfig.toml", "launch/runtime/no-provider.js",
                 "launch/worker/cli.js", "launch/components/release.json", "operator/anchor.json", "operator/approval.json",
                 "operator/key.json", "control", "home/fixture-marker.json"]
        for name in names:
            file = self.stage / name
            file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            file.write_text("fixture-only-never-executed")
            file.chmod(0o600)
        (self.stage / "home/state/fences").mkdir(parents=True, mode=0o700)
        (self.stage / "home/fixture-marker.json").write_text(json.dumps({"kind": "native-signed-probe/1", "privateData": False}))
        libc = Path("/usr/lib/x86_64-linux-gnu/libc.so.6")
        closure = {"format": "omp-native-signed-probe-launch/1", "members": [
            {"path": name.removeprefix("launch/"), "kind": "file"} for name in names if name.startswith("launch/")],
                   "platformDependencies": [{"path": str(libc), "kind": "file"}]}
        (self.stage / "launch/launch-closure.json").write_text(json.dumps(closure))
        files = [self.stage / name for name in names] + [self.stage / "launch/launch-closure.json", SOURCE,
                                                       Path(sys.executable).resolve(), libc]
        self.inputs = []
        for file in files:
            metadata = file.stat()
            self.inputs.append({"path": str(file), "device": str(metadata.st_dev), "inode": str(metadata.st_ino),
                                "uid": metadata.st_uid, "mode": stat.S_IMODE(metadata.st_mode), "sha256": scope["digest"](file)})

    def tearDown(self):
        shutil.rmtree(self.stage)

    def admit(self):
        value = {"format": "omp-native-signed-probe-ready/1", "status": "ROOT_APPROVED_ONE_RUN", "stage": str(self.stage),
                 "prepareAuthorized": False, "helperAuthorized": False, "nativeAgentAuthorized": False,
                 "privateAdmission": "BLOCKED", "globalAdmission": "BLOCKED", "inputs": self.inputs}
        file = self.stage / "READY.json"
        file.write_text(json.dumps(value))
        return scope["verify_ready"](file, scope["digest"](file))

    def test_independently_pinned_readonly_system_files_admit_without_transferring_stage_ownership(self):
        self.assertEqual(self.admit()["status"], "ROOT_APPROVED_ONE_RUN")

    def test_owned_launch_file_cannot_claim_a_system_uid(self):
        self.inputs[0]["uid"] = 0 if os.getuid() else 65534
        with self.assertRaisesRegex(RuntimeError, "PROBE_FROZEN_INPUT_CHANGED"):
            self.admit()


if __name__ == "__main__":
    unittest.main()
