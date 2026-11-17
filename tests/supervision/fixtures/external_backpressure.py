#!/usr/bin/env python3
"""SOURCE ONLY. Proposed one-use current-C backpressure runtime; NEVER compile here.

Only future Root clearance may execute this file. Pure tests import policy only.
No Native, FFI, descendant discovery, groups, numeric signal or automatic cleanup.
"""
import hashlib
import json
import os
from pathlib import Path
import select
import signal
import socket
import subprocess
import sys
import time

from external_backpressure_policy import Session, drain, empty_domain, fill_queue, hold_tick
from external_backpressure_policy import recover, remaining, require
from external_backpressure_io import BUDGET, WALL, Dispatcher, Journal, Reader, input_line
from external_backpressure_io import line, protected, receive, report, send, wait_ready
from external_backpressure_io import fence_bytes

ROOT = Path(__file__).resolve().parents[3]
STAGE = Path("/tmp/omp-external-current-backpressure-r17-20261117")
MARKER = "external-current-602f498-backpressure-r17-v1"
GENERATION = "37ac51764927b879cc9bf0256b629ae013f64400803424d2eb8ef35e2bf26c91b"
INSTALLATION = "d3f6c9e719c0fa69ce89b26ab5b4c24566c7a00bd429de9aa7c33841bbad7291"
RUNNER_ENV = {"PATH": "/usr/bin:/bin", "HOME": str(STAGE / "home"), "TMPDIR": "/tmp", "LC_ALL": "C"}
HELPER_ENV = {**RUNNER_ENV, "OMP_EXECUTION_BROKER_GENERATION": GENERATION,
              "OMP_EXECUTION_BROKER_SCOPE": '{"kind":"project","directory":"/tmp"}'}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def identity(fd):
    metadata = os.fstat(fd)
    return metadata.st_dev, metadata.st_ino


def interrupted(_number, _frame):
    raise KeyboardInterrupt()


def hold():
    while True:
        hold_tick(lambda: None, lambda: select.select([], [], [], 0.25))


def proof_original(session, process, journal, role):
    """Original owner exists before __init__; never reopen after acquisition failure."""
    pidfd = session.keep(os.pidfd_open(process.pid, 0))
    require(os.waitid(os.P_PIDFD, pidfd, os.WEXITED | os.WNOHANG | os.WNOWAIT | WALL) is None,
            "ORIGINAL_EXITED_BEFORE_BINDING")
    journal.save("ORIGINAL_BOUND", role=role, pid=process.pid, fd=pidfd, pidfdIdentity=identity(pidfd))
    return pidfd


def pipes(session):
    return session.keep(os.pipe2(os.O_CLOEXEC))


def output_pipes(session):
    stdout, stderr = pipes(session), pipes(session)
    readers = [session.construct(Reader, session, stdout[0]), session.construct(Reader, session, stderr[0])]
    return stdout, stderr, readers


def gate(session, journal):
    token = os.urandom(24).hex()  # Minted only with the original live guardian already held.
    bound = {"pid": session.protector.pid, "fd": session.pidfd, "pidfdIdentity": session.identity,
             "generation": GENERATION, "marker": MARKER, "challenge": token}
    raw = f"ROOT_START_ORIGINAL {session.protector.pid} {session.identity[0]} {session.identity[1]} {token}\n"
    journal.save("ROOT_BEFORE_BUSINESS_GATE", **bound)
    require(report({"ROOT_BEFORE_BUSINESS_GATE": bound, "exactCommand": raw.rstrip()}), "GATE_REPORT_FAILED")
    require(input_line(0) == raw.encode(), "ROOT_BEFORE_BUSINESS_GATE_REFUSED")
    require(identity(session.pidfd) == session.identity, "ORIGINAL_PIDFD_CHANGED")
    require(os.waitid(os.P_PIDFD, session.pidfd, os.WEXITED | os.WNOHANG | os.WNOWAIT | WALL) is None,
            "ORIGINAL_NOT_LIVE_AT_GATE")
    journal.save("ROOT_START_APPROVED", **bound)


