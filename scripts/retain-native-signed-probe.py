#!/usr/bin/env python3
"""One Root-frozen synthetic C/Bun probe. Sole P_ALL waiter; original pidfd/readers; no signals or PID discovery.

This is inactive SOURCE. A NOT_READY or unsigned manifest cannot launch it. Root supplies the exact READY digest
only after independently reviewing/signing the final bytes and authorizing one run. Observer failure retains ownership.
"""
import ctypes
import fcntl
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
PYTHON = Path("/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3").resolve()
SYSTEM_INPUTS = frozenset([PYTHON] + [Path("/usr/lib/x86_64-linux-gnu") / name for name in
    ["libc.so.6", "ld-linux-x86-64.so.2", "libdl.so.2", "libm.so.6", "libpthread.so.0"]])


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
        pass  # A lost observer never releases the sole wait owner.


def input_owner_matches(name, stage, actual, expected, mode):
    if actual != expected:
        return False
    if name.is_relative_to(stage):
        return actual == os.getuid()
    if name in SYSTEM_INPUTS:
        return not mode & 0o7022  # Exact Root-pinned readonly system owner; no writable/special-bit exception.
    return actual == os.getuid()


def verify_ready(file, expected):
    stage = file.parent
    if file.name != "READY.json" or stage.parent != Path("/tmp") \
            or not stage.name.startswith("native-signed-probe-") or file.resolve() != file \
            or file.stat().st_size > 1048576 or digest(file) != expected:
        raise RuntimeError("PROBE_ROOT_FROZEN_READY_REQUIRED")
    directory = stage.lstat()
    if not stat.S_ISDIR(directory.st_mode) or directory.st_uid != os.getuid() or stat.S_IMODE(directory.st_mode) != 0o700:
        raise RuntimeError("PROBE_STAGE_OWNERSHIP_CHANGED")
    value = json.loads(file.read_text())
    if value["format"] != "omp-native-signed-probe-ready/1" or value["status"] != "ROOT_APPROVED_ONE_RUN" \
            or value["stage"] != str(stage) or value["prepareAuthorized"] is not False \
            or value["helperAuthorized"] is not False or value["nativeAgentAuthorized"] is not False \
            or value["privateAdmission"] != "BLOCKED" or value["globalAdmission"] != "BLOCKED":
        raise RuntimeError("PROBE_SCOPE_CHANGED")
    inputs = value["inputs"]
    if not isinstance(inputs, list) or not 1 <= len(inputs) <= 2048:
        raise RuntimeError("PROBE_INPUT_LIMIT")
    declared = set()
    for item in inputs:
        name = Path(item["path"])
        metadata = name.lstat()
        if name in declared or name.resolve() != name or not stat.S_ISREG(metadata.st_mode) \
                or metadata.st_nlink != 1 \
                or not input_owner_matches(name, stage, metadata.st_uid, item["uid"], stat.S_IMODE(metadata.st_mode)) \
                or str(metadata.st_dev) != item["device"] or str(metadata.st_ino) != item["inode"] \
                or stat.S_IMODE(metadata.st_mode) != item["mode"] or digest(name) != item["sha256"]:
            raise RuntimeError("PROBE_FROZEN_INPUT_CHANGED")
        if name in {stage / "operator" / entry for entry in ["anchor.json", "approval.json", "key.json"]} | {stage / "control"} \
                and stat.S_IMODE(metadata.st_mode) != 0o600:
            raise RuntimeError("PROBE_OPERATOR_MODE_CHANGED")
        declared.add(name)
    launch = stage / "launch"
    required = {Path(__file__).resolve(), PYTHON, launch / "bin/omp", launch / "runtime/bun",
                launch / "runtime/bunfig.toml", launch / "runtime/no-provider.js", launch / "worker/cli.js",
                launch / "launch-closure.json", launch / "components/release.json", stage / "operator/anchor.json",
                stage / "operator/approval.json", stage / "operator/key.json", stage / "control",
                stage / "home/fixture-marker.json"}
    if not required <= declared or Path(sys.executable).resolve() != PYTHON:
        raise RuntimeError("PROBE_REQUIRED_INPUT_ABSENT")
    # All executable closure members, not merely a hand-picked required set, must be independently frozen by Root.
    closure = json.loads((launch / "launch-closure.json").read_text())
    if closure["format"] != "omp-native-signed-probe-launch/1":
        raise RuntimeError("PROBE_LAUNCH_CLOSURE_FORMAT")
    for member in closure["members"]:
        if member["kind"] == "file" and launch / member["path"] not in declared:
            raise RuntimeError("PROBE_UNFROZEN_LAUNCH_MEMBER")
    for member in closure["platformDependencies"]:
        if member["kind"] == "file" and Path(member["path"]) not in declared:
            raise RuntimeError("PROBE_UNFROZEN_PLATFORM_MEMBER")
    if json.loads((stage / "home/fixture-marker.json").read_text()) != {
            "kind": "native-signed-probe/1", "privateData": False} \
            or any((stage / "home/state/fences").iterdir()) or os.path.lexists(stage / "home/state/socket"):
        raise RuntimeError("PROBE_INITIAL_STATE_CHANGED")
    return value


