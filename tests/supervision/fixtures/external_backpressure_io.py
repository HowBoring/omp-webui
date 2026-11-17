"""Proposed runtime boundaries. Source tests use AST only; no runtime import required."""
import errno
import fcntl
import json
import os
from pathlib import Path
import select
import socket
import threading
import time

from external_backpressure_policy import remaining, require

BUDGET = 5
WALL = 0x40000000


def report(value):
    try:
        print(json.dumps(value, separators=(",", ":")), flush=True)
        return True
    except BaseException:
        return False


class Journal:
    """Held descriptor; every record and directory entry durable before side effects."""
    def __init__(self, session, path):
        self.fd = session.keep(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL
                                       | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600))
        self.directory = session.keep(os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY
                                              | os.O_NOFOLLOW | os.O_CLOEXEC))
        self.lock = threading.Lock()
        self.failed = False
        self.save("JOURNAL_CREATED")

    def save(self, event, **fields):
        try:
            with self.lock:
                require(not self.failed, "JOURNAL_ALREADY_FAILED")
                raw = (json.dumps({"event": event, "monotonic": time.monotonic(), **fields},
                                  separators=(",", ":")) + "\n").encode()
                require(len(raw) <= 262144, "JOURNAL_RECORD_LIMIT")
                view = memoryview(raw)
                while view:
                    count = os.write(self.fd, view)
                    require(count > 0, "JOURNAL_WRITE")
                    view = view[count:]
                os.fsync(self.fd)
                os.fsync(self.directory)
        except BaseException:
            self.failed = True
            raise


def wait_ready(readers, writers, until):
    found = select.select(readers, writers, [], remaining(time.monotonic, until, "IO_TIMEOUT"))
    remaining(time.monotonic, until, "IO_TIMEOUT")
    require(found[0] or found[1], "IO_TIMEOUT")


def receive(peer, size, until):
    wait_ready([peer], [], until)
    chunk = peer.recv(size, socket.MSG_DONTWAIT)
    remaining(time.monotonic, until, "IO_TIMEOUT")
    return chunk


def send(peer, raw, until):
    while raw:
        wait_ready([], [peer], until)
        count = peer.send(raw, socket.MSG_DONTWAIT)
        remaining(time.monotonic, until, "IO_TIMEOUT")
        require(count > 0, "WRITE_CLOSED")
        raw = raw[count:]


def line(peer, until, journal):
    raw = bytearray()
    while True:
        byte = receive(peer, 1, until)
        require(byte, "FRAME_EOF")
        raw.extend(byte)
        require(len(raw) <= 512, "FRAME_LIMIT")
        if byte == b"\n":
            journal.save("RAW_LINE", ascii=raw.decode("ascii"))
            return bytes(raw)


def input_line(fd):
    """Before first byte this is HOLD; a begun command has one absolute5s budget."""
    while not select.select([fd], [], [], 0.25)[0]:
        pass
    raw = bytearray()
    until = time.monotonic() + BUDGET
    while True:
        wait_ready([fd], [], until)
        byte = os.read(fd, 1)
        remaining(time.monotonic, until, "ROOT_CONTROL_TIMEOUT")
        require(byte, "ROOT_CONTROL_EOF")
        raw.extend(byte)
        require(len(raw) <= 512, "ROOT_CONTROL_LIMIT")
        if byte == b"\n":
            return bytes(raw)


class Reader:
    """Retains at most64KiB; still drains on overflow, which permanently fails acceptance."""
    def __init__(self, session, fd, relay=False):
        self.fd, self.relay = fd, relay
        self.raw = bytearray()
        self.failure = None
        self.eof = threading.Event()
        self.thread = session.construct(threading.Thread, target=self.read, daemon=True)
        self.thread.start()

    def read(self):
        try:
            while True:
                raw = os.read(self.fd, 4096)
                if not raw:
                    self.eof.set()
                    return
                available = max(0, 65536 - len(self.raw))
                self.raw.extend(raw[:available])
                if len(raw) > available:
                    self.failure = "OUTPUT_LIMIT"
                if self.relay and not report({"controllerOutput": raw.decode("ascii")}):
                    self.failure = "OUTPUT_REPORT_FAILED"
        except BaseException:
            self.failure = "OUTPUT_READER_FAILED"

    def finish(self, until, journal, role):
        require(self.eof.wait(remaining(time.monotonic, until, "READER_TIMEOUT")), "READER_TIMEOUT")
        remaining(time.monotonic, until, "READER_TIMEOUT")
        require(self.failure is None, "READER_FAILED")
        journal.save("ORIGINAL_READER_EOF", role=role, hex=bytes(self.raw).hex())


