#!/usr/bin/env python3
"""NOT RUN: opt-in real external C/fd3 backpressure and EPIPE fixture, no Native/provider.

Run only after coordinator runtime clearance: python3 .../external-write-fault.py backpressure|write-error.
The independent outer retaining parent owns cleanup, including a deliberately sticky failed protector.
The synthetic dispatcher ACK is NOT authentication/publication evidence. No C send/wait is mocked.
"""
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import select
import socket
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[3]
GENERATION = "b" * 64
INSTALLATION = "f" * 64
BUDGET = 5


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def deadline():
    return time.monotonic() + BUDGET


def receive_line(peer, until):
    result = bytearray()
    while time.monotonic() < until:
        if not select.select([peer], [], [], max(0, until - time.monotonic()))[0]:
            break
        chunk = peer.recv(1)
        require(chunk, "FRAME_EOF")
        result.extend(chunk)
        require(len(result) <= 512, "FRAME_LIMIT")
        if chunk == b"\n":
            return bytes(result)
    raise RuntimeError("FRAME_TIMEOUT")


class Dispatcher:
    """Synthetic external-system peer; deliberately supplies no Native approval or identity proof."""
    def __init__(self, endpoint):
        self.listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.listener.bind(str(endpoint))
        self.listener.listen(1)
        self.listener.settimeout(BUDGET)
        self.completing = threading.Event()
        self.release_ack = threading.Event()
        self.ack_written = threading.Event()
        self.failure = None
        self.peer = None
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def serve(self):
        try:
            self.peer, _ = self.listener.accept()
            ids = []
            for operation in ("register_external", "complete_external"):
                request = json.loads(receive_line(self.peer, deadline()))
                require(request["version"] == "omp-execution-external/1", "VERSION_MISMATCH")
                require(request["installation"] == INSTALLATION, "INSTALLATION_MISMATCH")
                require(request["operation"] == {"op": operation, "generation": GENERATION}, "OPERATION_MISMATCH")
                identifier = request["id"]
                require(isinstance(identifier, str) and len(identifier) == 64
                        and all(byte in "0123456789abcdef" for byte in identifier)
                        and identifier not in ids and identifier != GENERATION, "REQUEST_ID_MISMATCH")
                ids.append(identifier)
                if operation == "complete_external":
                    self.completing.set()
                    require(self.release_ack.wait(BUDGET), "HELD_ACK_TIMEOUT")
                response = {"version": "omp-execution-external/1", "id": identifier, "ok": True,
                            "operation": operation, "generation": GENERATION}
                self.peer.sendall(json.dumps(response, separators=(",", ":")).encode() + b"\n")
            self.ack_written.set()
        except BaseException as error:
            self.failure = type(error).__name__
            self.completing.set()
            self.ack_written.set()

    def close(self):
        self.release_ack.set()
        if self.peer is not None:
            self.peer.close()
        self.listener.close()
        self.thread.join(BUDGET)


