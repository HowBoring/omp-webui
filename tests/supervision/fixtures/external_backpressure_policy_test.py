"""Pure callback tests; never import a runtime adapter or start an actor."""
import importlib.util
from pathlib import Path
import unittest
import errno
import ast
import json
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location(
    "policy", Path(__file__).with_name("external_backpressure_policy.py"))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


def source_function(name, namespace):
    """Select a def only; runtime imports/main/constructors are never evaluated."""
    source = Path(__file__).with_name("external_backpressure.py")
    tree = ast.parse(source.read_text())
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name]
    assert len(selected) == 1
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(source), "exec"), namespace)
    return namespace[name]


def io_class(name, namespace):
    source = Path(__file__).with_name("external_backpressure_io.py")
    tree = ast.parse(source.read_text())
    selected = [node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == name]
    assert len(selected) == 1
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(source), "exec"), namespace)
    return namespace[name]


class OwnerTests(unittest.TestCase):
    def test_constructor_failure_preserves_original_before_initialization(self):
        class Unknown:
            def __init__(self):
                raise KeyboardInterrupt()
        session = policy.Session()
        with self.assertRaises(KeyboardInterrupt):
            session.construct(Unknown)
        self.assertEqual(len(session.owners), 1)
        self.assertIsInstance(session.owners[0], Unknown)
        self.assertFalse(session.recovery_eligible())


class DeadlineTests(unittest.TestCase):
    def test_expired_or_failed_clock_never_accepts_echild(self):
        for clock in (lambda: 20, lambda: (_ for _ in ()).throw(KeyboardInterrupt())):
            observed = []
            def empty():
                observed.append(True)
                raise ChildProcessError()
            with self.assertRaises(BaseException):
                policy.empty_domain(clock, 20, empty)
            self.assertEqual(observed, [])

    def test_echild_crossing_deadline_is_failure(self):
        times = iter([19, 20])
        def empty():
            raise ChildProcessError()
        with self.assertRaisesRegex(policy.Refusal, "DOMAIN_TIMEOUT"):
            policy.empty_domain(lambda: next(times), 20, empty)

    def test_clean_empty_domain_before_deadline(self):
        def empty():
            raise ChildProcessError()
        policy.empty_domain(lambda: 19, 20, empty)


class WireTests(unittest.TestCase):
    def test_partial_queue_writes_must_reach_real_eagain(self):
        writes = iter([4096, 32, BlockingIOError(errno.EAGAIN, "full")])
        def send(raw):
            self.assertEqual(raw, b"!" * 4096)
            value = next(writes)
            if isinstance(value, BaseException):
                raise value
            return value
        self.assertEqual(policy.fill_queue(lambda: 0, 5, send), (4128, errno.EAGAIN))

    def test_full_megabyte_without_eagain_is_refused(self):
        with self.assertRaisesRegex(policy.Refusal, "QUEUE_NOT_BLOCKED"):
            policy.fill_queue(lambda: 0, 5, lambda raw: 4096)

    def test_late_complete_and_unclean_eof_are_refused(self):
        for frames in ([b"!!!", b"COMPLETE g\n", b"x"], [b"!?!", b"COMPLETE g\n", b""]):
            received = iter(frames)
            with self.assertRaises(policy.Refusal):
                policy.drain(lambda size, until: next(received), lambda until: next(received), 3, b"COMPLETE g\n", 5)

    def test_exact_filler_complete_eof(self):
        received = iter([b"!!", b"!", b"COMPLETE g\n", b""])
        policy.drain(lambda size, until: next(received), lambda until: next(received), 3, b"COMPLETE g\n", 5)


class RecoveryTests(unittest.TestCase):
    def prepared(self):
        session = policy.Session()
        session.protector = session.keep(object())
        session.pidfd = session.keep(object())
        session.identity = (5, 1234)
        session.failed = session.started = session.root_zero = True
        return session

    def test_no_control_when_durable_intent_fails(self):
        for failure in (OSError, KeyboardInterrupt):
            session = self.prepared()
            calls = []
            def journal(value):
                raise failure()
            with self.assertRaises(failure):
                policy.recover(session, session.identity, journal, lambda fd: calls.append(fd))
            self.assertEqual(calls, [])
            self.assertEqual(len(session.owners), 2)
            self.assertFalse(session.recovery_eligible())

    def test_only_original_pidfd_once_after_natural_root_zero(self):
        session = self.prepared()
        calls = []
        policy.recover(session, (5, 1234), lambda value: None, lambda fd: calls.append(fd))
        self.assertEqual(calls, [session.pidfd])
        with self.assertRaisesRegex(policy.Refusal, "RECOVERY_INELIGIBLE"):
            policy.recover(session, (5, 1234), lambda value: None, lambda fd: calls.append(fd))
        self.assertEqual(len(calls), 1)

    def test_unknown_phase_or_changed_descriptor_never_signals(self):
        for field in ("started", "root_zero", "protector", "pidfd"):
            session = self.prepared()
            setattr(session, field, None)
            with self.assertRaisesRegex(policy.Refusal, "RECOVERY_INELIGIBLE"):
                policy.recover(session, (5, 1234), lambda value: None, lambda fd: self.fail("signal"))
        session = self.prepared()
        with self.assertRaisesRegex(policy.Refusal, "PIDFD_IDENTITY_CHANGED"):
            policy.recover(session, (5, 1235), lambda value: None, lambda fd: self.fail("signal"))

    def test_hold_survives_reporting_interrupt_and_wait_errors(self):
        session = self.prepared()
        def broken():
            raise KeyboardInterrupt()
        policy.hold_tick(broken, broken)
        self.assertEqual(len(session.owners), 2)


