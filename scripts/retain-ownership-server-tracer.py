#!/usr/bin/env python3
"""One synthetic server tracer's independent sole waiter; no process signals or PID discovery.

Adapted from the reviewed private fixture's retaining-parent policy: controlled failures keep
this subreaper alive until the kernel reports P_ALL/ECHILD. This file never owns an external root.
"""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import select
import signal
import stat
import sys
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
BUN = Path("/workspace/work/rpc-public-module-probe/tooling/bun/package/bin/bun")
PYTHON = Path("/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3")
STRACE = Path("/usr/bin/strace")
WALL = 0x40000000


def digest(file):
    value = hashlib.sha256()
    with open(file, "rb", buffering=0) as stream:
        while chunk := stream.read(65536):
            value.update(chunk)
    return value.hexdigest()


def report(value):
    try:
        print(json.dumps(value, separators=(",", ":")), flush=True)
    except BaseException:
        pass  # A lost observer pipe must not release the sole retaining parent.


def pinned(value):
    file = Path(value["path"])
    metadata = file.lstat()
    if file.resolve() != file or not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 \
            or metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) != 0o600 \
            or str(metadata.st_dev) != value["device"] or str(metadata.st_ino) != value["inode"] \
            or digest(file) != value["sha256"]:
        raise RuntimeError("TRACER_OPERATOR_PIN_CHANGED")


def verify_fixture(file, expected):
    if file.parent.parent != Path("/tmp") or not file.parent.name.startswith("ownership-server-tracer-") \
            or file.name != "fixture.json" or file.resolve() != file or file.stat().st_size > 65536 \
            or digest(file) != expected:
        raise RuntimeError("TRACER_FROZEN_SYNTHETIC_FIXTURE_REQUIRED")
    value = json.loads(file.read_text())
    if value["format"] != "omp-execution-server-tracer/1" or not value["createdSyntheticKeys"] \
            or value["autoEnrolledClientTrust"] or value["nativeExecuted"] or value["helperAuthorized"]:
        raise RuntimeError("TRACER_FIXTURE_SCOPE_CHANGED")
    inputs = value["sourceInputs"]
    if not isinstance(inputs, list) or not 1 <= len(inputs) <= 64:
        raise RuntimeError("TRACER_INPUT_LIMIT")
    declared = set()
    for item in inputs:
        name = Path(item["file"])
        if name in declared or digest(name) != item["sha256"]:
            raise RuntimeError("TRACER_DECLARED_INPUT_CHANGED")
        declared.add(name)
    for required in [Path(__file__).resolve(), BUN, PYTHON.resolve(), STRACE.resolve(),
                     ROOT / "bunfig.toml", ROOT / "compatibility/omp/fixtures/no-provider.ts",
                     file.parent / "cwd/server.test.ts"]:
        if required not in declared:
            raise RuntimeError("TRACER_REQUIRED_INPUT_ABSENT")
    if Path(sys.executable).resolve() != PYTHON.resolve():
        raise RuntimeError("TRACER_INTERPRETER_CHANGED")
    pinned(value["approval"])
    pinned(value["key"])  # Only hash/metadata: never parse or print the private signing key.
    approval = json.loads(Path(value["approval"]["path"]).read_text())
    state = file.parent / "state"
    if Path(approval["endpoint"]) != state / "socket" or Path(approval["releaseRoot"]) != file.parent / "release" \
            or Path(approval["helper"]["file"]).exists() or (state / "socket").exists() \
            or any((state / "fences").iterdir()) or digest(Path(approval["bridge"]["file"])) != approval["bridge"]["sha256"]:
        raise RuntimeError("TRACER_SYNTHETIC_INITIAL_STATE_CHANGED")
    return value


def prepare_parent():
    # Self only; this is not a process census or a descendant-extinction heuristic.
    own = Path("/proc/self/status").read_bytes()
    fields = dict(line.split(b":", 1) for line in own.splitlines() if b":" in line)
    if sys.platform != "linux" or fields.get(b"Threads", b"").strip() != b"1" \
            or fields.get(b"TracerPid", b"").strip() != b"0" \
            or fields.get(b"NSpid", b"").split() != [str(os.getpid()).encode()]:
        raise RuntimeError("TRACER_RETENTION_DOMAIN_UNSUPPORTED")
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:
        raise RuntimeError("TRACER_SUBREAPER_UNAVAILABLE")
    enabled = ctypes.c_int(0)
    if libc.prctl(37, ctypes.byref(enabled), 0, 0, 0) != 0 or enabled.value != 1:
        raise RuntimeError("TRACER_SUBREAPER_NOT_EFFECTIVE")
    signal.signal(signal.SIGCHLD, signal.SIG_DFL)
    try:
        os.waitid(os.P_ALL, 0, os.WEXITED | os.WNOHANG | WALL)
    except ChildProcessError:
        return
    raise RuntimeError("TRACER_UNEXPECTED_INITIAL_CHILD")


