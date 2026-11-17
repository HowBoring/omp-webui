"""Future ONE-run retainer source. This file is never imported/executed by source checks or the unsigned producer."""
import ctypes
import hashlib
import json
import os
import re
import select
import selectors
import stat
import subprocess
import sys
import time


def require(value, code):
    if not value:
        raise RuntimeError(code)


def record(path, limit=16384):
    before = os.lstat(path)
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= limit
            and before.st_uid == os.getuid() and os.path.realpath(path) == path, "RETAINER_RECORD")
    with open(path, "rb") as source:
        raw = source.read(limit + 1)
    after = os.lstat(path)
    require(len(raw) <= limit and (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns)
            == (after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns), "RETAINER_RECORD_CHANGED")
    return json.loads(raw), hashlib.sha256(raw).hexdigest()


def pin(expected):
    path = expected["path"]
    metadata = os.lstat(path)
    require(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1 and os.path.realpath(path) == path
            and str(metadata.st_dev) == expected["device"] and str(metadata.st_ino) == expected["inode"], "RETAINER_PIN")
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        while chunk := source.read(65536):
            digest.update(chunk)
    require(digest.hexdigest() == expected["sha256"], "RETAINER_PIN_CHANGED")


class Retainer:
    def __init__(self):
        self.children = {}
        self.pidfds = {}
        self.reader = selectors.DefaultSelector()
        self.buffers = {}
        self.counts = {}
        self.events = {"native": [], "host": []}
        self.failures = []
        self.eof = set()
        self.generation = None

    def preflight(self):
        require(sys.platform == "linux" and os.getuid() == os.geteuid(), "RETAINER_PLATFORM")
        require(hasattr(os, "P_PIDFD") and hasattr(os, "pidfd_open"), "RETAINER_PIDFD_UNAVAILABLE")
        libc = ctypes.CDLL(None, use_errno=True)
        require(libc.prctl(36, 1, 0, 0, 0) == 0, "RETAINER_SUBREAPER")
        enabled = ctypes.c_int()
        require(libc.prctl(37, ctypes.byref(enabled), 0, 0, 0) == 0 and enabled.value == 1, "RETAINER_SUBREAPER")
        own = os.pidfd_open(os.getpid(), 0)
        try:
            try:
                os.waitid(os.P_PIDFD, own, os.WEXITED | os.WNOHANG | os.WNOWAIT)
                raise RuntimeError("RETAINER_SELF_NOT_CHILD")
            except ChildProcessError:
                pass
        finally:
            os.close(own)
        self.assert_echild()

    def assert_echild(self):
        try:
            os.waitid(os.P_ALL, 0, os.WEXITED | os.WNOHANG | os.WNOWAIT)
        except ChildProcessError:
            return
        raise RuntimeError("RETAINER_P_ALL_NOT_ECHILD")

    def spawn(self, role, stage, launcher):
        require(role not in self.children, "RETAINER_DUPLICATE_PROCESS")
        environment = {"HOME": stage + "/home", "PI_CODING_AGENT_DIR": stage + "/profile",
                       "XDG_CONFIG_HOME": stage + "/config", "XDG_DATA_HOME": stage + "/data",
                       "XDG_STATE_HOME": stage + "/xdg-state", "XDG_CACHE_HOME": stage + "/cache",
                       "PATH": "/usr/bin:/bin", "TMPDIR": "/tmp"}
        child = subprocess.Popen([launcher, "--fixture-" + role], cwd=stage + "/cwd", env=environment,
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, close_fds=True)
        self.children[role] = child  # Retain the original Popen before any subsequent operation can fail.
        self.pidfds[role] = os.pidfd_open(child.pid, 0)
        for name, stream in [("stdout", child.stdout), ("stderr", child.stderr)]:
            require(stream is not None, "RETAINER_PIPE")
            key = (role, name)
            self.buffers[key] = b""
            self.counts[key] = 0
            os.set_blocking(stream.fileno(), False)
            self.reader.register(stream, selectors.EVENT_READ, key)

    def command(self, role, command):
        stream = self.children[role].stdin
        require(stream is not None and not stream.closed, "RETAINER_INPUT")
        stream.write((command + " " + self.generation + "\n").encode("ascii"))
        stream.flush()
        stream.close()  # Exact command plus EOF is required by each fixture; never a shutdown/cleanup substitute.

    def advance(self, deadline):
        require(time.monotonic() < deadline, "RETAINER_DEADLINE_UNRESOLVED")
        for key, _ in self.reader.select(min(0.1, max(0, deadline - time.monotonic()))):
            channel = key.data
            chunk = os.read(key.fileobj.fileno(), 4096)
            if not chunk:
                self.reader.unregister(key.fileobj)
                require(not self.buffers[channel], "RETAINER_PARTIAL_OUTPUT")
                self.eof.add(channel)
                continue
            self.counts[channel] += len(chunk)
            require(self.counts[channel] <= 65536, "RETAINER_OUTPUT_LIMIT")
            require(channel[1] == "stdout", "RETAINER_STDERR")
            self.buffers[channel] += chunk
            while b"\n" in self.buffers[channel]:
                line, self.buffers[channel] = self.buffers[channel].split(b"\n", 1)
                require(len(line) <= 4096, "RETAINER_FRAME_LIMIT")
                event = json.loads(line)
                role = channel[0]
                require(event.get("scope") == "TWO_PROCESS_HELPER_FIXTURE_ONLY"
                        and event.get("pid") == self.children[role].pid
                        and event.get("generation") == self.generation, "RETAINER_EVENT_IDENTITY")
                if event.get("event") == "FIXTURE_RETAINED_FAILURE":
                    code = event.get("code")
                    require(isinstance(code, str) and re.fullmatch(r"[A-Z_]{1,64}", code), "RETAINER_FAILURE_CODE")
                    self.failures.append({"role": role, "code": code})
                    raise RuntimeError("RETAINER_CHILD_RETAINED_FAILURE")
                allowed = {"native": ["NATIVE_READY", "NATIVE_DRAINING", "NATIVE_CLOSED"],
                           "host": ["HOST_REGISTERED_HELD", "HOST_CLEAN_REAP_EOF", "HOST_CLOSED"]}[role]
                index = len(self.events[role])
                require(index < len(allowed) and event.get("event") == allowed[index], "RETAINER_EVENT_SEQUENCE")
                self.events[role].append(event)

    def await_event(self, role, count, deadline):
        while len(self.events[role]) < count:
            self.advance(deadline)
            require((role, "stdout") not in self.eof, "RETAINER_EARLY_EOF")

    def run(self, manifest):
        require(set(manifest) == {"format", "status", "stage", "generation", "launcher", "approval", "launchClosure"}, "RETAINER_MANIFEST_FIELDS")
        require(manifest["format"] == "omp-native-helper-drain-one-run/1"
                and manifest["status"] == "ROOT_EXACT_ONE_RUN_APPROVED", "RETAINER_NOT_AUTHORIZED")
        stage = manifest["stage"]
        require(re.fullmatch(r"/tmp/native-helper-drain-[A-Za-z0-9-]+", stage)
                and re.fullmatch(r"[a-f0-9]{64}", manifest["generation"]), "RETAINER_SCOPE")
        require(manifest["launcher"]["path"] == stage + "/launch/bin/omp"
                and manifest["approval"]["path"] == stage + "/operator/approval.json"
                and manifest["launchClosure"]["path"] == stage + "/launch/launch-closure.json", "RETAINER_SCOPE")
        for name in ["launcher", "approval", "launchClosure"]:
            pin(manifest[name])
        self.generation = manifest["generation"]
        self.preflight()
        deadline = time.monotonic() + 60
        self.spawn("native", stage, manifest["launcher"]["path"])
        self.await_event("native", 1, deadline)
        require(len(self.events["native"]) == 1, "RETAINER_EARLY_NATIVE_DRAIN")
        self.spawn("host", stage, manifest["launcher"]["path"])
        self.await_event("host", 1, deadline)
        require(len(self.events["native"]) == 1 and len(self.events["host"]) == 1, "RETAINER_EARLY_CLOSE_OR_START")
        require(self.events["host"][0].get("startReleased") is False, "RETAINER_START_NOT_HELD")
        self.command("native", "CLOSE")
        self.await_event("native", 2, deadline)
        require(len(self.events["native"]) == 2 and len(self.events["host"]) == 1, "RETAINER_NATIVE_CLOSED_BEFORE_START")
        self.command("host", "START")
        self.await_event("native", 3, deadline)
        self.await_event("host", 3, deadline)
        while len(self.eof) != 4:
            self.advance(deadline)
        for role, child in self.children.items():
            require(child.wait(timeout=max(0.001, deadline - time.monotonic())) == 0, "RETAINER_ORIGINAL_EXIT")
            poll = select.poll()
            poll.register(self.pidfds[role], select.POLLIN | select.POLLHUP)
            ready = poll.poll(0)
            require(len(ready) == 1 and ready[0][1] & (select.POLLIN | select.POLLHUP)
                    and not ready[0][1] & (select.POLLERR | select.POLLNVAL), "RETAINER_ORIGINAL_PIDFD")
        self.assert_echild()
        for descriptor in self.pidfds.values():
            os.close(descriptor)
        print(json.dumps({"status": "NOMINAL_TWO_PROCESS_FIXTURE_PASS", "originalPids":
                          {role: child.pid for role, child in self.children.items()}, "pAll": "ECHILD",
                          "faultMatrix": "NOT_RUN", "productAdmission": "BLOCKED"}), flush=True)


if __name__ == "__main__":
    retainer = Retainer()
    try:
        require(len(sys.argv) == 2, "RETAINER_MANIFEST_REQUIRED")
        selected, _ = record(sys.argv[1])
        retainer.run(selected)
    except BaseException as failure:
        code = str(failure) if isinstance(failure, RuntimeError) and re.fullmatch(r"[A-Z_]{1,64}", str(failure)) else "RETAINER_UNRESOLVED"
        print(json.dumps({"status": "HOLD_ORIGINAL_LIFETIMES_RETAINED", "code": code,
                          "childFailures": retainer.failures,
                          "productAdmission": "BLOCKED"}), flush=True)
        # No signal, process discovery, group kill, numeric-PID retry or timeout cleanup. Root retains this process.
        while True:
            time.sleep(1)