def original_wait(process, pidfd, until, expected, journal, role):
    wait_ready([pidfd], [], until)
    # Popen's wait reaps only its original direct child. Pidfd remains held through every check.
    status = process.wait(timeout=remaining(time.monotonic, until, "ORIGINAL_WAIT_TIMEOUT"))
    remaining(time.monotonic, until, "ORIGINAL_WAIT_TIMEOUT")
    require(status == expected, "ORIGINAL_WAIT_STATUS")
    journal.save("ORIGINAL_WAIT", role=role, pid=process.pid, status=status, pidfdIdentity=identity(pidfd))


def domain_empty(until, journal, role):
    empty_domain(time.monotonic, until,
                 lambda: os.waitid(os.P_ALL, 0, os.WEXITED | os.WNOHANG | WALL))
    journal.save("ORIGINAL_DOMAIN_ECHILD", role=role)


def start_protector(session, journal):
    # Fresh controller requires fd3 absent. Reserve it before creating any socket/pipe.
    # main reserves fd3 before Journal; this slot remains an explicit owned descriptor.
    parent, writer = session.keep(socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM))
    writer.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 4096)
    os.dup2(writer.fileno(), 3, inheritable=False)
    source, sink = pipes(session)
    stdout, stderr, readers = output_pipes(session)
    dispatcher = session.construct(Dispatcher, session, STAGE, GENERATION, INSTALLATION, journal)
    journal.save("PROTECTOR_CONSTRUCTOR_INTENT", fd3=3, fillerFd=writer.fileno())
    process = session.construct(subprocess.Popen,
                                [str(STAGE / "release/bin/omp-external-protector"), GENERATION],
                                stdin=source, stdout=stdout[1], stderr=stderr[1],
                                pass_fds=(3,), env=HELPER_ENV, cwd=ROOT, close_fds=True)
    session.protector = process
    session.pidfd = proof_original(session, process, journal, "protector")
    session.identity = identity(session.pidfd)
    # Only redundant parent write ends close after the original child/pidfd/readers are owned.
    for fd in (source, stdout[1], stderr[1], 3):
        os.close(fd)
    return parent, writer, sink, readers, dispatcher


def protocol_start(session, peer, sink, dispatcher, journal):
    hello = line(peer, time.monotonic() + BUDGET, journal).decode("ascii").split()
    require(len(hello) == 6 and hello[:3] == ["HELLO", GENERATION, str(session.protector.pid)]
            and all(item.isdecimal() and int(item) > 0 for item in hello[3:]), "HELLO_IDENTITY")
    require(line(peer, time.monotonic() + BUDGET, journal) == f"STATE {GENERATION} waiting\n".encode(),
            "WAITING_MISMATCH")
    gate(session, journal)
    business = session.construct(Journal, session, STAGE / "business-started.jsonl")
    business.save("ROOT_APPROVED_BUSINESS_START")
    journal.save("START_INTENT", generation=GENERATION)
    dispatcher.business.set()
    send(peer, f"START {GENERATION}\n".encode(), time.monotonic() + BUDGET)
    require(line(peer, time.monotonic() + BUDGET, journal) == f"STATE {GENERATION} running\n".encode(),
            "RUNNING_MISMATCH")
    session.started = True
    journal.save("FIXED_BROKER_X_INTENT")
    wait_ready([], [sink], time.monotonic() + BUDGET)
    require(os.write(sink, b"X") == 1, "BROKER_STDIN_WRITE")
    require(line(peer, time.monotonic() + BUDGET, journal) == f"ROOT_EXIT {GENERATION} 0 0\n".encode(),
            "EXACT_NATURAL_ROOT_EXIT_ZERO_REQUIRED")
    session.root_zero = True
    journal.save("EXACT_START_AND_NATURAL_ROOT_EXIT_ZERO")
    require(dispatcher.completing.wait(BUDGET) and dispatcher.failure is None, "COMPLETION_REQUEST_MISSING")


