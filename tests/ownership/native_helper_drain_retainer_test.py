"""Public harness seams with fake OS boundaries only: no kernel preflight, actors or FFI."""
import importlib.util
import json
from types import SimpleNamespace
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("helper_retainer", ROOT / "scripts/retain-native-helper-drain.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeSelector:
    def __init__(self):
        self.registered = {}
        self.ready = []

    def register(self, stream, _events, data):
        self.registered[stream] = data

    def unregister(self, stream):
        del self.registered[stream]

    def select(self, _timeout):
        events, self.ready = self.ready, []
        return events


class RetainerOwnershipTests(unittest.TestCase):
    def setUp(self):
        # Any unplanned kernel/process operation fails the pure suite immediately.
        for target, name in [(module.os, "pidfd_open"), (module.os, "waitid"), (module.os, "read"),
                             (module.os, "set_blocking"), (module.os, "close"),
                             (module.signal, "pidfd_send_signal"), (module.select, "poll")]:
            guard = patch.object(target, name, side_effect=AssertionError("unfaked OS boundary: " + name))
            guard.start()
            self.addCleanup(guard.stop)

    def make_retainer(self):
        with patch.object(module.selectors, "DefaultSelector", FakeSelector):
            return module.Retainer()

    def test_constructor_baseexception_retains_exact_preallocated_original(self):
        allocated = []

        class InterruptedPopen:
            def __new__(cls, *_args, **_options):
                child = object.__new__(cls)
                allocated.append(child)
                return child

            def __init__(self, *_args, **_options):
                self.pid = 123
                raise KeyboardInterrupt()

        retainer = self.make_retainer()
        with patch.object(module.subprocess, "Popen", InterruptedPopen):
            with self.assertRaises(KeyboardInterrupt):
                retainer.spawn("native", "/tmp/fake-stage", "/fake/launcher")
        self.assertIs(retainer.children.get("native"), allocated[0])

    def test_authenticated_lowercase_failure_preserves_phase_and_source_in_hold_receipt(self):
        retainer = self.make_retainer()
        retainer.generation = "a" * 64
        retainer.children["native"] = SimpleNamespace(pid=123)
        channel, stream = ("native", "stdout"), SimpleNamespace(fileno=lambda: 10)
        retainer.buffers[channel], retainer.counts[channel] = b"", 0
        event = {"event": "FIXTURE_RETAINED_FAILURE", "code": "ownership_unresolved", "codeSource": "public_code",
                 "phase": "native_server_open", "pid": 123, "generation": "a" * 64,
                 "scope": "TWO_PROCESS_HELPER_FIXTURE_ONLY"}
        retainer.reader.ready = [(SimpleNamespace(data=channel, fileobj=stream), None)]
        with patch.object(module.os, "read", return_value=(json.dumps(event) + "\n").encode()):
            with self.assertRaisesRegex(RuntimeError, "RETAINER_CHILD_RETAINED_FAILURE"):
                retainer.advance(module.time.monotonic() + 1)
        self.assertEqual(retainer.failures, [{"role": "native", "code": "ownership_unresolved",
                                             "codeSource": "public_code", "phase": "native_server_open"}])
        self.assertEqual(retainer.history, [{"role": "native", **event}])

    def test_only_root_generation_command_can_recover_original_early_native_after_hold(self):
        retainer = self.make_retainer()
        receipts, operations = [], []
        retainer.emit = lambda value: receipts.append(json.loads(json.dumps(value)))
        retainer.generation, retainer.phase = "a" * 64, "NATIVE_AWAIT_READY"
        retainer.children["native"] = SimpleNamespace(wait=lambda **_options: operations.append("original_wait") or -15)
        retainer.pidfds["native"] = 99
        retainer.launch_returned.add("native")
        retainer.buffers = {("native", name): b"" for name in ("stdout", "stderr")}
        retainer.eof = set(retainer.buffers)
        retainer.reader_channels = set(retainer.buffers)
        retainer.failures = [{"role": "native", "code": "ownership_unresolved", "codeSource": "public_code",
                              "phase": "native_server_open"}]
        retainer.enter_hold(RuntimeError("RETAINER_CHILD_RETAINED_FAILURE"))
        self.assertEqual(operations, [])
        poll = SimpleNamespace(register=lambda *_args: None, poll=lambda _timeout: [(99, module.select.POLLIN)])
        def signal_original(descriptor, delivered, *_args):
            self.assertEqual((descriptor, delivered), (99, module.signal.SIGTERM))
            self.assertEqual(receipts[-1]["journal"][-1]["event"], "RECOVERY_SIGNAL_INTENT")
            operations.append("original_pidfd_signal")
        with patch.object(module.signal, "pidfd_send_signal", signal_original), \
                patch.object(module.select, "poll", return_value=poll), \
                patch.object(module.os, "waitid", side_effect=ChildProcessError), \
                patch.object(module.os, "close", side_effect=lambda descriptor: operations.append(("close", descriptor))):
            retainer.root_control(("RECOVER_EARLY_NATIVE " + "a" * 64 + "\n").encode())
            self.assertTrue(retainer.recovery_step())
        self.assertEqual(operations, ["original_pidfd_signal", "original_wait", ("close", 99)])
        self.assertEqual(receipts[-1]["status"], "FAILED_EARLY_NATIVE_ORIGINAL_DOMAIN_DRAINED")
        self.assertEqual(receipts[-1]["failurePhase"], "NATIVE_AWAIT_READY")
        self.assertFalse(receipts[-1]["fixtureAcceptance"])
        self.assertFalse(receipts[-1]["automaticCleanupAcceptance"])
        self.assertEqual(receipts[-1]["originalWaits"], {"native": -15})
        self.assertEqual(receipts[-1]["pAll"], "ECHILD")

    def test_failed_final_journal_never_releases_original_owner(self):
        retainer = self.make_retainer()
        retainer.holding, retainer.recovery_attempted = True, True
        retainer.children["native"] = SimpleNamespace(wait=lambda **_options: -15)
        retainer.pidfds["native"] = 99
        retainer.eof = {("native", "stdout"), ("native", "stderr")}
        def broken_final_journal(value):
            if value["status"] == "FAILED_EARLY_NATIVE_ORIGINAL_DOMAIN_DRAINED":
                raise OSError("fake journal failure")
        retainer.emit = broken_final_journal
        poll = SimpleNamespace(register=lambda *_args: None, poll=lambda _timeout: [(99, module.select.POLLIN)])
        with patch.object(module.select, "poll", return_value=poll), \
                patch.object(module.os, "waitid", side_effect=ChildProcessError), \
                patch.object(module.os, "close"):
            self.assertFalse(retainer.recovery_step())
            self.assertFalse(retainer.hold_step())
        self.assertEqual(retainer.receipt()["status"], "HOLD_ORIGINAL_LIFETIMES_RETAINED")

    def test_unknown_nominal_event_payload_cannot_enter_retained_journal(self):
        retainer = self.make_retainer()
        retainer.generation = "a" * 64
        retainer.children["native"] = SimpleNamespace(pid=123)
        channel, stream = ("native", "stdout"), SimpleNamespace(fileno=lambda: 10)
        retainer.buffers[channel], retainer.counts[channel] = b"", 0
        event = {"event": "NATIVE_READY", "pid": 123, "generation": "a" * 64,
                 "scope": "TWO_PROCESS_HELPER_FIXTURE_ONLY", "payload": "SECRET payload"}
        retainer.reader.ready = [(SimpleNamespace(data=channel, fileobj=stream), None)]
        with patch.object(module.os, "read", return_value=(json.dumps(event) + "\n").encode()):
            with self.assertRaisesRegex(RuntimeError, "RETAINER_EVENT_FIELDS"):
                retainer.advance(module.time.monotonic() + 1)
        self.assertEqual(retainer.history, [])

    def test_failed_output_drain_cannot_later_be_classified_terminal(self):
        retainer = self.make_retainer()
        retainer.emit = lambda _value: None
        retainer.holding, retainer.recovery_attempted = True, True
        retainer.children["native"] = SimpleNamespace(wait=lambda **_options: -15)
        retainer.pidfds["native"] = 99
        retainer.eof = {("native", "stdout"), ("native", "stderr")}
        with patch.object(retainer.reader, "select", side_effect=OSError("fake read failure")):
            self.assertFalse(retainer.hold_step())
        poll = SimpleNamespace(register=lambda *_args: None, poll=lambda _timeout: [(99, module.select.POLLIN)])
        with patch.object(module.select, "poll", return_value=poll), \
                patch.object(module.os, "waitid", side_effect=ChildProcessError), \
                patch.object(module.os, "close") as close:
            self.assertFalse(retainer.recovery_step())
            close.assert_not_called()

    def early_retainer(self):
        retainer = self.make_retainer()
        retainer.emit = lambda _value: None
        retainer.generation, retainer.phase = "a" * 64, "NATIVE_AWAIT_READY"
        retainer.children["native"] = SimpleNamespace(wait=lambda **_options: -15)
        retainer.pidfds["native"] = 99
        retainer.launch_returned.add("native")
        retainer.buffers = {("native", name): b"" for name in ("stdout", "stderr")}
        retainer.reader_channels = set(retainer.buffers)
        retainer.failures = [{"role": "native", "code": "ownership_unresolved", "codeSource": "public_code",
                              "phase": "native_server_open"}]
        retainer.enter_hold(RuntimeError("RETAINER_CHILD_RETAINED_FAILURE"))
        return retainer

    def test_missing_original_reader_registration_cannot_authorize_recovery_signal(self):
        retainer = self.early_retainer()
        retainer.reader_channels.remove(("native", "stderr"))
        with patch.object(module.signal, "pidfd_send_signal") as deliver:
            retainer.root_control(("RECOVER_EARLY_NATIVE " + "a" * 64 + "\n").encode())
            deliver.assert_not_called()
        self.assertFalse(retainer.recovery_attempted)

    def test_hold_drains_and_journals_already_buffered_original_events(self):
        retainer = self.early_retainer()
        retainer.children["native"].pid = 123
        event = {"event": "NATIVE_READY", "pid": 123, "generation": "a" * 64,
                 "scope": "TWO_PROCESS_HELPER_FIXTURE_ONLY"}
        retainer.buffers[("native", "stdout")] = (json.dumps(event) + "\n").encode()
        self.assertFalse(retainer.hold_step())
        self.assertEqual(retainer.history, [{"role": "native", **event}])

    def test_root_eof_invalid_generation_and_nonoriginal_authority_stay_hold_without_signals(self):
        for command in [b"", b"RECOVER_EARLY_NATIVE " + b"b" * 64 + b"\n", b"kill 123\n",
                        b'{"pid":123,"fd":99}\n', b"x" * 129,
                        b"RECOVER_EARLY_NATIVE " + b"a" * 64 + b"\nextra\n"]:
            with self.subTest(command=command[:24]):
                retainer = self.early_retainer()
                with patch.object(module.signal, "pidfd_send_signal") as deliver:
                    retainer.root_control(command)
                    self.assertFalse(retainer.hold_step())
                    deliver.assert_not_called()
                self.assertFalse(retainer.recovery_attempted)
                self.assertEqual(retainer.receipt()["status"], "HOLD_ORIGINAL_LIFETIMES_RETAINED")

    def test_later_host_unknown_and_partial_acquisitions_never_gain_recovery_authority(self):
        for fault in ["not_hold", "native_ready", "host_created", "pidfd_missing", "initializer_uncertain",
                      "later_phase", "no_failure", "drain_failed", "earlier_parent_drain"]:
            with self.subTest(fault=fault):
                retainer = self.early_retainer()
                if fault == "not_hold":
                    retainer.holding = False
                elif fault == "native_ready":
                    retainer.events["native"].append({"event": "NATIVE_READY"})
                elif fault == "host_created":
                    retainer.children["host"] = SimpleNamespace()
                elif fault == "pidfd_missing":
                    retainer.pidfds.clear()
                elif fault == "initializer_uncertain":
                    retainer.launch_returned.clear()
                elif fault == "later_phase":
                    retainer.failures[0]["phase"] = "native_close"
                elif fault == "no_failure":
                    retainer.failures.clear()
                elif fault == "drain_failed":
                    retainer.drain_fault = True
                elif fault == "earlier_parent_drain":
                    retainer.failure_code = "RETAINER_STDERR"
                with patch.object(module.signal, "pidfd_send_signal") as deliver:
                    retainer.root_control(("RECOVER_EARLY_NATIVE " + "a" * 64 + "\n").encode())
                    deliver.assert_not_called()
                self.assertFalse(retainer.recovery_attempted)

    def test_unresolved_wait_eof_pidfd_or_adopted_domain_never_releases_originals(self):
        for fault in ["wait_pending", "wait_failed", "missing_stdout_eof", "missing_stderr_eof",
                      "pidfd_live", "pidfd_error", "p_all_live", "p_all_adopted_zombie"]:
            with self.subTest(fault=fault):
                retainer = self.early_retainer()
                retainer.recovery_attempted = True
                retainer.eof = set(retainer.buffers)
                if fault == "wait_pending":
                    retainer.children["native"].wait = lambda **_kwargs: (_ for _ in ()).throw(
                        module.subprocess.TimeoutExpired("fake", 0))
                elif fault == "wait_failed":
                    retainer.children["native"].wait = lambda **_kwargs: (_ for _ in ()).throw(ChildProcessError())
                elif fault == "missing_stdout_eof":
                    retainer.eof.remove(("native", "stdout"))
                elif fault == "missing_stderr_eof":
                    retainer.eof.remove(("native", "stderr"))
                ready = [] if fault == "pidfd_live" else [(99, module.select.POLLIN)]
                if fault == "pidfd_error":
                    ready = [(99, module.select.POLLERR)]
                poll = SimpleNamespace(register=lambda *_args: None, poll=lambda _timeout: ready)
                with patch.object(module.select, "poll", return_value=poll), \
                        patch.object(module.os, "waitid", side_effect=None if fault.startswith("p_all") else ChildProcessError,
                                     return_value=None if fault == "p_all_live" else SimpleNamespace(si_pid=456)) as waitid, \
                        patch.object(module.os, "close") as close:
                    self.assertFalse(retainer.recovery_step())
                    close.assert_not_called()
                    if fault.startswith("p_all"):
                        waitid.assert_called_once_with(module.os.P_ALL, 0,
                            module.os.WEXITED | module.os.WNOHANG | module.os.WNOWAIT)
                self.assertEqual(retainer.receipt()["status"], "HOLD_ORIGINAL_LIFETIMES_RETAINED")

    def test_failed_signal_and_failed_intent_journal_never_retry(self):
        for fault in ["signal", "journal"]:
            with self.subTest(fault=fault):
                retainer = self.early_retainer()
                receipts = []
                def journal(value):
                    receipts.append(value["journal"][-1]["event"])
                    if fault == "journal" and receipts[-1] == "RECOVERY_SIGNAL_INTENT":
                        raise OSError("fake intent failure")
                retainer.emit = journal
                with patch.object(module.signal, "pidfd_send_signal", side_effect=OSError("fake signal failure")) as deliver:
                    command = ("RECOVER_EARLY_NATIVE " + "a" * 64 + "\n").encode()
                    retainer.root_control(command)
                    retainer.root_control(command)
                    self.assertFalse(retainer.hold_step())
                    self.assertEqual(deliver.call_count, 1 if fault == "signal" else 0)
                self.assertIn("RECOVERY_CONTROL_FAILED", receipts)
                self.assertTrue(retainer.recovery_fault)

    def test_all_post_constructor_acquisition_failures_keep_original_objects_and_partial_readers(self):
        class Stream:
            def __init__(self, descriptor):
                self.descriptor = descriptor
            def fileno(self):
                return self.descriptor
        class Popen:
            def __init__(self, *_args, **_options):
                self.pid, self.stdout, self.stderr = 123, Stream(10), Stream(11)
        for fault in ["pidfd", "stdout_blocking", "stdout_register", "stderr_blocking", "stderr_register"]:
            with self.subTest(fault=fault):
                retainer = self.make_retainer()
                retainer.emit = lambda _value: None
                def blocking(descriptor, _value):
                    if fault == ("stdout_blocking" if descriptor == 10 else "stderr_blocking"):
                        raise KeyboardInterrupt()
                def register(stream, events, key):
                    if fault == ("stdout_register" if stream.descriptor == 10 else "stderr_register"):
                        raise KeyboardInterrupt()
                    retainer.reader.registered[stream] = key
                with patch.object(module.subprocess, "Popen", Popen), \
                        patch.object(module.os, "pidfd_open", side_effect=KeyboardInterrupt if fault == "pidfd" else None,
                                     return_value=99), \
                        patch.object(module.os, "set_blocking", side_effect=blocking), \
                        patch.object(retainer.reader, "register", side_effect=register):
                    with self.assertRaises(KeyboardInterrupt):
                        retainer.spawn("native", "/tmp/fake-stage", "/fake/launcher")
                original = retainer.children["native"]
                retainer.enter_hold(KeyboardInterrupt())
                self.assertIs(retainer.children["native"], original)
                self.assertEqual(retainer.launch_returned, {"native"})
                self.assertNotEqual(retainer.reader_channels, {("native", "stdout"), ("native", "stderr")})
                self.assertFalse(retainer.hold_step())

    def test_parent_closed_set_accepts_every_public_code_and_rejects_unknown_payloads(self):
        for code in ["ownership_protocol", "ownership_limit", "dispatcher_unavailable", "dispatcher_mismatch",
                     "ownership_unresolved", "maintenance_fenced", "shared_service_unsupported",
                     "ownership_backend_unavailable", "DRAIN_V4_REQUIRED"]:
            retainer = self.early_retainer()
            retainer.failures.clear()
            retainer.children["native"].pid = 123
            event = {"event": "FIXTURE_RETAINED_FAILURE", "code": code, "codeSource": "fixture_message"
                     if code.startswith("DRAIN_") else "public_code", "phase": "native_approval",
                     "pid": 123, "generation": "a" * 64, "scope": "TWO_PROCESS_HELPER_FIXTURE_ONLY"}
            retainer.accept_event("native", event)
            self.assertEqual(retainer.failures[0]["code"], code)
        event["code"], event["codeSource"] = "SECRET_PAYLOAD", "public_code"
        with self.assertRaisesRegex(RuntimeError, "RETAINER_FAILURE_CODE"):
            retainer.accept_event("native", event)
        self.assertNotIn("SECRET_PAYLOAD", json.dumps(retainer.receipt()))


if __name__ == "__main__":
    unittest.main()
