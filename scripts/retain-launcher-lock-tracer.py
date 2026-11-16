#!/usr/bin/env python3
"""Direct unchanged C launcher -> actual Bun retention fixture; independent sole waiter, zero signals."""
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
WALL = 0x40000000
PYTHON = Path("/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3")


def sha(file):
    value = hashlib.sha256()
    with open(file, "rb", buffering=0) as stream:
        while chunk := stream.read(65536):
            value.update(chunk)
    return value.hexdigest()


def report(value):
    try:
        print(json.dumps(value, separators=(",", ":")), flush=True)
    except BaseException:
        pass


def verify(file, expected):
    if file.parent.parent != Path("/tmp") or not file.parent.name.startswith("launcher-lock-tracer-") \
            or file.name != "fixture.json" or file.resolve() != file or file.stat().st_size > 65536 or sha(file) != expected:
        raise RuntimeError("LOCK_TRACER_FROZEN_FIXTURE_REQUIRED")
    value = json.loads(file.read_text())
    if value["format"] != "omp-launcher-lock-tracer/1" or value["executed"] or value["locksProbed"]:
        raise RuntimeError("LOCK_TRACER_SCOPE_CHANGED")
    if Path(sys.executable).resolve() != PYTHON.resolve():
        raise RuntimeError("LOCK_TRACER_INTERPRETER_CHANGED")
    if not 1 <= len(value["sourceInputs"]) <= 64:
        raise RuntimeError("LOCK_TRACER_INPUT_LIMIT")
    names = set()
    for item in value["sourceInputs"]:
        path = Path(item["file"])
        metadata = path.lstat()
        if path in names or path.resolve() != path or not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 \
                or metadata.st_size != item["bytes"] or sha(path) != item["sha256"] \
                or stat.S_IMODE(metadata.st_mode) != item["mode"] or str(metadata.st_dev) != item["device"] \
                or str(metadata.st_ino) != item["inode"]:
            raise RuntimeError("LOCK_TRACER_DECLARED_INPUT_CHANGED")
        names.add(path)
    release = file.parent / "release"
    for field, member in [("entry", "bin/omp"), ("runtime", "runtime/bun"), ("worker", "worker/cli.js")]:
        if Path(value[field]) != release / member or Path(value[field]) not in names:
            raise RuntimeError("LOCK_TRACER_CANONICAL_MEMBER_CHANGED")
    if Path(__file__).resolve() not in names or PYTHON.resolve() not in names or Path(value["probe"]) not in names:
        raise RuntimeError("LOCK_TRACER_REQUIRED_INPUT_ABSENT")
    control = value["control"]
    metadata = Path(control["path"]).lstat()
    if Path(control["path"]) != file.parent / "maintenance.lock" or str(metadata.st_dev) != control["device"] \
            or str(metadata.st_ino) != control["inode"] or stat.S_IMODE(metadata.st_mode) != 0o600:
        raise RuntimeError("LOCK_TRACER_CONTROL_CHANGED")
    marker = json.loads(Path(value["marker"]).read_text())
    if marker != {"kind": "launcher-lock-synthetic-home/1", "privateData": False}:
        raise RuntimeError("LOCK_TRACER_SYNTHETIC_HOME_REQUIRED")
    return value


def prepare_parent():
    fields = dict(line.split(b":", 1) for line in Path("/proc/self/status").read_bytes().splitlines() if b":" in line)
    if sys.platform != "linux" or fields.get(b"Threads", b"").strip() != b"1" \
            or fields.get(b"TracerPid", b"").strip() != b"0" \
            or fields.get(b"NSpid", b"").split() != [str(os.getpid()).encode()]:
        raise RuntimeError("LOCK_TRACER_PARENT_DOMAIN_UNSUPPORTED")
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:
        raise RuntimeError("LOCK_TRACER_SUBREAPER_UNAVAILABLE")
    enabled = ctypes.c_int(0)
    if libc.prctl(37, ctypes.byref(enabled), 0, 0, 0) != 0 or enabled.value != 1:
        raise RuntimeError("LOCK_TRACER_SUBREAPER_NOT_EFFECTIVE")
    signal.signal(signal.SIGCHLD, signal.SIG_DFL)
    try:
        os.waitid(os.P_ALL, 0, os.WEXITED | os.WNOHANG | WALL)
    except ChildProcessError:
        return
    raise RuntimeError("LOCK_TRACER_UNEXPECTED_INITIAL_CHILD")