def fixed_launch(fixture):
    root = fixture.parent
    command = [str(STRACE), "-f", "-qq", "-e", "trace=socket,bind,listen,accept4,connect,getsockopt",
               "-o", str(root / "network.trace"), str(BUN), "test", "--no-env-file",
               "--config=" + str(ROOT / "bunfig.toml"),
               "--preload=" + str(ROOT / "compatibility/omp/fixtures/no-provider.ts"), "./server.test.ts"]
    environment = {"HOME": str(root / "home"), "PI_CODING_AGENT_DIR": str(root / "profile"), "TMPDIR": "/tmp",
                   "XDG_CONFIG_HOME": str(root / "config"), "XDG_DATA_HOME": str(root / "data"),
                   "XDG_STATE_HOME": str(root / "xdg-state"), "XDG_CACHE_HOME": str(root / "cache"),
                   "PATH": str(BUN.parent) + ":/usr/bin:/bin", "OMP_OWNERSHIP_SERVER_FIXTURE_MANIFEST": str(fixture)}
    # posix_spawn has no implicit Popen poll/wait owner; only the central P_ALL loop below reaps.
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    actions = [(os.POSIX_SPAWN_OPEN, 0, "/dev/null", os.O_RDONLY, 0),
               (os.POSIX_SPAWN_OPEN, 1, str(root / "stdout.log"), flags, 0o600),
               (os.POSIX_SPAWN_OPEN, 2, str(root / "stderr.log"), flags, 0o600)]
    os.chdir(root / "cwd")
    return os.posix_spawn(str(STRACE), command, environment, file_actions=actions)


class RetainingParent:
    def __init__(self, fixture):
        self.fixture = fixture
        self.root_pid = None
        self.root_pidfd = None
        self.root_status = None
        self.failed = False
        self.warned = False
        self.interrupted = False
        self.reaped = []
        self.reaped_count = 0
        self.began = time.monotonic()

    def retain_on_signal(self, _number, _frame):
        self.interrupted = True
        self.failed = True

    def observer_error(self):
        self.failed = True
        if not self.warned:
            self.warned = True
            report({"stage": "RETAINING_UNRESOLVED", "parentPid": os.getpid(), "signalsSent": 0})

    def launch(self):
        if self.interrupted:
            return
        try:
            self.root_pid = fixed_launch(self.fixture)
            self.root_pidfd = os.pidfd_open(self.root_pid)
            # This exact stable object must be our direct, waitable child before any later observation.
            os.waitid(os.P_PIDFD, self.root_pidfd, os.WEXITED | os.WNOHANG | os.WNOWAIT | WALL)
            report({"stage": "RETAINING_LAUNCHED", "parentPid": os.getpid(), "rootPid": self.root_pid,
                    "rootPidfdRetained": True, "signalsSent": 0})
        except BaseException:
            self.observer_error()  # Even partial launch or a lost pidfd must enter the sole wait loop.

    def drain(self):
        while True:
            try:
                information = os.waitid(os.P_ALL, 0, os.WEXITED | os.WNOHANG | WALL)
                if information is not None:
                    item = {"pid": information.si_pid, "code": information.si_code, "status": information.si_status}
                    self.reaped_count += 1
                    if len(self.reaped) < 64:
                        self.reaped.append(item)
                    else:
                        self.failed = True
                    if information.si_pid == self.root_pid:
                        self.root_status = item
                    continue
            except ChildProcessError:
                break  # Actual authoritative P_ALL/ECHILD, after closed one-launch admission.
            except BaseException:
                self.observer_error()
            try:
                if time.monotonic() - self.began > 30:
                    self.observer_error()  # Deadline is diagnostic only: no signal or elapsed-time extinction claim.
                select.select([], [], [], 0.05)
            except BaseException:
                self.observer_error()
        if self.root_pidfd is not None:
            try:
                os.close(self.root_pidfd)
            except BaseException:
                self.observer_error()
        normal = self.root_status is not None and self.root_status["code"] == os.CLD_EXITED \
            and self.root_status["status"] == 0
        result = {"stage": "DRAINED", "parentPid": os.getpid(), "rootPid": self.root_pid,
                  "kernelEndpoint": "P_ALL/ECHILD", "rootStatus": self.root_status,
                  "reaped": self.reaped, "reapedCount": self.reaped_count, "signalsSent": 0,
                  "observerFailed": self.failed, "interrupted": self.interrupted,
                  "status": "PASS" if normal and not self.failed else "FAIL"}
        try:
            destination = self.fixture.parent / "containment.json"
            with destination.open("x") as output:
                json.dump(result, output, indent=2)
                output.write("\n")
        except BaseException:
            result["status"] = "FAIL"
            result["evidenceWriteFailed"] = True
        report(result)
        return 0 if result["status"] == "PASS" else 1


def main():
    if len(sys.argv) != 3:
        raise RuntimeError("USAGE: retain-ownership-server-tracer.py <synthetic-fixture.json> <expected-sha256>")
    fixture = Path(sys.argv[1])
    verify_fixture(fixture, sys.argv[2])  # All files, tools and synthetic pins verified BEFORE any fixture process.
    prepare_parent()
    parent = RetainingParent(fixture)
    for number in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(number, parent.retain_on_signal)
    parent.launch()
    return parent.drain()


if __name__ == "__main__":
    raise SystemExit(main())