def compile_fixture(temporary):
    release = temporary / "release"
    (release / "bin").mkdir(parents=True)
    fences = temporary / "fences"
    fences.mkdir(mode=0o700)
    control = temporary / "maintenance"
    control.write_bytes(b"")
    metadata = control.stat()
    directory = fences.stat()
    definitions = {"OMP_DISPATCHER_PATH": str(temporary / "dispatcher.sock"), "OMP_INSTALLATION_ID": INSTALLATION,
                   "OMP_NATIVE_ENTRY": str(release / "bin/omp"), "OMP_CONTROL_PATH": str(control),
                   "OMP_FENCE_PATH": str(fences)}
    configuration = "".join(f"#define {key} {json.dumps(value)}\n" for key, value in definitions.items())
    configuration += f"#define OMP_CONTROL_DEVICE UINTMAX_C({metadata.st_dev})\n"
    configuration += f"#define OMP_CONTROL_INODE UINTMAX_C({metadata.st_ino})\n"
    configuration += f"#define OMP_FENCE_DEVICE UINTMAX_C({directory.st_dev})\n"
    configuration += f"#define OMP_FENCE_INODE UINTMAX_C({directory.st_ino})\n"
    header = temporary / "configuration.h"
    header.write_text(configuration)
    worker = temporary / "root.c"
    worker.write_text('#include <string.h>\n#include <unistd.h>\n'
                      'int main(int argc, char **argv) { char byte; '
                      'if (argc != 2 || strcmp(argv[1], "__omp_worker_daemon_broker") != 0) return 74; '
                      'return read(0, &byte, 1) == 1 && byte == \'X\' ? 0 : 74; }\n')
    compiler = ["/usr/bin/gcc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2", "-static"]
    environment = {"PATH": "/usr/bin:/bin"}
    subprocess.run(compiler + [str(worker), "-o", str(release / "bin/omp")], check=True, env=environment)
    subprocess.run(compiler + ["-include", str(header), str(ROOT / "compatibility/supervision/external-protector.c"),
                              "-o", str(release / "bin/omp-external-protector")], check=True, env=environment)
    return release, fences, control


def protected(pidfd, fence, control):
    # A zero status is pending, not extinction. The independent outer waiter remains the final cleanup authority.
    require(os.waitid(os.P_PIDFD, pidfd, os.WEXITED | os.WNOHANG | os.WNOWAIT) is None, "PROTECTOR_EXITED_EARLY")
    require(fence.is_file(), "FENCE_RELEASED_EARLY")
    with control.open("rb") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            require(error.errno in (errno.EAGAIN, errno.EACCES), "LEASE_CHECK_FAILED")
        else:
            raise RuntimeError("LEASE_RELEASED_EARLY")


def start_and_reap_root(parent, sink, pid, dispatcher):
    require(receive_line(parent, deadline()).startswith(f"HELLO {GENERATION} {pid} ".encode()), "HELLO_MISMATCH")
    require(receive_line(parent, deadline()) == f"STATE {GENERATION} waiting\n".encode(), "WAITING_MISMATCH")
    parent.sendall(f"START {GENERATION}\n".encode())
    require(receive_line(parent, deadline()) == f"STATE {GENERATION} running\n".encode(), "START_MISMATCH")
    os.write(sink, b"X")
    require(receive_line(parent, deadline()) == f"ROOT_EXIT {GENERATION} 0 0\n".encode(), "ROOT_REAP_MISMATCH")
    require(dispatcher.completing.wait(BUDGET) and dispatcher.failure is None, "COMPLETE_REQUEST_MISSING")


def hold_write_fault(case, parent, writer, dispatcher, pidfd, fences, control):
    # The retained duplicate fills the SAME actual fd3 send queue. No C send wrapper or internal-state seam.
    writer.setblocking(False)
    filled = 0
    while filled < 1_048_576:
        try:
            filled += writer.send(b"!" * 4096)
        except BlockingIOError:
            break
    require(0 < filled < 1_048_576, "SOCKET_BACKPRESSURE_NOT_ESTABLISHED")
    if case == "write-error":
        parent.shutdown(socket.SHUT_RD)  # actual peer write failure, never a mocked return value
    dispatcher.release_ack.set()
    require(dispatcher.ack_written.wait(BUDGET) and dispatcher.failure is None, "COMPLETE_ACK_WRITE_FAILED")
    until = time.monotonic() + 0.25
    while time.monotonic() < until:
        protected(pidfd, fences / f"{GENERATION}.fence", control)
        select.select([], [], [], 0.01)
    return filled


