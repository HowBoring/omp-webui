"""Owned Linux x86_64 syscall controller: observe/fault genuine Bun pwrite64 at the kernel boundary.
EXITKILL ensures no tracee survives this fixture controller. No attach or unrelated process control exists.
"""
import ctypes as c
import errno
import json
import os
import pathlib
import platform
import resource
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

def string_memory(pid, address):
    output = bytearray()
    for offset in range(0, 4096, 8):
        chunk = memory(pid, address + offset, 8)
        if b"\0" in chunk:
            return bytes(output) + chunk.split(b"\0", 1)[0]
        output.extend(chunk)
    raise ValueError("fixture pathname limit")

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
open_pending, parent_opens, cwd_pinned, carrier_writable = {}, 0, False, False
fired = False
open_fault_completed = False
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
            try:
                ptrace(0x420e, pid, 128, c.addressof(info))
            except ProcessLookupError:
                continue
            operation = info.raw[0]
            regs = Registers()
            try:
                ptrace(12, pid, 0, c.addressof(regs))
            except ProcessLookupError:
                continue
            if operation == 1 and regs.orig_rax in (2, 257) and fault in ("native-parent-emfile", "swap-after-reservation-parent"):
                address, flags = (regs.rdi, regs.rsi) if regs.orig_rax == 2 else (regs.rsi, regs.rdx)
                name = os.fsdecode(string_memory(pid, address))
                resolved_name = name
                if name.startswith("/proc/self/fd/"):
                    try:
                        resolved_name = os.readlink(name.replace("/proc/self/", f"/proc/{pid}/", 1))
                    except OSError:
                        pass
                if resolved_name == str(target) and flags & os.O_RDWR:
                    carrier_writable = True
                if carrier_writable and name == str(home / "project") and flags & os.O_DIRECTORY:
                    cwd_pinned = True
                if name == str(target.parent) and flags & os.O_DIRECTORY:
                    parent_opens += 1
                    if not fired and (fault == "native-parent-emfile" or cwd_pinned):
                        fired = True
                        previous = resource.prlimit(pid, resource.RLIMIT_NOFILE) if fault == "native-parent-emfile" else None
                        if previous:
                            resource.prlimit(pid, resource.RLIMIT_NOFILE, (3, previous[1]))
                        open_pending[pid] = previous
            elif operation == 2 and pid in open_pending:
                previous = open_pending.pop(pid)
                result = c.c_longlong(regs.rax).value
                if previous:
                    resource.prlimit(pid, resource.RLIMIT_NOFILE, previous)
                    assert result == -errno.EMFILE, result
                else:
                    assert result >= 0, result
                    target.rename(str(target) + ".moved")
                    shutil.copyfile(str(target) + ".replacement", target)
                audit(fault, boundary="open-directory-return", returned=result, parent_opens=parent_opens)
                open_fault_completed = True
            elif operation == 1 and regs.orig_rax == 18:
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
                anonymous_copy = owned and file.startswith(str(target.parent) + "/") and "/#" in file and file.endswith(" (deleted)")
                selected = carrier or anonymous_copy or file.startswith(str(target.parent / ("." + target.name + ".omp-generations")) + "/")
                if selected:
                    pending[pid] = {"file": "carrier" if carrier else "generation", "count": regs.rdx,
                                    "fault": None, "short": False}
                if not fired and ((fault == "swap-first-write" and append) or (fault == "swap-commit" and marker)):
                    fired = True
                    target.rename(str(target) + ".moved")
                    with open(str(target) + ".replacement", "rb") as source, open(target, "xb") as destination:
                        shutil.copyfileobj(source, destination)
                    audit(fault, boundary="before_pwrite64", tracee=pid)
                if not fired and ((fault == "short-marker" and marker) or (fault == "short-conversion" and conversion) or (fault == "short-new-copy" and anonymous_copy)):
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
if fault in ("native-parent-emfile", "swap-after-reservation-parent") and not open_fault_completed:
    audit("intended-open-fault-not-completed", fault=fault)
    sys.exit(97)
sys.exit(exit_code if exit_code is not None else 98)