class Dispatcher:
    """Fixed synthetic peer. ACKs establish wire behavior only, never Native authority."""
    def __init__(self, session, stage, generation, installation, journal):
        self.session, self.generation, self.installation, self.journal = session, generation, installation, journal
        self.completing = threading.Event()
        self.release = threading.Event()
        self.business = threading.Event()
        self.ack = threading.Event()
        self.finish = threading.Event()
        self.done = threading.Event()
        self.failure = None
        self.listener = session.construct(socket.socket, socket.AF_UNIX, socket.SOCK_STREAM)
        self.listener.bind(str(stage / "dispatcher.sock"))
        self.listener.listen(1)
        self.listener.settimeout(BUDGET)
        self.thread = session.construct(threading.Thread, target=self.serve, daemon=True)
        self.thread.start()

    def serve(self):
        try:
            connection = self.session.keep(self.listener.accept())
            peer = connection[0]
            ids = []
            for operation in ("register_external", "complete_external"):
                if operation == "complete_external":
                    self.business.wait()  # Root's before-business gate has no automatic expiry action.
                request = json.loads(line(peer, time.monotonic() + BUDGET, self.journal))
                require(list(request) == ["version", "id", "installation", "operation"], "REQUEST_FIELDS")
                require(request["version"] == "omp-execution-external/1", "REQUEST_VERSION")
                require(request["installation"] == self.installation, "REQUEST_INSTALLATION")
                require(request["operation"] == {"op": operation, "generation": self.generation}, "REQUEST_OP")
                identifier = request["id"]
                require(isinstance(identifier, str) and len(identifier) == 64
                        and all(char in "0123456789abcdef" for char in identifier)
                        and identifier not in ids + [self.generation], "REQUEST_ID")
                ids.append(identifier)
                if operation == "complete_external":
                    self.completing.set()
                    require(self.release.wait(BUDGET), "ACK_HOLD_TIMEOUT")
                raw = (json.dumps({"version": "omp-execution-external/1", "id": identifier, "ok": True,
                                  "operation": operation, "generation": self.generation},
                                 separators=(",", ":")) + "\n").encode()
                self.journal.save("FAKE_ACK_INTENT", ascii=raw.decode("ascii"))
                send(peer, raw, time.monotonic() + BUDGET)
                self.journal.save("FAKE_ACK_WRITTEN", operation=operation)
            self.ack.set()
            self.finish.wait()  # Keep peer held while the original protector is possibly active.
        except BaseException:
            self.failure = "DISPATCHER_AMBIGUITY"
            self.completing.set()
            self.ack.set()
        self.done.set()


def fence_bytes(fence, generation):
    with fence.open("rb") as source:
        raw = source.read(513)
    require(len(raw) <= 512 and raw.startswith(f"omp-external-incomplete/1 {generation} ".encode()),
            "FENCE_CHANGED")
    return raw


def protected(pidfd, fence, control, generation, journal):
    require(os.waitid(os.P_PIDFD, pidfd, os.WEXITED | os.WNOHANG | os.WNOWAIT | WALL) is None,
            "PROTECTOR_EXITED_EARLY")
    raw = fence_bytes(fence, generation)
    try:
        fcntl.flock(control, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as error:
        require(error.errno in (errno.EAGAIN, errno.EACCES), "LEASE_CHECK_FAILED")
    else:
        raise RuntimeError("LEASE_RELEASED_EARLY")
    journal.save("PROTECTION_HELD", fenceHex=raw.hex(), exclusiveLock="DENIED", waitable="LIVE")
    return raw
