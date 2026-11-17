"""TEST HARNESS only. Pure tests import with fake OS boundaries; source checks never run the ONE-run entry."""
import hashlib
import json
import os
import re
import select
import selectors
import signal
import stat
import subprocess
import sys
import time


# Same closed policy as the pure diagnostic seam; no Native import or message payload admission.
PUBLIC_FAILURE_CODES = frozenset({
    'ownership_protocol',
    'ownership_limit',
    'dispatcher_unavailable',
    'dispatcher_mismatch',
    'ownership_unresolved',
    'maintenance_fenced',
    'shared_service_unsupported',
    'ownership_backend_unavailable',
})
FIXTURE_FAILURE_CODES = frozenset({
    'DRAIN_ANCHOR_SCOPE',
    'DRAIN_APPROVAL_LIMIT',
    'DRAIN_APPROVAL_SCOPE',
    'DRAIN_APPROVAL_SIGNATURE',
    'DRAIN_ENTRY_CHANGED',
    'DRAIN_HELLO_MISMATCH',
    'DRAIN_HELPER_NOT_REGISTERED',
    'DRAIN_HELPER_OUTPUT_LIMIT',
    'DRAIN_HOST_ARGUMENTS',
    'DRAIN_HOST_INCOMPLETE',
    'DRAIN_HOST_LEASE_RETAINED',
    'DRAIN_LAUNCH_CHANGED',
    'DRAIN_LAUNCH_DIGEST',
    'DRAIN_NATIVE_ARGUMENTS',
    'DRAIN_NATIVE_CLOSE_INCOMPLETE',
    'DRAIN_NONCANONICAL_APPROVAL',
    'DRAIN_OPERATOR_CHANGED',
    'DRAIN_OPERATOR_PATHS',
    'DRAIN_PARENT_COMMAND',
    'DRAIN_PARENT_INPUT_LIMIT',
    'DRAIN_PREIMPORT_GUARD_MISSING',
    'DRAIN_PREPARE_MISMATCH',
    'DRAIN_PREPARE_NOT_PENDING',
    'DRAIN_PUBLIC_INPUT_CHANGED',
    'DRAIN_ROLE_REQUIRED',
    'DRAIN_RUNTIME_CHANGED',
    'DRAIN_UNRESOLVED',
    'DRAIN_V4_REQUIRED',
    'DRAIN_WORKER_IDENTITY',
})
FAILURE_PHASES = frozenset({
    'bootstrap_import',
    'bootstrap_entry',
    'native_imports',
    'native_handoff',
    'native_approval',
    'native_claim',
    'native_selection',
    'native_server_open',
    'native_wait_close',
    'native_close',
    'native_disposal',
    'host_run',
    'unrecognized',
})


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
    def __init__(self, challenge_factory=None):
        self.children = {}
        self.pidfds = {}
        self.reader = selectors.DefaultSelector()
        self.buffers = {}
        self.reader_channels = set()
        self.launch_attempted = set()
        self.counts = {}
        self.events = {"native": [], "host": []}
        self.failures = []
        self.history = []
        self.eof = set()
        self.generation = None
        self.phase = "PREPARED"
        self.launch_returned = set()
        self.holding = False
        self.failure_phase = None
        self.failure_code = None
        self.journal = []
        self.emit = lambda value: print(json.dumps(value), flush=True)
        self.root_buffer = b""
        self.root_consumed = False
        self.root_listening = False
        self.recovery_attempted = False
        self.recovery_fault = False
        self.drain_fault = False
        self.recovered = False
        self.original_pidfd_release = "NOT_ATTEMPTED"
        self.recovery_disqualified = False
        self.recovery_scope = None
        self.challenge_factory = challenge_factory if challenge_factory is not None else lambda: os.urandom(16).hex()
        self.hold_challenge = None
        self.challenge_published = False
        self.waits = {}
        self.p_all = "NOT_OBSERVED"

    def receipt(self):
        return {"status": "FAILED_EARLY_NATIVE_ORIGINAL_DOMAIN_DRAINED" if self.recovered
                else "HOLD_ORIGINAL_LIFETIMES_RETAINED", "generation": self.generation,
                "code": self.failure_code, "phase": self.phase, "failurePhase": self.failure_phase,
                "childFailures": self.failures, "events": self.history, "journal": self.journal,
                "originalObjects": sorted(self.children), "launchAttempted": sorted(self.launch_attempted),
                "initializersReturned": sorted(self.launch_returned), "originalReaders": sorted(self.reader_channels),
                "originalWaits": self.waits, "originalEof": sorted([list(channel) for channel in self.eof]),
                "pAll": self.p_all, "originalPidfdRelease": self.original_pidfd_release,
                "fixtureAcceptance": False, "automaticCleanupAcceptance": False,
                "fences": "NOT_INSPECTED_NO_RETAINER_MUTATION", "productAdmission": "BLOCKED"}

    def note(self, event, **facts):
        require(len(self.journal) < 128, "RETAINER_JOURNAL_LIMIT")
        self.journal.append({"sequence": len(self.journal), "event": event, "phase": self.phase, **facts})
        self.emit(self.receipt())  # Flush the original tool journal BEFORE any recovery action.

    def enter_hold(self, failure):
        if self.holding:
            self.recovery_disqualified = True
        self.holding = True
        if self.failure_phase is None:
            self.failure_phase = self.phase
            text = str(failure) if type(failure) is RuntimeError else ""
            self.failure_code = text if re.fullmatch(r"RETAINER_[A-Z_]{1,64}", text) else "RETAINER_UNRESOLVED"
        try:
            self.note("HOLD")
            if self.recovery_eligible() and self.recovery_scope is None:
                self.recovery_scope = (self.children["native"], self.pidfds["native"], self.generation,
                                       self.phase, dict(self.failures[0]))
                self.hold_challenge = self.challenge_factory()
                require(type(self.hold_challenge) is str and re.fullmatch(r"[a-f0-9]{32}", self.hold_challenge),
                        "RETAINER_HOLD_CHALLENGE")
                self.note("ROOT_HOLD_CHALLENGE", holdChallenge=self.hold_challenge)
                self.challenge_published = True
        except BaseException:
            self.recovery_disqualified = True
            self.root_consumed = True
            raise

    def recovery_eligible(self):
        early = {"bootstrap_import", "bootstrap_entry", "native_imports", "native_handoff", "native_approval",
                 "native_claim", "native_selection", "native_server_open"}
        eligible = (self.holding and not self.drain_fault and not self.recovery_fault
                    and self.generation is not None and self.phase == "NATIVE_AWAIT_READY"
                    and self.failure_code == "RETAINER_CHILD_RETAINED_FAILURE"
                    and self.failure_phase == "NATIVE_AWAIT_READY"
                    and set(self.children) == set(self.pidfds) == self.launch_returned == {"native"}
                    and self.events == {"native": [], "host": []} and len(self.failures) == 1
                    and self.failures[0]["role"] == "native" and self.failures[0]["phase"] in early
                    and set(self.buffers) == {("native", "stdout"), ("native", "stderr")}
                    and not any(self.buffers.values())
                    and self.reader_channels == {("native", "stdout"), ("native", "stderr")})
        if eligible and self.recovery_scope is not None:
            child, descriptor, generation, phase, failure = self.recovery_scope
            eligible = (self.children["native"] is child and self.pidfds["native"] == descriptor
                        and self.generation == generation and self.phase == phase and self.failures[0] == failure)
        if not eligible:
            self.recovery_disqualified = True
        return eligible and not self.recovery_disqualified

    def listen_root(self):
        # Only this original execution's stdin; no endpoint, path, PID or recovered descriptor authority.
        require(self.challenge_published and not self.root_consumed and self.recovery_eligible(),
                "RETAINER_ROOT_CONTROL_UNAVAILABLE")
        try:
            os.set_blocking(sys.stdin.fileno(), False)
            self.reader.register(sys.stdin, selectors.EVENT_READ, ("root", "stdin"))
            self.root_listening = True
            self.note("ROOT_CONTROL_LISTENING")
        except BaseException:
            self.recovery_disqualified = True
            self.root_consumed = True
            raise

    def root_control(self, chunk):
        if self.root_consumed:
            return
        if not chunk or not self.challenge_published or not self.holding:
            self.root_consumed = True
            self.root_buffer = b""
            self.note("ROOT_CONTROL_EOF" if not chunk else "ROOT_CONTROL_REJECTED")
            return
        self.root_buffer += chunk
        if len(self.root_buffer) > 128:
            self.root_consumed = True
            self.root_buffer = b""
            self.note("ROOT_CONTROL_REJECTED")
            return
        if b"\n" not in self.root_buffer:
            return
        self.root_consumed = True  # A malformed or uncertain request never earns an automatic retry.
        command, self.root_buffer = self.root_buffer, b""
        expected = f"RECOVER_EARLY_NATIVE {self.generation or ''} {self.hold_challenge}\n".encode("ascii")
        for channel in self.buffers:
            if channel[1] == "stdout":
                self.consume_buffer(channel)
        if not self.recovery_eligible() or command != expected:
            self.note("ROOT_CONTROL_REJECTED")
            return
        self.recovery_attempted = True
        try:
            self.note("RECOVERY_SIGNAL_INTENT", role="native", signal="SIGTERM")
            require(self.recovery_eligible(), "RETAINER_RECOVERY_SCOPE_CHANGED")
            signal.pidfd_send_signal(self.pidfds["native"], signal.SIGTERM, None, 0)
            self.note("RECOVERY_SIGNAL_DELIVERED", role="native", signal="SIGTERM")
        except BaseException:
            self.recovery_fault = True
            self.note("RECOVERY_CONTROL_FAILED")

    def original_terminal(self, role):
        poll = select.poll()
        poll.register(self.pidfds[role], select.POLLIN | select.POLLHUP)
        ready = poll.poll(0)
        return (len(ready) == 1 and bool(ready[0][1] & (select.POLLIN | select.POLLHUP))
                and ready[0][0] == self.pidfds[role]
                and not ready[0][1] & (select.POLLERR | select.POLLNVAL))

    def recovery_step(self):
        if self.recovered:
            return self.recovered
        if not self.recovery_attempted or not self.recovery_eligible():
            return False
        try:
            if "native" not in self.waits:
                try:
                    self.waits["native"] = self.children["native"].wait(timeout=0)
                except subprocess.TimeoutExpired:
                    return False
                require(type(self.waits["native"]) is int, "RETAINER_ORIGINAL_WAIT_UNRESOLVED")
                self.note("RECOVERY_ORIGINAL_WAIT", role="native", exit=self.waits["native"])
            if self.eof != {("native", "stdout"), ("native", "stderr")} or not self.original_terminal("native"):
                return False
            self.assert_echild()  # Unknown adopted/living/zombie children HOLD. Never enumerate or infer extinction.
            self.p_all = "ECHILD"
            self.note("RECOVERY_TERMINAL_FACTS")
            require(self.recovery_eligible(), "RETAINER_RECOVERY_SCOPE_CHANGED")
            self.recovered = True
            self.note("RECOVERY_COMPLETE_RUN_STILL_FAILED")
            require(self.recovery_eligible(), "RETAINER_RECOVERY_SCOPE_CHANGED")
            self.original_pidfd_release = "UNCERTAIN"
            os.close(self.pidfds["native"])
            self.original_pidfd_release = "CLOSED"
            return True
        except BaseException:
            self.recovered = False
            self.recovery_fault = True
            self.note("RECOVERY_UNRESOLVED")
            return False

    def hold_step(self):
        # One finite selector tick also remains testable without an unbounded fake HOLD loop.
        try:
            self.read_ready(0.1)
            return self.recovery_step()
        except BaseException as failure:
            self.drain_fault = True
            try:
                self.enter_hold(failure)
            except BaseException:
                pass  # Even broken journaling/Root EOF must retain every original object.
            return False

    def preflight(self):
        require(sys.platform == "linux" and os.getuid() == os.geteuid(), "RETAINER_PLATFORM")
        require(hasattr(os, "P_PIDFD") and hasattr(os, "pidfd_open"), "RETAINER_PIDFD_UNAVAILABLE")
        import ctypes  # Kernel/FFI preflight is never imported or executed by pure source tests.
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
        self.launch_attempted.add(role)
        self.phase = role.upper() + "_ALLOCATE_ORIGINAL"
        child = subprocess.Popen.__new__(subprocess.Popen)
        self.children[role] = child  # Publish BEFORE initialization: BaseException does not imply no child.
        self.phase = role.upper() + "_INITIALIZE_ORIGINAL"
        subprocess.Popen.__init__(child, [launcher, "--fixture-" + role], cwd=stage + "/cwd", env=environment,
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, close_fds=True)
        self.launch_returned.add(role)
        self.phase = role.upper() + "_CAPTURE_PIDFD"
        self.pidfds[role] = os.pidfd_open(child.pid, 0)
        for name, stream in [("stdout", child.stdout), ("stderr", child.stderr)]:
            self.phase = role.upper() + "_CAPTURE_" + name.upper() + "_READER"
            require(stream is not None, "RETAINER_PIPE")
            key = (role, name)
            self.buffers[key] = b""
            self.counts[key] = 0
            os.set_blocking(stream.fileno(), False)
            self.reader.register(stream, selectors.EVENT_READ, key)
            self.reader_channels.add(key)

    def command(self, role, command):
        stream = self.children[role].stdin
        require(stream is not None and not stream.closed, "RETAINER_INPUT")
        stream.write((command + " " + self.generation + "\n").encode("ascii"))
        stream.flush()
        stream.close()  # Exact command plus EOF is required by each fixture; never a shutdown/cleanup substitute.

    def advance(self, deadline):
        require(time.monotonic() < deadline, "RETAINER_DEADLINE_UNRESOLVED")
        self.read_ready(min(0.1, max(0, deadline - time.monotonic())))

    def read_ready(self, timeout):
        for channel in self.buffers:
            if channel[1] == "stdout":
                self.consume_buffer(channel)
        # Root cannot outrun a simultaneously readable original child observation.
        ready = self.reader.select(timeout)
        for key, _ in sorted(ready, key=lambda item: item[0].data == ("root", "stdin")):
            channel = key.data
            chunk = os.read(key.fileobj.fileno(), 4096 if channel[0] != "root" else 129)
            if channel == ("root", "stdin"):
                if not chunk:
                    self.reader.unregister(key.fileobj)
                    self.root_listening = False
                self.root_control(chunk)
                continue
            if not chunk:
                self.reader.unregister(key.fileobj)
                require(not self.buffers[channel], "RETAINER_PARTIAL_OUTPUT")
                self.eof.add(channel)
                if self.holding:
                    self.note("ORIGINAL_READER_EOF", role=channel[0], channel=channel[1])
                continue
            self.counts[channel] += len(chunk)
            require(self.counts[channel] <= 65536, "RETAINER_OUTPUT_LIMIT")
            require(channel[1] == "stdout", "RETAINER_STDERR")
            self.buffers[channel] += chunk
            self.consume_buffer(channel)

    def consume_buffer(self, channel):
        while b"\n" in self.buffers[channel]:
            line, self.buffers[channel] = self.buffers[channel].split(b"\n", 1)
            require(len(line) <= 4096, "RETAINER_FRAME_LIMIT")
            self.accept_event(channel[0], json.loads(line))

    def validate_nominal_fields(self, event):
        shapes = {
            "NATIVE_READY": {}, "NATIVE_DRAINING": {},
            "NATIVE_CLOSED": {"awaitedServerClose": True, "selectionReleased": True,
                              "inheritedCGuardCurrent": True, "hostReceiptOrReapObserved": False},
            "HOST_REGISTERED_HELD": {"helperPid": "pid", "helperStartTime": "ticks", "nativePid": "pid",
                                     "nativeStartTime": "ticks", "startReleased": False},
            "HOST_CLEAN_REAP_EOF": {"helperPid": "pid", "helperExit": 0, "decodedControlTailClean": True},
            "HOST_CLOSED": {"moduleCloseAwaitedBeforeLeaseRelease": True, "nativeTerminalAuthorityInferred": False},
        }
        fields = shapes[event["event"]]
        require(set(event) == {"scope", "event", "pid", "generation"} | set(fields), "RETAINER_EVENT_FIELDS")
        for name, expected in fields.items():
            observed = event[name]
            if expected == "pid":
                valid = type(observed) is int and 0 < observed <= 2147483647
            elif expected == "ticks":
                valid = isinstance(observed, str) and re.fullmatch(r"[0-9]{1,24}", observed)
            else:
                valid = type(observed) is type(expected) and observed == expected
            require(valid, "RETAINER_EVENT_FIELDS")

    def accept_event(self, role, event):
        require(event.get("scope") == "TWO_PROCESS_HELPER_FIXTURE_ONLY"
                and event.get("pid") == self.children[role].pid
                and event.get("generation") == self.generation, "RETAINER_EVENT_IDENTITY")
        if event.get("event") == "FIXTURE_RETAINED_FAILURE":
            code = event.get("code")
            source, phase = event.get("codeSource"), event.get("phase")
            require(set(event) == {"event", "code", "codeSource", "phase", "pid", "generation", "scope"}
                    and phase in FAILURE_PHASES and (
                        (source == "public_code" and code in PUBLIC_FAILURE_CODES)
                        or (source == "fixture_message" and code in FIXTURE_FAILURE_CODES)
                        or (source == "unrecognized" and code == "DRAIN_UNRESOLVED")), "RETAINER_FAILURE_CODE")
            self.history.append({"role": role, **event})
            self.failures.append({"role": role, "code": code, "codeSource": source, "phase": phase})
            if self.holding:
                self.recovery_disqualified = True
                self.note("CHILD_RETAINED_FAILURE", role=role)
                return
            raise RuntimeError("RETAINER_CHILD_RETAINED_FAILURE")
        allowed = {"native": ["NATIVE_READY", "NATIVE_DRAINING", "NATIVE_CLOSED"],
                   "host": ["HOST_REGISTERED_HELD", "HOST_CLEAN_REAP_EOF", "HOST_CLOSED"]}[role]
        index = len(self.events[role])
        require(index < len(allowed) and event.get("event") == allowed[index], "RETAINER_EVENT_SEQUENCE")
        self.validate_nominal_fields(event)
        self.events[role].append(event)
        self.history.append({"role": role, **event})
        if self.holding:
            self.recovery_disqualified = True
            self.note("ORIGINAL_CHILD_EVENT", role=role, childEvent=event["event"])

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
        self.phase = "PREFLIGHT"
        self.preflight()
        deadline = time.monotonic() + 60
        self.spawn("native", stage, manifest["launcher"]["path"])
        self.phase = "NATIVE_AWAIT_READY"
        self.await_event("native", 1, deadline)
        require(len(self.events["native"]) == 1, "RETAINER_EARLY_NATIVE_DRAIN")
        self.spawn("host", stage, manifest["launcher"]["path"])
        self.phase = "HOST_AWAIT_REGISTERED"
        self.await_event("host", 1, deadline)
        require(len(self.events["native"]) == 1 and len(self.events["host"]) == 1, "RETAINER_EARLY_CLOSE_OR_START")
        require(self.events["host"][0].get("startReleased") is False, "RETAINER_START_NOT_HELD")
        self.phase = "NATIVE_CLOSE_REQUEST"
        self.command("native", "CLOSE")
        self.await_event("native", 2, deadline)
        require(len(self.events["native"]) == 2 and len(self.events["host"]) == 1, "RETAINER_NATIVE_CLOSED_BEFORE_START")
        self.phase = "HOST_START_REQUEST"
        self.command("host", "START")
        self.await_event("native", 3, deadline)
        self.await_event("host", 3, deadline)
        self.phase = "ORIGINAL_OUTPUT_EOF"
        while len(self.eof) != 4:
            self.advance(deadline)
        self.phase = "ORIGINAL_WAITS"
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
        try:
            retainer.enter_hold(failure)
            retainer.listen_root()
        except BaseException:
            pass  # No reporting/control failure can discard the retained original ownership.
        while not retainer.hold_step():
            pass
        sys.exit(1)  # Root-requested terminal recovery never converts the original fixture FAIL into PASS.