def backpressure(session, journal, owned):
    peer, writer, _sink, readers, dispatcher = owned
    fence = STAGE / f"fences/{GENERATION}.fence"
    control = session.keep(os.open(STAGE / "maintenance", os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW))
    protected(session.pidfd, fence, control, GENERATION, journal)
    writer.setblocking(False)
    filled, code = fill_queue(time.monotonic, time.monotonic() + BUDGET, writer.send)
    journal.save("ACTUAL_FD3_EAGAIN", filledBytes=filled, errno=code, chunkBytes=4096)
    journal.save("RELEASE_FAKE_COMPLETE_ACK_INTENT")
    dispatcher.release.set()
    require(dispatcher.ack.wait(BUDGET) and dispatcher.failure is None, "ACK_WRITE_FAILED")
    started = time.monotonic()
    observations = 0
    while time.monotonic() - started < 0.25:
        protected(session.pidfd, fence, control, GENERATION, journal)
        observations += 1
        select.select([], [], [], 0.01)
    protected(session.pidfd, fence, control, GENERATION, journal)
    require(observations > 0, "RETENTION_NOT_OBSERVED")
    journal.save("HELD_250MS", observations=observations, interval=time.monotonic() - started)
    journal.save("CLOSE_FIXTURE_DUPLICATE_INTENT")
    writer.close()  # Essential: this exact duplicate must not manufacture a late EOF failure.
    until = time.monotonic() + BUDGET
    drain(lambda size, bound: receive(peer, size, bound), lambda bound: line(peer, bound, journal),
          filled, f"COMPLETE {GENERATION}\n".encode(), until)
    original_wait(session.protector, session.pidfd, until, 0, journal, "protector")
    for index, reader in enumerate(readers):
        reader.finish(until, journal, f"protector-{index}")
        require(not reader.raw, "UNEXPECTED_PROTECTOR_OUTPUT")
    domain_empty(until, journal, "controller")
    require(not fence.exists(), "FENCE_NOT_FINALIZED")
    import fcntl
    fcntl.flock(control, fcntl.LOCK_EX | fcntl.LOCK_NB)
    journal.save("NORMAL_FENCE_ABSENT_EXCLUSIVE_LOCK_AVAILABLE")
    dispatcher.finish.set()
    require(dispatcher.done.wait(remaining(time.monotonic, until, "DISPATCHER_FINISH_TIMEOUT")),
            "DISPATCHER_FINISH_TIMEOUT")
    require(dispatcher.failure is None, "DISPATCHER_FAILED")
    journal.save("PASS_DRAINED", actualCase="current-C external fd3 backpressure", productAdmission="BLOCKED")


def manual_recovery(session, journal, owned):
    require(session.recovery_eligible(), "NO_ELIGIBLE_RECOVERY_HOLD")
    fence = STAGE / f"fences/{GENERATION}.fence"
    control = session.keep(os.open(STAGE / "maintenance", os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW))
    before = protected(session.pidfd, fence, control, GENERATION, journal)
    token = os.urandom(24).hex()  # Never stored in the stage or preapproved before failure.
    command = f"ROOT_KILL_ONLY_ORIGINAL {session.protector.pid} {session.identity[0]} {session.identity[1]} {token}\n"
    journal.save("MANUAL_RECOVERY_CHALLENGE", command=command.rstrip(), normalPass=False)
    require(report({"HOLD": True, "freshManualCommand": command.rstrip(), "normalPass": False}),
            "RECOVERY_REPORT_FAILED")
    require(input_line(0) == command.encode(), "FRESH_ROOT_MANUAL_COMMAND_REQUIRED")
    require(os.waitid(os.P_PIDFD, session.pidfd, os.WEXITED | os.WNOHANG | os.WNOWAIT | WALL) is None,
            "ORIGINAL_NOT_LIVE_FOR_MANUAL_RECOVERY")
    require(protected(session.pidfd, fence, control, GENERATION, journal) == before, "MANUAL_FENCE_CHANGED")
    recover(session, identity(session.pidfd), journal.save,
            lambda fd: signal.pidfd_send_signal(fd, signal.SIGKILL, None, 0))
    until = time.monotonic() + BUDGET
    original_wait(session.protector, session.pidfd, until, -signal.SIGKILL, journal, "manual-protector")
    peer, writer, _sink, readers, dispatcher = owned
    writer.close()  # Original process has now actually reaped; preserve failed fence unchanged.
    total = 0
    while True:
        chunk = receive(peer, 4096, until)
        total += len(chunk)
        require(total < 1_049_088, "MANUAL_CONTROL_DRAIN_LIMIT")
        if not chunk:
            break
    for index, reader in enumerate(readers):
        reader.finish(until, journal, f"manual-protector-{index}")
    domain_empty(until, journal, "manual-controller")
    dispatcher.finish.set()
    require(dispatcher.done.wait(remaining(time.monotonic, until, "MANUAL_DISPATCHER_TIMEOUT")),
            "MANUAL_DISPATCHER_TIMEOUT")
    require(fence_bytes(fence, GENERATION) == before, "FAILED_FENCE_CHANGED_AFTER_MANUAL_RECOVERY")
    journal.save("MANUAL_RECOVERED_NOT_NORMAL_PASS", failedFenceCleared=False, failedFenceHex=before.hex())
    return 2


