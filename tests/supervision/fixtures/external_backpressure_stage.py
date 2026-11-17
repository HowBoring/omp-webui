#!/usr/bin/env python3
"""Proposed Root-only source preparation/sealing. Never compiles or executes a target.

Source review must precede even preparation. Compilation is a separate Root-only
compiler session with the exact recipe emitted here. No runtime adapter import.
"""
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
STAGE = Path("/tmp/omp-external-current-backpressure-r17-20261117")
FIXTURES = "tests/supervision/fixtures/"
PLAN = ROOT / "docs/evidence/ticket-41-current-backpressure-source.json"
MARKER = "external-current-602f498-backpressure-r17-v1"
GENERATION = "37ac51764927b879cc9bf0256b629ae013f64400803424d2eb8ef35e2bf26c91b"
INSTALLATION = "d3f6c9e719c0fa69ce89b26ab5b4c24566c7a00bd429de9aa7c33841bbad7291"


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def durable(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC | os.O_NOFOLLOW, 0o600)
    try:
        view = memoryview(raw)
        while view:
            count = os.write(fd, view)
            require(count > 0, "STAGE_WRITE")
            view = view[count:]
        os.fsync(fd)
    finally:
        os.close(fd)
    parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def record(path, value):
    durable(path, (json.dumps(value, indent=2) + "\n").encode())


def source_pins():
    plan = json.loads(PLAN.read_bytes())
    require(plan["status"] == "SOURCE_READY_RUNTIME_NOT_RUN" and plan["marker"] == MARKER, "SOURCE_PLAN_SCOPE")
    for name, digest in plan["sourceSha256"].items():
        require(sha(ROOT / name) == digest, "SOURCE_PIN_CHANGED:" + name)
    return {str(ROOT / name): digest for name, digest in plan["sourceSha256"].items()}


def prepare():
    source_pins()
    STAGE.mkdir(mode=0o700, exist_ok=False)
    for relative in ("release", "release/bin", "fences", "home"):
        (STAGE / relative).mkdir(mode=0o700)
    durable(STAGE / "maintenance", b"")
    definitions = {"OMP_DISPATCHER_PATH": str(STAGE / "dispatcher.sock"), "OMP_INSTALLATION_ID": INSTALLATION,
                   "OMP_NATIVE_ENTRY": str(STAGE / "release/bin/omp"),
                   "OMP_CONTROL_PATH": str(STAGE / "maintenance"), "OMP_FENCE_PATH": str(STAGE / "fences")}
    configuration = "".join(f"#define {key} {json.dumps(value)}\n" for key, value in definitions.items())
    for prefix, path in (("OMP_CONTROL", STAGE / "maintenance"), ("OMP_FENCE", STAGE / "fences")):
        metadata = path.stat()
        configuration += f"#define {prefix}_DEVICE UINTMAX_C({metadata.st_dev})\n"
        configuration += f"#define {prefix}_INODE UINTMAX_C({metadata.st_ino})\n"
    durable(STAGE / "configuration.h", configuration.encode())
    durable(STAGE / "root.c", (ROOT / (FIXTURES + "external-backpressure-root.c")).read_bytes())
    durable(STAGE / "root-marker", (MARKER + "\n").encode())
    compiler = ["/usr/bin/gcc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2", "-static"]
    record(STAGE / "compiler-recipe.json", {
        "compilerEnvironment": {"PATH": "/usr/bin:/bin"}, "compilerSha256": sha(Path("/usr/bin/gcc")),
        "commands": [compiler + [str(STAGE / "root.c"), "-o", str(STAGE / "release/bin/omp")],
                     compiler + ["-include", str(STAGE / "configuration.h"),
                                 str(ROOT / "compatibility/supervision/external-protector.c"),
                                 "-o", str(STAGE / "release/bin/omp-external-protector")]],
        "targetExecution": "FORBIDDEN_DURING_PREPARATION"})
    record(STAGE / "raw-input.json", {
        "argv": [str(STAGE / "release/bin/omp-external-protector"), GENERATION],
        "fd3": "original connected AF_UNIX stream; SO_SNDBUF4096; same-queue retained duplicate",
        "stdin": "X only after exact START/running", "completionAck": "held after exact ROOT_EXIT generation 0 0",
        "filler": "4096-byte ! chunks, positive <1MiB, actual EAGAIN", "heldSeconds": 0.25,
        "lineLimit": 512, "ioSeconds": 5, "sampledOuterSecondsAfterBusiness": 20,
        "completion": "close fixture duplicate; exact filler; exact COMPLETE; EOF; original wait0; readers EOF; ECHILD",
        "recovery": "fresh Root post-HOLD command only; original guardian pidfd SIGKILL once only after START+natural ROOT_EXIT0",
        "epipe": "NOT_IMPLEMENTED_NOT_RUN", "authentication": "SYNTHETIC_PEER_NO_NATIVE_OR_GLOBAL_AUTHORITY"})
    print("SOURCE_PREPARED_NOT_COMPILED_NOT_RUN", flush=True)


def seal():
    pins = source_pins()
    pins[str(PLAN)] = sha(PLAN)
    for name in ("root.c", "configuration.h", "root-marker", "raw-input.json", "compiler-recipe.json",
                 "release/bin/omp", "release/bin/omp-external-protector"):
        pins[str(STAGE / name)] = sha(STAGE / name)
    recipe = json.loads((STAGE / "compiler-recipe.json").read_bytes())
    require(recipe["compilerSha256"] == sha(Path("/usr/bin/gcc")), "COMPILER_CHANGED")
    require(not (STAGE / "used-once.jsonl").exists(), "STAGE_ALREADY_USED")
    record(STAGE / "manifest.json", {
        "status": "READY_NOT_RUN", "marker": MARKER, "generation": GENERATION, "case": "backpressure",
        "baseCommit": "602f4988c7e09b8d3d7d708b07fc36e4516b560a", "cwd": str(ROOT),
        "compilerRecipe": recipe, "pythonSha256": sha(Path("/usr/bin/python3")),
        "runnerEnvironment": {"PATH": "/usr/bin:/bin", "HOME": str(STAGE / "home"), "TMPDIR": "/tmp", "LC_ALL": "C"},
        "helperEnvironment": {"PATH": "/usr/bin:/bin", "HOME": str(STAGE / "home"), "TMPDIR": "/tmp", "LC_ALL": "C",
                              "OMP_EXECUTION_BROKER_GENERATION": GENERATION,
                              "OMP_EXECUTION_BROKER_SCOPE": '{"kind":"project","directory":"/tmp"}'},
        "members": pins, "productAdmission": "BLOCKED", "runtime": "NOT_RUN"})
    print("UNSIGNED_ARTIFACT_REVIEW_REQUIRED manifestSha256=" + sha(STAGE / "manifest.json"), flush=True)


def main():
    require(sys.argv[1:] in (["--prepare-source", MARKER], ["--seal-unsigned", MARKER]), "EXACT_ROOT_STAGING_ONLY")
    if sys.argv[1] == "--prepare-source":
        prepare()
    else:
        seal()


if __name__ == "__main__":
    main()