class Retainer:
    def __init__(self, file, fixture):
        self.file = file
        self.fixture = fixture
        self.children = {}
        self.pidfds = {}
        self.terminal = {}
        self.stdin = None
        self.failed = False
        self.interrupted = False
        self.admission_closed = False
        self.warned = False
        self.events = []
        self.began = time.monotonic()

    def on_signal(self, _number, _frame):
        self.interrupted = self.failed = True

    def failure(self):
        self.failed = True
        if not self.warned:
            self.warned = True
            report({"stage": "LOCK_TRACER_RETAINING", "parentPid": os.getpid(), "signalsSent": 0})

    def spawn(self, role, command, piped=False):
        if self.admission_closed or self.interrupted or len(self.children) >= 4:
            raise RuntimeError("LOCK_TRACER_ADMISSION_CLOSED")
        root = self.file.parent
        environment = {"HOME": self.fixture["syntheticHome"], "PI_CODING_AGENT_DIR": str(root / "profile"),
                       "XDG_CONFIG_HOME": str(root / "config"), "XDG_DATA_HOME": str(root / "data"),
                       "XDG_STATE_HOME": str(root / "state"), "XDG_CACHE_HOME": str(root / "cache"),
                       "TMPDIR": "/tmp", "PATH": "/usr/bin:/bin"}
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        actions = [(os.POSIX_SPAWN_OPEN, 1, str(root / (role + ".stdout.log")), flags, 0o600),
                   (os.POSIX_SPAWN_OPEN, 2, str(root / (role + ".stderr.log")), flags, 0o600)]
        read_fd = None
        if piped:
            read_fd, self.stdin = os.pipe2(os.O_CLOEXEC)
            actions.append((os.POSIX_SPAWN_DUP2, read_fd, 0))
        else:
            actions.append((os.POSIX_SPAWN_OPEN, 0, "/dev/null", os.O_RDONLY, 0))
        try:
            pid = os.posix_spawn(command[0], command, environment, file_actions=actions)
            self.children[pid] = role
            fd = os.pidfd_open(pid)
            self.pidfds[pid] = fd
            os.waitid(os.P_PIDFD, fd, os.WEXITED | os.WNOHANG | os.WNOWAIT | WALL)
            self.events.append({"stage": "SPAWN", "role": role, "pid": pid, "pidfdHeld": True})
            return pid
        finally:
            if read_fd is not None:
                os.close(read_fd)

    def collect(self):
        for _ in range(16):
            try:
                item = os.waitid(os.P_ALL, 0, os.WEXITED | os.WNOHANG | WALL)
            except ChildProcessError:
                return True
            if item is None:
                return False
            if item.si_pid not in self.children:
                self.failed = True
            self.terminal[item.si_pid] = {"role": self.children.get(item.si_pid, "unexpected-owned-child"),
                                          "pid": item.si_pid, "code": item.si_code, "status": item.si_status}
        return False

    def until(self, predicate, seconds):
        deadline = time.monotonic() + seconds
        while not predicate():
            self.collect()
            if self.interrupted or time.monotonic() >= deadline:
                raise RuntimeError("LOCK_TRACER_STAGE_TIMEOUT_OR_INTERRUPT")
            select.select([], [], [], 0.02)

    def output(self, pid, stream="stdout"):
        file = self.file.parent / (self.children[pid] + "." + stream + ".log")
        with file.open("rb") as source:
            value = source.read(8193)
        if len(value) > 8192:
            raise RuntimeError("LOCK_TRACER_OUTPUT_LIMIT")
        return value

    def probe(self, role, expected_code, expected_stage):
        control = self.fixture["control"]
        pid = self.spawn(role, [self.fixture["probe"], control["path"], control["device"], control["inode"]])
        self.until(lambda: pid in self.terminal, 5)
        terminal = self.terminal[pid]
        event = json.loads(self.output(pid))
        if terminal["code"] != os.CLD_EXITED or terminal["status"] != expected_code \
                or event != {"stage": expected_stage, "pid": pid} or self.output(pid, "stderr"):
            raise RuntimeError("LOCK_TRACER_EXCLUSIVE_PROBE_CONTRACT_FAILED")
        self.events.append({"stage": expected_stage, "role": role, "pid": pid, "exitCode": expected_code})

    def inspect_bun(self, pid):
        if os.waitid(os.P_PIDFD, self.pidfds[pid], os.WEXITED | os.WNOHANG | os.WNOWAIT | WALL) is not None:
            raise RuntimeError("LOCK_TRACER_BUN_NOT_LIVE")
        expected = next(item for item in self.fixture["sourceInputs"] if item["file"] == self.fixture["runtime"])
        executable = Path(f"/proc/{pid}/exe")
        metadata = executable.stat()
        if os.readlink(executable) != self.fixture["runtime"] or str(metadata.st_dev) != expected["device"] \
                or str(metadata.st_ino) != expected["inode"] or sha(executable) != expected["sha256"]:
            raise RuntimeError("LOCK_TRACER_ACTUAL_BUN_IDENTITY_FAILED")
        descriptor_names = list(Path(f"/proc/{pid}/fd").iterdir())
        if len(descriptor_names) > 256:
            raise RuntimeError("LOCK_TRACER_OWN_FD_OBSERVATION_LIMIT")
        matches = []
        for name in descriptor_names:
            try:
                target = os.readlink(name)
            except FileNotFoundError:
                continue  # A vanished unrelated fd cannot hide the required exact control-lock match.
            if target != self.fixture["control"]["path"]:
                continue
            information = Path(f"/proc/{pid}/fdinfo/{name.name}").read_text()
            if len(information) > 8192:
                raise RuntimeError("LOCK_TRACER_FDINFO_LIMIT")
            fields = dict(line.split(":", 1) for line in information.splitlines() if ":" in line)
            lock = fields.get("lock", "")
            if "FLOCK" not in lock.split() or "READ" not in lock.split() or str(pid) not in lock.split():
                raise RuntimeError("LOCK_TRACER_SHARED_FLOCK_NOT_RETAINED")
            matches.append({"fd": int(name.name), "flags": fields["flags"].strip(), "lock": lock.strip(),
                            "cloexecAfterBunStartup": bool(int(fields["flags"].strip(), 8) & 0o2000000)})
        if len(matches) != 1 or os.waitid(os.P_PIDFD, self.pidfds[pid], os.WEXITED | os.WNOHANG | os.WNOWAIT | WALL) is not None:
            raise RuntimeError("LOCK_TRACER_EXACT_ONE_LIVE_LOCK_REQUIRED")
        self.events.append({"stage": "ACTUAL_BUN_AND_INHERITED_LOCK", "pid": pid,
                            "executable": self.fixture["runtime"], "sha256": expected["sha256"], "locks": matches})

    def run(self):
        self.probe("before", 0, "EXCLUSIVE_ACQUIRED")
        pid = self.spawn("bun", [self.fixture["entry"], "--launcher-lock-fixture"], piped=True)
        self.until(lambda: b"\n" in self.output(pid) or pid in self.terminal, 5)
        ready = json.loads(self.output(pid).splitlines()[0])
        if ready.get("stage") != "BUN_READY" or ready.get("pid") != pid or not ready.get("guardPresent") \
                or ready.get("executable") != self.fixture["runtime"] or ready.get("bunVersion") != "1.4.4" \
                or ready.get("args") != ["--launcher-lock-fixture"]:
            raise RuntimeError("LOCK_TRACER_READY_IDENTITY_FAILED")
        self.events.append(ready)
        self.inspect_bun(pid)
        self.probe("during", 73, "EXCLUSIVE_REFUSED")
        self.inspect_bun(pid)
        os.close(self.stdin)
        self.stdin = None
        self.events.append({"stage": "STDIN_EOF_SENT", "pid": pid})
        self.until(lambda: pid in self.terminal, 5)
        terminal = self.terminal[pid]
        frames = [json.loads(line) for line in self.output(pid).splitlines()]
        if terminal["code"] != os.CLD_EXITED or terminal["status"] != 0 or len(frames) != 2 \
                or frames[1] != {"stage": "BUN_EOF", "pid": pid, "guardDenied": 0, "guardDispatched": 0} \
                or self.output(pid, "stderr"):
            raise RuntimeError("LOCK_TRACER_EOF_EXIT_FAILED")
        self.events.append(frames[1])
        self.probe("after", 0, "EXCLUSIVE_ACQUIRED")

    def drain(self):
        self.admission_closed = True
        if self.stdin is not None:
            try:
                os.close(self.stdin)
                self.stdin = None
            except BaseException:
                self.failure()
        while True:
            try:
                if self.collect():
                    break
            except BaseException:
                self.failure()
            try:
                if time.monotonic() - self.began > 30:
                    self.failure()
                select.select([], [], [], 0.05)
            except BaseException:
                self.failure()
        for fd in self.pidfds.values():
            try:
                os.close(fd)
            except BaseException:
                self.failure()
        result = {"status": "FAIL" if self.failed else "PASS", "parentPid": os.getpid(), "kernelEndpoint": "P_ALL/ECHILD",
                  "signalsSent": 0, "interrupted": self.interrupted, "events": self.events,
                  "children": list(self.terminal.values()), "admittedChildren": len(self.children)}
        try:
            verify(self.file, sys.argv[2])
            result["postInputsUnchanged"] = True
            with (self.file.parent / "result.json").open("x") as output:
                json.dump(result, output, indent=2)
                output.write("\n")
        except BaseException:
            result["status"] = "FAIL"
            result["postVerificationOrEvidenceFailure"] = True
        report(result)
        return 0 if result["status"] == "PASS" else 1


def main():
    if len(sys.argv) != 3:
        raise RuntimeError("USAGE: retain-launcher-lock-tracer.py <fixture.json> <expected-sha256>")
    file = Path(sys.argv[1])
    fixture = verify(file, sys.argv[2])
    prepare_parent()
    parent = Retainer(file, fixture)
    for number in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(number, parent.on_signal)
    os.chdir(file.parent / "cwd")
    try:
        parent.run()
    except BaseException:
        parent.failure()
    return parent.drain()


if __name__ == "__main__":
    raise SystemExit(main())