def controller(session, journal):
    owned = None
    try:
        owned = start_protector(session, journal)
        protocol_start(session, owned[0], owned[2], owned[4], journal)
        backpressure(session, journal, owned)
        return 0
    except BaseException as failure:
        session.failed = True
        try:
            journal.save("HOLD", failureType=type(failure).__name__, noAutomaticCleanup=True)
            if owned is not None:
                return manual_recovery(session, journal, owned)
        except BaseException:
            pass
        report({"status": "HOLD", "originalOwnersRetained": True, "recovery": "INELIGIBLE_OR_FAILED"})
        hold()


def outer(session, journal, manifest_sha):
    stdout, stderr, readers = output_pipes(session)
    bootstrap = pipes(session)
    readers[0].relay = True
    journal.save("CONTROLLER_CONSTRUCTOR_INTENT")
    child = session.construct(subprocess.Popen,
                              ["/usr/bin/python3", "-B", str(Path(__file__).resolve()),
                               "--controller", MARKER, manifest_sha, str(bootstrap[0])],
                              stdin=0, stdout=stdout[1], stderr=stderr[1],
                              pass_fds=(bootstrap[0],), cwd=ROOT, env=RUNNER_ENV, close_fds=True)
    pidfd = proof_original(session, child, journal, "controller")
    journal.save("ORIGINAL_CONTROLLER_BOOTSTRAP_INTENT", controller=child.pid, pidfdIdentity=identity(pidfd))
    raw = f"ORIGINAL_OUTER {os.getpid()} {child.pid} {manifest_sha}\n".encode()
    wait_ready([], [bootstrap[1]], time.monotonic() + BUDGET)
    require(os.write(bootstrap[1], raw) == len(raw), "BOOTSTRAP_WRITE")
    for fd in (stdout[1], stderr[1]):
        os.close(fd)
    until = None
    expired = False
    while True:
        # This is a sampled acceptance deadline, never a termination mechanism.
        # Late genuine drainage may release owners, but cannot become normal PASS.
        now = time.monotonic()  # A clock failure cannot infer termination, including before START.
        if until is None and (STAGE / "business-started.jsonl").exists():
            until = now + 20
        if until is not None and now >= until and not expired:
            expired = True
            journal.save("OUTER_20S_EXPIRED_HOLD_OBSERVING_ORIGINAL", normalPass=False)
        if select.select([pidfd], [], [], 0.05)[0]:
            break
    require(until is not None, "CONTROLLER_TERMINAL_WITHOUT_BUSINESS_PROOF")
    if time.monotonic() >= until:
        expired = True  # Check again before accepting any terminal/ECHILD observation.
    observation_until = time.monotonic() + BUDGET if expired else until
    result = child.wait(timeout=remaining(time.monotonic, observation_until, "OUTER_WAIT_TIMEOUT"))
    remaining(time.monotonic, observation_until, "OUTER_WAIT_TIMEOUT")
    require(result in (0, 2), "CONTROLLER_FAILED")
    journal.save("ORIGINAL_CONTROLLER_WAIT", status=result, pid=child.pid)
    for index, reader in enumerate(readers):
        reader.finish(observation_until, journal, f"controller-{index}")
    domain_empty(observation_until, journal, "outer")
    if time.monotonic() >= until:
        expired = True
    normal = result == 0 and not expired
    status = "PASS_DRAINED" if normal else "LATE_OR_MANUAL_DRAINED_NOT_PASS"
    journal.save("OUTER_" + status,
                 originalWait=result, originalReadersEOF=True, productAdmission="BLOCKED")
    require(report({"status": status,
                    "controllerOriginalWait": result, "outerECHILD": True, "productAdmission": "BLOCKED"}),
            "FINAL_REPORT_FAILED")
    return 0 if normal else 2