class PublicProtocolTests(unittest.TestCase):
    def scenario(self, last):
        session = policy.Session()
        session.protector = SimpleNamespace(pid=77)
        frames = iter([b"HELLO g 77 100 78 101\n", b"STATE g waiting\n", b"STATE g running\n", last])
        sent = []
        journal = SimpleNamespace(save=lambda *args, **kw: None)
        event = SimpleNamespace(set=lambda: None, wait=lambda seconds: True)
        dispatcher = SimpleNamespace(completing=event, business=event, failure=None)
        class FakeJournal:
            def __init__(self, *args):
                pass
            def save(self, *args):
                pass
        def gate(*args):
            self.assertEqual(sent, [])
        def write(fd, raw):
            self.assertEqual(sent, [b"START g\n"])
            self.assertTrue(session.started)
            self.assertFalse(session.root_zero)
            self.assertEqual(raw, b"X")
            return 1
        function = source_function("protocol_start", {
            "line": lambda *args: next(frames), "require": policy.require, "GENERATION": "g", "BUDGET": 5,
            "time": SimpleNamespace(monotonic=lambda: 0), "STAGE": Path("/synthetic"), "Journal": FakeJournal,
            "gate": gate, "send": lambda peer, raw, until: sent.append(raw), "wait_ready": lambda *args: None,
            "os": SimpleNamespace(write=write)})
        return session, lambda: function(session, object(), 9, dispatcher, journal)

    def test_start_gate_then_exact_natural_root_zero_establishes_recovery_proof(self):
        session, run = self.scenario(b"ROOT_EXIT g 0 0\n")
        run()
        self.assertTrue(session.started and session.root_zero)

    def test_other_root_status_cannot_authorize_recovery(self):
        for frame in (b"ROOT_EXIT g 0 9\n", b"ROOT_EXIT other 0 0\n", b"COMPLETE g\n"):
            session, run = self.scenario(frame)
            with self.assertRaisesRegex(policy.Refusal, "EXACT_NATURAL_ROOT_EXIT_ZERO_REQUIRED"):
                run()
            self.assertFalse(session.root_zero)

    def test_controller_interrupt_keeps_unknown_constructor_and_all_owners(self):
        session = policy.Session()
        original = session.keep(object())
        class Held(BaseException):
            pass
        def fail(*args):
            session.keep(object())
            raise KeyboardInterrupt()
        function = source_function("controller", {
            "start_protector": fail, "report": lambda value: False,
            "hold": lambda: (_ for _ in ()).throw(Held())})
        def journal_failure(*args, **kwargs):
            raise OSError()
        with self.assertRaises(Held):
            function(session, SimpleNamespace(save=journal_failure))
        self.assertIs(session.owners[0], original)
        self.assertEqual(len(session.owners), 2)
        self.assertTrue(session.failed)


