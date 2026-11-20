#!/usr/bin/env python3
"""Source-only proof: compile, preprocess, compare private code generation; never execute a built target."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASE = "5608b676da265c59870949425367b6e980643609"
CONFIGURATION = '''#define OMP_DISPATCHER_PATH "/tmp/not-opened-dispatcher.sock"
#define OMP_INSTALLATION_ID "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
#define OMP_NATIVE_ENTRY "/not-launched/bin/omp"
#define OMP_CONTROL_PATH "/not-opened/control"
#define OMP_CONTROL_DEVICE UINTMAX_C(1)
#define OMP_CONTROL_INODE UINTMAX_C(1)
#define OMP_FENCE_PATH "/not-opened/fences"
#define OMP_FENCE_DEVICE UINTMAX_C(1)
#define OMP_FENCE_INODE UINTMAX_C(1)
'''


def run(arguments, **kwargs):
    return subprocess.run(arguments, cwd=ROOT, check=True, capture_output=True, **kwargs).stdout


def main():
    sources = ["compatibility/supervision/external-protector.c", "compatibility/supervision/private-helper.c",
               "compatibility/supervision/candidates.h", "compatibility/launcher/control.h"]
    with tempfile.TemporaryDirectory(prefix="omp-external-static-") as temporary:
        directory = Path(temporary)
        header = directory / "configuration.h"
        header.write_text(CONFIGURATION)
        compiler = ["/usr/bin/gcc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2", "-include", str(header)]
        for name in ["external-protector", "private-helper"]:
            run(compiler + ["-static", f"compatibility/supervision/{name}.c", "-o", str(directory / name)])
        preprocessed = run(compiler + ["-E", "-P", sources[0]]).decode()
        excluded = ["static int signal_child(", "static int signal_candidates(", "static void escalation(",
                    "static void begin_mandatory(", "static int candidate_open(", "static int candidate_next(",
                    '"FORCE"', '"MANDATORY"', '"ORDINARY_STOP"']
        for text in excluded:
            if text in preprocessed:
                raise RuntimeError("external policy contains a private policy definition")
        before = run(["git", "show", f"{BASE}:{sources[1]}"])
        assembly = compiler + ["-S", "-I", str(ROOT / "compatibility/supervision"), "-x", "c", "-", "-o", "-"]
        old = run(assembly, input=before)
        new = run(assembly, input=(ROOT / sources[1]).read_bytes())
        if old != new:
            raise RuntimeError("private policy generated assembly changed against the frozen base")
        print(json.dumps({"scope": "source-only; built targets never executed", "privateBase": BASE,
                          "strictStaticCompiles": 2, "externalPrivateDefinitionsExcluded": len(excluded),
                          "privateAssemblyIdentical": True, "privateAssemblySha256": hashlib.sha256(new).hexdigest(),
                          "configurationSha256": hashlib.sha256(CONFIGURATION.encode()).hexdigest(),
                          "sourceDigests": {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
                                            for path in sources}}, indent=2))


if __name__ == "__main__":
    main()