def finish_backpressure(parent, filled, pidfd, pid, fences, control):
    remaining = filled
    while remaining:
        require(select.select([parent], [], [], BUDGET)[0], "FILLER_DRAIN_TIMEOUT")
        chunk = parent.recv(min(remaining, 4096))
        require(chunk and chunk == b"!" * len(chunk), "FILLER_MISMATCH")
        remaining -= len(chunk)
    require(receive_line(parent, deadline()) == f"COMPLETE {GENERATION}\n".encode(), "COMPLETE_MISSING")
    require(select.select([pidfd], [], [], BUDGET)[0], "FINAL_REAP_TIMEOUT")
    _, status = os.waitpid(pid, 0)
    require(os.waitstatus_to_exitcode(status) == 0, "FINALIZATION_FAILED")
    require(not (fences / f"{GENERATION}.fence").exists(), "FENCE_NOT_FINALIZED")
    with control.open("rb") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)


def run_case(case):
    require(os.getppid() == int(os.environ["OMP_FIXTURE_CONTAINMENT_PID"]), "OWNED_CONTAINMENT_REQUIRED")
    temporary = Path(tempfile.mkdtemp(prefix="omp-external-write-fault-"))
    release, fences, control = compile_fixture(temporary)
    dispatcher = Dispatcher(temporary / "dispatcher.sock")
    parent, writer = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
    writer.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 4096)
    source, sink = os.pipe2(os.O_CLOEXEC)
    pidfd = None
    try:
        arguments = [str(release / "bin/omp-external-protector"), GENERATION]
        actions = [(os.POSIX_SPAWN_DUP2, source, 0), (os.POSIX_SPAWN_DUP2, writer.fileno(), 3),
                   (os.POSIX_SPAWN_OPEN, 1, "/dev/null", os.O_WRONLY, 0),
                   (os.POSIX_SPAWN_OPEN, 2, "/dev/null", os.O_WRONLY, 0)]
        pid = os.posix_spawn(arguments[0], arguments, {"OMP_EXECUTION_BROKER_GENERATION": GENERATION,
                            "OMP_EXECUTION_BROKER_SCOPE": '{"kind":"project","directory":"/tmp"}'},
                            file_actions=actions)
        pidfd = os.pidfd_open(pid)
        start_and_reap_root(parent, sink, pid, dispatcher)
        filled = hold_write_fault(case, parent, writer, dispatcher, pidfd, fences, control)
        if case == "backpressure":
            finish_backpressure(parent, filled, pidfd, pid, fences, control)
        print(json.dumps({"case": case, "result": "fixture assertions passed", "protectorPid": pid,
                          "filledBytes": filled, "retainedFenceDirectory": str(fences),
                          "sourceSha256": hashlib.sha256(
                              (ROOT / "compatibility/supervision/private-helper.c").read_bytes()).hexdigest(),
                          "scope": "synthetic real C/fd3 only; not Native/authentication/global proof"}), flush=True)
    finally:
        parent.close()
        writer.close()
        os.close(source)
        os.close(sink)
        if pidfd is not None:
            os.close(pidfd)
        dispatcher.close()
        # Preserve records/fences even after outer containment cleanup; never clear a failed generation here.


def main():
    require(sys.argv[1:] in (["backpressure"], ["write-error"], ["child", "backpressure"], ["child", "write-error"]),
            "CASE_UNSUPPORTED")
    if sys.argv[1] == "child":
        run_case(sys.argv[2])
        return 0
    sys.dont_write_bytecode = True
    import contain  # Imported only inside the explicit runtime entry, never by source-only syntax checking.
    candidates = contain.prepare_containment()
    parent = contain.RetainingParent(candidates, 30)
    for number in (contain.signal.SIGTERM, contain.signal.SIGINT, contain.signal.SIGHUP):
        contain.signal.signal(number, parent.retain_on_signal)
    environment = {"PATH": "/usr/bin:/bin", "TMPDIR": "/tmp", "OMP_FIXTURE_CONTAINMENT_PID": str(os.getpid())}
    parent.launch([sys.executable, str(Path(__file__).resolve()), "child", sys.argv[1]], environment)
    return parent.drain()


if __name__ == "__main__":
    raise SystemExit(main())