def verify(manifest_sha):
    require(dict(os.environ) == RUNNER_ENV, "EXACT_RUNNER_ENVIRONMENT_REQUIRED")
    require(sha(STAGE / "manifest.json") == manifest_sha, "ROOT_APPROVED_MANIFEST_CHANGED")
    manifest = json.loads((STAGE / "manifest.json").read_bytes())
    require(manifest["status"] == "READY_NOT_RUN" and manifest["marker"] == MARKER
            and manifest["generation"] == GENERATION and manifest["case"] == "backpressure", "MANIFEST_SCOPE")
    require(manifest["pythonSha256"] == sha(Path("/usr/bin/python3")), "PYTHON_IDENTITY_CHANGED")
    for path, digest in manifest["members"].items():
        require(sha(Path(path)) == digest, "PIN_CHANGED")


def main():
    session = Session()
    journal = None
    try:
        require(len(sys.argv) in (4, 5) and sys.argv[1] in ("--run-once", "--controller")
                and sys.argv[2] == MARKER and len(sys.argv[3]) == 64, "SOURCE_ONLY_EXACT_ROOT_WINDOW")
        verify(sys.argv[3])
        for number in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            signal.signal(number, interrupted)
        if sys.argv[1] == "--controller":
            require(len(sys.argv) == 5 and int(sys.argv[4]) > 3, "ORIGINAL_BOOTSTRAP_DESCRIPTOR_REQUIRED")
            bootstrap = session.keep(int(sys.argv[4]))
            require(input_line(bootstrap) == f"ORIGINAL_OUTER {os.getppid()} {os.getpid()} {sys.argv[3]}\n".encode(),
                    "ORIGINAL_OUTER_BINDING_REQUIRED")
            reserved = session.keep(os.dup(0))
            require(reserved == 3, "FRESH_CONTROLLER_FD3_REQUIRED")
            journal = session.construct(Journal, session, STAGE / "controller.jsonl")
            return controller(session, journal)
        require(len(sys.argv) == 4, "OUTER_EXACT_ARGUMENTS")
        journal = session.construct(Journal, session, STAGE / "used-once.jsonl")
        # O_EXCL journal creation+file+directory fsync consumes this Root-approved stage before spawn.
        journal.save("ROOT_ONE_USE_SCOPE", manifestSha256=sys.argv[3], marker=MARKER,
                     scope="ONE_EXTERNAL_BACKPRESSURE_NO_NATIVE_NO_GLOBAL", recovery="FRESH_ROOT_COMMAND_ONLY")
        return outer(session, journal, sys.argv[3])
    except BaseException as failure:
        if journal is not None:
            try:
                journal.save("HOLD", failureType=type(failure).__name__)
            except BaseException:
                pass
        report({"status": "HOLD", "failureType": type(failure).__name__, "originalOwnersRetained": True})
        hold()  # Includes constructor, journal, reporter, clock and interruption ambiguity.


if __name__ == "__main__":
    raise SystemExit(main())
