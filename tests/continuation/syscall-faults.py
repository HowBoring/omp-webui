"""Owned Linux x86_64 syscall controller: observe/fault genuine Bun pwrite64 at the kernel boundary.
EXITKILL ensures no tracee survives this fixture controller. No attach or unrelated process control exists.
"""
import ctypes as c
import errno
import json
import os
import pathlib
import platform
import shutil
import signal
import sys

assert platform.system() == "Linux" and platform.machine() == "x86_64"
home = pathlib.Path(os.environ["HOME"]).resolve()
target = pathlib.Path(os.environ["OMP_STRICT_FAULT_TARGET"]).resolve()
assert os.environ.get("OMP_STRICT_FIXTURE_HOME") == str(home) and target.is_relative_to(home)
fault = os.environ["OMP_STRICT_FAULT"]
libc = c.CDLL(None, use_errno=True)
libc.ptrace.restype = c.c_long
class Registers(c.Structure):
    _fields_ = [(name, c.c_ulonglong) for name in
                "r15 r14 r13 r12 rbp rbx r11 r10 r9 r8 rax rcx rdx rsi rdi orig_rax rip cs eflags rsp ss fs_base gs_base ds es fs gs".split()]
class IOVec(c.Structure):
    _fields_ = [("base", c.c_void_p), ("length", c.c_size_t)]
libc.process_vm_readv.restype = c.c_ssize_t

def ptrace(request, pid, addr=0, data=0):
    result = libc.ptrace(c.c_long(request), c.c_long(pid), c.c_void_p(addr), c.c_void_p(data))
    if result == -1:
        raise OSError(c.get_errno(), "fixture ptrace")
    return result

def memory(pid, address, maximum):
    output = bytearray()
    for offset in range(0, maximum, 8):
        c.set_errno(0)
        word = libc.ptrace(c.c_long(2), c.c_long(pid), c.c_void_p(address + offset), c.c_void_p(0))
        if word == -1 and c.get_errno():
            raise OSError(c.get_errno(), "fixture ptrace memory read")
        output.extend(c.c_ulonglong(word).value.to_bytes(8, "little"))
    return bytes(output[:maximum])

def audit(event, **extra):
    with (home / "strict-syscalls.log").open("a") as stream:
        stream.write(json.dumps({"event": event, **extra}, separators=(",", ":")) + "\n")

child = os.fork()
if child == 0:
    ptrace(0, 0)
    os.kill(os.getpid(), signal.SIGSTOP)
    os.execvpe(sys.argv[1], sys.argv[1:], dict(os.environ))
_, status = os.waitpid(child, 0)
assert os.WIFSTOPPED(status)
ptrace(0x4200, child, 0, 1 | 2 | 4 | 8 | 16 | 0x100000)
ptrace(24, child)
tracees, pending = {child}, {}
fired = False
exit_code = None
try:
    while tracees:
        pid, status = os.waitpid(-1, 0x40000000)
        if os.WIFEXITED(status) or os.WIFSIGNALED(status):
            tracees.discard(pid)
            if pid == child:
                exit_code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else 128 + os.WTERMSIG(status)
            continue
        if not os.WIFSTOPPED(status):
            continue
        stopped, event = os.WSTOPSIG(status), status >> 16
        if event in (1, 2, 3):
            spawned = c.c_ulonglong()
            ptrace(0x4201, pid, 0, c.addressof(spawned))
            tracees.add(spawned.value)
        if stopped == (signal.SIGTRAP | 0x80):
            info = c.create_string_buffer(128)
            ptrace(0x420e, pid, 128, c.addressof(info))
            operation = info.raw[0]
            regs = Registers()
            ptrace(12, pid, 0, c.addressof(regs))
            if operation == 1 and regs.orig_rax == 18:
                try:
                    file = os.readlink(f"/proc/{pid}/fd/{regs.rdi}")
                except OSError:
                    file = ""
                owned = file.startswith(str(home) + "/")
                text = memory(pid, regs.rsi, min(regs.rdx, 64)) if owned else b""
                carrier = file == str(target)
                marker = carrier and text.startswith(b'{"type":"omp_generation_commit"')
                conversion = carrier and regs.rdx == 7 and text == b"ompgen1"
                append = carrier and text.startswith(b'{"type":') and not marker
                selected = carrier or file.startswith(str(target.parent / ("." + target.name + ".omp-generations")) + "/")
                if selected:
                    pending[pid] = {"file": "carrier" if carrier else "generation", "count": regs.rdx,
                                    "fault": None, "short": False}
                if not fired and ((fault == "swap-first-write" and append) or (fault == "swap-commit" and marker)):
                    fired = True
                    target.rename(str(target) + ".moved")
                    with open(str(target) + ".replacement", "rb") as source, open(target, "xb") as destination:
                        shutil.copyfileobj(source, destination)
                    audit(fault, boundary="before_pwrite64", tracee=pid)
                if not fired and ((fault == "short-marker" and marker) or (fault == "short-conversion" and conversion)):
                    fired = True
                    regs.rdx = 3 if conversion else 20
                    ptrace(13, pid, 0, c.addressof(regs))
                    pending[pid]["fault"], pending[pid]["short"] = fault, True
                if not fired and ((fault == "crash-prepared-body" and file.endswith(".gen"))
                                  or (fault == "crash-prepared-metadata" and file.endswith(".meta"))
                                  or (fault == "crash-after-conversion" and conversion)
                                  or (fault == "crash-after-commit" and marker)):
                    fired = True
                    pending[pid]["fault"] = fault
            elif operation == 2 and pid in pending:
                action = pending.pop(pid)
                result = c.c_longlong(regs.rax).value
                audit("pwrite-target", returned=result, target=action["file"], tracee=pid)
                if action["short"]:
                    audit(action["fault"], actual_written=result, injected_return=-errno.ENOSPC)
                    regs.rax = c.c_ulonglong(-errno.ENOSPC).value
                    ptrace(13, pid, 0, c.addressof(regs))
                elif action["fault"]:
                    assert result == action["count"], action
                    audit(action["fault"], committed_syscall_bytes=result, tracee=pid)
                    os.kill(child, signal.SIGKILL)
                    exit_code = 91
        delivered = 0 if stopped in (signal.SIGSTOP, signal.SIGTRAP, signal.SIGTRAP | 0x80) else stopped
        try:
            ptrace(24, pid, 0, delivered)
        except OSError as error:
            if error.errno != errno.ESRCH:
                raise
finally:
    for pid in tracees:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
if fault.startswith("crash-") and fired:
    sys.exit(91)
sys.exit(exit_code if exit_code is not None else 98)