class SystemBoundaryTests(unittest.TestCase):
    def test_dispatcher_exact_ack_and_unique_request_ids(self):
        for duplicate in (False, True):
            generation, installation = "g" * 64, "f" * 64
            ids = ["1" * 64, ("1" if duplicate else "2") * 64]
            requests = iter([json.dumps({"version": "omp-execution-external/1", "id": identifier,
                                        "installation": installation, "operation": {"op": op, "generation": generation}})
                             for identifier, op in zip(ids, ("register_external", "complete_external"))])
            sent = []
            dispatcher_type = io_class("Dispatcher", {
                "json": json, "time": SimpleNamespace(monotonic=lambda: 0), "BUDGET": 5,
                "require": policy.require, "line": lambda *args: next(requests),
                "send": lambda peer, raw, until: sent.append(json.loads(raw))})
            dispatcher = dispatcher_type.__new__(dispatcher_type)
            dispatcher.session = policy.Session()
            original_peer = object()
            dispatcher.listener = SimpleNamespace(accept=lambda: (original_peer, ""))
            dispatcher.generation, dispatcher.installation = generation, installation
            dispatcher.journal = SimpleNamespace(save=lambda *args, **kwargs: None)
            event = SimpleNamespace(set=lambda: None, wait=lambda *args: True)
            dispatcher.business = dispatcher.completing = dispatcher.release = event
            dispatcher.finish = dispatcher.ack = dispatcher.done = event
            dispatcher.failure = None
            dispatcher.serve()
            self.assertIs(dispatcher.session.owners[0][0], original_peer)
            self.assertEqual(len(sent), 1 if duplicate else 2)
            self.assertEqual(sent[0], {"version": "omp-execution-external/1", "id": "1" * 64, "ok": True,
                                       "operation": "register_external", "generation": generation})
            self.assertEqual(dispatcher.failure, "DISPATCHER_AMBIGUITY" if duplicate else None)

    def test_directory_fsync_failure_keeps_journal_descriptor_and_owner(self):
        opened = iter([101, 102])
        fsyncs = []
        def fsync(fd):
            fsyncs.append(fd)
            if fd == 102:
                raise OSError()
        class Lock:
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
        fake_os = SimpleNamespace(open=lambda *args: next(opened), write=lambda fd, raw: min(7, len(raw)),
                                  fsync=fsync, O_WRONLY=1, O_CREAT=2, O_EXCL=4, O_NOFOLLOW=8,
                                  O_CLOEXEC=16, O_RDONLY=32, O_DIRECTORY=64)
        journal_type = io_class("Journal", {
            "os": fake_os, "threading": SimpleNamespace(Lock=Lock), "json": json,
            "time": SimpleNamespace(monotonic=lambda: 0), "require": policy.require})
        session = policy.Session()
        with self.assertRaises(OSError):
            session.construct(journal_type, session, Path("/synthetic/journal"))
        self.assertEqual(fsyncs, [101, 102])
        self.assertTrue(session.owners[0].failed)
        self.assertEqual(session.owners[1:], [101, 102])

    def test_reader_overflow_is_sticky_but_data_stays_bounded_until_real_eof(self):
        chunks = iter([b"a" * 4096] * 17 + [b""])
        eof = []
        reader_type = io_class("Reader", {"os": SimpleNamespace(read=lambda *args: next(chunks))})
        reader = reader_type.__new__(reader_type)
        reader.fd, reader.relay, reader.failure = 90, False, None
        reader.raw = bytearray()
        reader.eof = SimpleNamespace(set=lambda: eof.append(True))
        reader.read()
        self.assertEqual(len(reader.raw), 65536)
        self.assertEqual(reader.failure, "OUTPUT_LIMIT")
        self.assertEqual(eof, [True])


class OuterDeadlineTests(unittest.TestCase):
    def run_outer(self, late=False, clock_failure=False):
        session = policy.Session()
        waited = []
        events = []
        class Child:
            def __init__(self, *args, **kwargs):
                self.pid = 88
            def wait(self, timeout):
                waited.append(0)
                return 0
        class FakePath:
            def __init__(self, *args):
                pass
            def resolve(self):
                return self
            def __truediv__(self, other):
                return self
            def exists(self):
                return True
        times = iter([0, 0, 21] + [21] * 20) if late else iter([0] * 30)
        def clock():
            if clock_failure:
                raise KeyboardInterrupt()
            return next(times)
        def empty(*args):
            raise ChildProcessError()
        journal = SimpleNamespace(save=lambda name, **kw: events.append(name))
        reader = SimpleNamespace(relay=False, finish=lambda *args: None)
        function = source_function("outer", {
            "output_pipes": lambda session: ((11, 12), (13, 14), [reader, reader]),
            "pipes": lambda session: (61, 62), "subprocess": SimpleNamespace(Popen=Child),
            "Path": FakePath, "__file__": "source", "MARKER": "m", "ROOT": "source", "RUNNER_ENV": {},
            "proof_original": lambda *args: 17, "identity": lambda fd: (5, 200),
            "os": SimpleNamespace(close=lambda fd: None, getpid=lambda: 87, write=lambda fd, raw: len(raw)),
            "wait_ready": lambda *args: None, "time": SimpleNamespace(monotonic=clock), "BUDGET": 5,
            "STAGE": FakePath(), "select": SimpleNamespace(select=lambda *args: ([17], [], [])),
            "require": policy.require, "remaining": policy.remaining,
            "domain_empty": lambda until, journal, role: policy.empty_domain(clock, until, empty),
            "report": lambda value: True})
        return session, waited, events, lambda: function(session, journal, "a" * 64)

    def test_actual_reap_eof_echild_after_expiry_never_becomes_normal_pass(self):
        _session, waited, events, run = self.run_outer(late=True)
        self.assertEqual(run(), 2)
        self.assertEqual(waited, [0])
        self.assertIn("OUTER_LATE_OR_MANUAL_DRAINED_NOT_PASS", events)

    def test_clock_failure_does_not_infer_wait_or_drop_original_owner(self):
        session, waited, _events, run = self.run_outer(clock_failure=True)
        with self.assertRaises(KeyboardInterrupt):
            run()
        self.assertEqual(waited, [])
        self.assertEqual(len(session.owners), 1)

    def test_normal_original_drainage_before_expiry(self):
        _session, waited, events, run = self.run_outer()
        self.assertEqual(run(), 0)
        self.assertEqual(waited, [0])
        self.assertIn("OUTER_PASS_DRAINED", events)


if __name__ == "__main__":
    unittest.main()