def prepare_parent():
    # This inspects self only, never a process census or descendant discovery path.
    fields = dict(line.split(b":", 1) for line in Path("/proc/self/status").read_bytes().splitlines() if b":" in line)
    if sys.platform != "linux" or fields.get(b"Threads", b"").strip() != b"1" \
            or fields.get(b"TracerPid", b"").strip() != b"0" \
            or fields.get(b"NSpid", b"").split() != [str(os.getpid()).encode()]:
        raise RuntimeError("PROBE_RETENTION_DOMAIN_UNSUPPORTED")
    libc = ctypes.CDLL(None, use_errno=True)
    enabled = ctypes.c_int(0)
    if libc.prctl(36, 1, 0, 0, 0) != 0 or libc.prctl(37, ctypes.byref(enabled), 0, 0, 0) != 0 or enabled.value != 1:
        raise RuntimeError("PROBE_SUBREAPER_UNAVAILABLE")
    signal.signal(signal.SIGCHLD, signal.SIG_DFL)
    try:
        os.waitid(os.P_ALL, 0, os.WEXITED | os.WNOHANG | WALL)
    except ChildProcessError:
        return
    raise RuntimeError("PROBE_UNEXPECTED_INITIAL_CHILD")


class Retainer:
    def __init__(self, stage):
        self.stage = stage
        self.pid = self.pidfd = self.stdin = None
        self.readers = {}
        self.logs = {}
        self.counts = {}
        self.line = b""
        self.ready = self.closed = False
        self.failed = self.warned = False
        self.root_status = None
        self.pidfd_exit = False
        self.reaped = []
        self.began = time.monotonic()

    def uncertain(self, *_args):
        self.failed = True
        self.eof()  # Original stdin EOF requests normal no-prepare shutdown; never a signal or extinction receipt.
        if not self.warned:
            self.warned = True
            report({"stage": "RETAINING_UNRESOLVED", "parentPid": os.getpid(), "signalsSent": 0})

    def eof(self):
        if self.stdin is not None:
            descriptor, self.stdin = self.stdin, None
            try:
                os.close(descriptor)
            except BaseException:
                self.failed = True

    def launch(self):
        input_read, self.stdin = os.pipe2(os.O_CLOEXEC)
        output_read, output_write = os.pipe2(os.O_CLOEXEC)
        error_read, error_write = os.pipe2(os.O_CLOEXEC)
        self.readers = {output_read: "stdout", error_read: "stderr"}
        for descriptor, label in self.readers.items():
            os.set_blocking(descriptor, False)
            self.logs[label] = os.open(self.stage / (label + ".log"), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            self.counts[label] = 0
        actions = [(os.POSIX_SPAWN_DUP2, input_read, 0), (os.POSIX_SPAWN_DUP2, output_write, 1),
                   (os.POSIX_SPAWN_DUP2, error_write, 2)]
        environment = {"HOME": str(self.stage / "home"), "PI_CODING_AGENT_DIR": str(self.stage / "profile"),
                       "TMPDIR": "/tmp", "PATH": "/usr/bin:/bin", "LC_ALL": "C.UTF-8",
                       "XDG_CONFIG_HOME": str(self.stage / "config"), "XDG_DATA_HOME": str(self.stage / "data"),
                       "XDG_STATE_HOME": str(self.stage / "xdg-state"), "XDG_CACHE_HOME": str(self.stage / "cache")}
        command = str(self.stage / "launch/bin/omp")
        os.chdir(self.stage / "cwd")
        try:
            self.pid = os.posix_spawn(command, [command], environment, file_actions=actions)
            self.pidfd = os.pidfd_open(self.pid)
            os.waitid(os.P_PIDFD, self.pidfd, os.WEXITED | os.WNOHANG | os.WNOWAIT | WALL)
            report({"stage": "RETAINING_LAUNCHED", "rootPid": self.pid, "originalPidfd": True,
                    "initialKernelEndpoint": "P_ALL/ECHILD", "signalsSent": 0})
        finally:
            for descriptor in [input_read, output_write, error_write]:
                os.close(descriptor)

    def receive(self, descriptor):
        try:
            data = os.read(descriptor, 65536)
        except BlockingIOError:
            return
        if not data:
            os.close(descriptor)
            del self.readers[descriptor]
            return
        label = self.readers[descriptor]
        self.counts[label] += len(data)
        if self.counts[label] <= 1048576:
            if os.write(self.logs[label], data) != len(data):
                self.uncertain()
        else:
            self.uncertain()
        if label == "stderr":
            self.uncertain()
            return
        self.line += data
        if len(self.line) > 16384:
            self.line = b""
            self.uncertain()
        while b"\n" in self.line:
            line, self.line = self.line.split(b"\n", 1)
            value = json.loads(line)
            if value.get("pid") != self.pid or value.get("prepareInvoked") is not False:
                raise RuntimeError("PROBE_ORIGINAL_PROCESS_CHANGED")
            if value.get("stage") == "PROBE_READY" and not self.ready \
                    and value.get("emptyScopesBeforeAndAfter") is True and value.get("signedMissingInspection") is True:
                self.ready = True
                self.eof()
            elif value.get("stage") == "PROBE_CLOSED" and self.ready and not self.closed \
                    and all(value.get(key) is True for key in ["awaitedServerClose", "selectionRejectsAfterClose",
                                                             "inheritedCGuardStillCurrent"]):
                self.closed = True
            else:
                raise RuntimeError("PROBE_UNEXPECTED_OUTPUT")

    def drain(self):
        echild = False
        while not echild or self.readers:
            try:
                while True:
                    item = os.waitid(os.P_ALL, 0, os.WEXITED | os.WNOHANG | WALL)
                    if item is None:
                        break
                    result = {"pid": item.si_pid, "code": item.si_code, "status": item.si_status}
                    if len(self.reaped) < 64:
                        self.reaped.append(result)
                    else:
                        self.uncertain()
                    if item.si_pid == self.pid:
                        self.root_status = result
            except ChildProcessError:
                echild = True  # Admission was permanently closed after the single original spawn.
            except BaseException:
                self.uncertain()
            try:
                if time.monotonic() - self.began > 30:
                    self.uncertain()  # Deadline is diagnostic; retain until ECHILD and original readers' EOF.
                readable, _, _ = select.select(list(self.readers), [], [], 0.05)
                for descriptor in readable:
                    self.receive(descriptor)
            except BaseException:
                self.uncertain()
        return self.finish()

    def finish(self):
        self.eof()
        for descriptor in self.logs.values():
            os.close(descriptor)
        if self.pidfd is not None:
            poll = select.poll()
            poll.register(self.pidfd, select.POLLIN)
            events = poll.poll(0)
            self.pidfd_exit = bool(events) and all(event & (select.POLLIN | select.POLLHUP)
                                                  and not event & (select.POLLERR | select.POLLNVAL) for _, event in events)
            os.close(self.pidfd)
        normal = self.root_status and self.root_status["code"] == os.CLD_EXITED and self.root_status["status"] == 0
        clean = self.ready and self.closed and normal and self.pidfd_exit and not self.line and not self.failed
        if clean:
            try:
                if os.path.lexists(self.stage / "home/state/socket") or any((self.stage / "home/state/fences").iterdir()):
                    raise RuntimeError("PROBE_FINAL_STATE_CHANGED")
                control = os.open(self.stage / "control", os.O_RDONLY | os.O_NOFOLLOW)
                try:
                    fcntl.flock(control, fcntl.LOCK_EX | fcntl.LOCK_NB)
                finally:
                    os.close(control)
            except BaseException:
                clean = False
        result = {"stage": "DRAINED", "status": "PASS_SYNTHETIC_ONLY" if clean else "FAIL",
                  "kernelEndpoint": "P_ALL/ECHILD", "rootStatus": self.root_status, "reaped": self.reaped,
                  "originalReadersEof": True, "originalPidfdKernelExit": self.pidfd_exit, "signalsSent": 0, "prepareInvoked": False,
                  "exclusiveControlAvailableAfterExit": bool(clean), "privateAdmission": "BLOCKED", "globalAdmission": "BLOCKED"}
        descriptor = os.open(self.stage / "result.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            stream.write(json.dumps(result, indent=2) + "\n")
        report(result)
        return 0 if clean else 1


def main():
    if len(sys.argv) != 3:
        raise RuntimeError("USAGE <Root-frozen-READY.json> <exact-sha256>")
    file = Path(sys.argv[1])
    verify_ready(file, sys.argv[2])
    prepare_parent()
    claim = os.open(file.parent / "one-run-started", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(claim)
    retainer = Retainer(file.parent)
    for number in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGQUIT]:
        signal.signal(number, retainer.uncertain)
    try:
        retainer.launch()
    except BaseException:
        retainer.uncertain()
    return retainer.drain()


if __name__ == "__main__":
    sys.exit(main())
