"""Source-only fixture policy at the agreed OS/supervisor callback seam.

Import has no filesystem, process, clock, native or signal effects.
"""
import errno


class Refusal(RuntimeError):
    """Stable fixture failure code."""


def require(condition, code):
    if not condition:
        raise Refusal(code)


def remaining(clock, until, code):
    value = until - clock()
    require(value > 0, code)
    return value


def empty_domain(clock, until, wait):
    remaining(clock, until, "DOMAIN_TIMEOUT")
    try:
        wait()
    except ChildProcessError:
        remaining(clock, until, "DOMAIN_TIMEOUT")
        return
    remaining(clock, until, "DOMAIN_TIMEOUT")
    raise Refusal("DOMAIN_NOT_EMPTY")


def fill_queue(clock, until, send):
    filled = 0
    while filled < 1_048_576:
        remaining(clock, until, "QUEUE_TIMEOUT")
        try:
            count = send(b"!" * 4096)
        except BlockingIOError as error:
            remaining(clock, until, "QUEUE_TIMEOUT")
            require(error.errno in (errno.EAGAIN, errno.EWOULDBLOCK), "QUEUE_ERROR")
            require(0 < filled < 1_048_576, "QUEUE_NOT_BLOCKED")
            return filled, error.errno
        remaining(clock, until, "QUEUE_TIMEOUT")
        require(0 < count <= 4096, "QUEUE_WRITE")
        filled += count
    raise Refusal("QUEUE_NOT_BLOCKED")


def drain(receive, line, filled, complete, until):
    left = filled
    while left:
        chunk = receive(min(left, 4096), until)
        require(chunk and len(chunk) <= left and chunk == b"!" * len(chunk), "FILLER_MISMATCH")
        left -= len(chunk)
    require(line(until) == complete, "COMPLETE_MISMATCH")
    require(receive(1, until) == b"", "UNCLEAN_EOF")


def recover(session, identity, journal, kill_original_pidfd):
    """Caller has consumed a fresh Root challenge for this one held original object.

    No retry even when journalling or the syscall raises. Completion and normal
    cleanup are permanently ineligible. This is manual recovery, never PASS.
    """
    require(session.recovery_eligible(), "RECOVERY_INELIGIBLE")
    require(identity == session.identity, "PIDFD_IDENTITY_CHANGED")
    session.signal_attempted = True
    journal("MANUAL_ORIGINAL_PROTECTOR_SIGKILL_INTENT")
    kill_original_pidfd(session.pidfd)
    journal("MANUAL_SIGNAL_RETURNED_NO_TERMINAL_INFERENCE")


def hold_tick(report, wait):
    for callback in (report, wait):
        try:
            callback()
        except BaseException:
            pass


class Session:
    """Own every original resource before fallible initialization; never dispose on failure."""
    def __init__(self):
        self.owners = []
        self.protector = None
        self.pidfd = None
        self.identity = None
        self.started = False
        self.root_zero = False
        self.failed = False
        self.signal_attempted = False

    def keep(self, owner):
        self.owners.append(owner)
        return owner

    def construct(self, constructor, *args, **kwargs):
        owner = self.keep(constructor.__new__(constructor))
        constructor.__init__(owner, *args, **kwargs)
        return owner

    def recovery_eligible(self):
        return (self.failed and self.started and self.root_zero and self.protector is not None
                and self.pidfd is not None and self.identity is not None and not self.signal_attempted)
