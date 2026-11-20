"""Pure launch/lifecycle fakes; no processes, threads, timers or runtime imports."""
import unittest

import retainer_launch_ownership as ownership
from retainer_launch_ownership import run_owned


class HoldObserved(BaseException):
    """Finite fake HOLD escape, deliberately outside the lifecycle catch."""


class LaunchOwnershipTests(unittest.TestCase):
    def test_creation_then_constructor_failure_retains_exact_original_object(self):
        child = object.__new__(type("FakeChild", (), {}))
        held = []

        def initialize(original):
            original.stdout, original.stderr = object(), object()
            original.created = True
            raise RuntimeError("created child before constructor returned")

        def hold(owner):
            held.append(owner)
            raise HoldObserved()

        with self.assertRaises(HoldObserved):
            run_owned(lambda: child, initialize, None, None, {}, hold)
        self.assertEqual(len(held), 1)
        owner = held[0]
        self.assertIs(owner["child"], child)
        self.assertTrue(child.created)
        self.assertIs(owner["pipes"]["stdout"], child.stdout)
        self.assertIs(owner["pipes"]["stderr"], child.stderr)
        self.assertFalse(owner["waitObserved"])
        self.assertEqual(owner["state"], "HOLD")

    def test_all_constructor_failures_hold_even_without_creation_proof(self):
        for phase in ("before-pipes", "stdout-only", "after-creation"):
            for failure_type in (OSError, KeyboardInterrupt, SystemExit):
                with self.subTest(phase=phase, failure=failure_type.__name__):
                    child = object.__new__(type("PartialChild", (), {}))
                    held = []

                    def initialize(original):
                        if phase != "before-pipes":
                            original.stdout = object()
                        if phase == "after-creation":
                            original.stderr = object()
                            original.created = True
                        raise failure_type("constructor failed")

                    def hold(owner):
                        held.append(owner)
                        raise HoldObserved()

                    with self.assertRaises(HoldObserved):
                        run_owned(lambda: child, initialize, None, None, {}, hold)
                    owner = held[0]
                    self.assertIs(owner["child"], child)
                    self.assertTrue(owner["launchAttempted"])
                    self.assertFalse(owner["initializerReturned"])
                    self.assertFalse(owner["waitObserved"])
                    self.assertEqual(owner["joined"], [])
                    self.assertEqual(owner["failure"]["type"], failure_type.__name__)
                    if phase != "before-pipes":
                        self.assertIs(owner["pipes"]["stdout"], child.stdout)
                    if phase == "after-creation":
                        self.assertIs(owner["pipes"]["stderr"], child.stderr)

    def test_no_returned_object_never_proves_no_child(self):
        for outcome in ("none", "raise-before-return", "created-then-raise-before-return"):
            with self.subTest(outcome=outcome):
                held, created = [], []

                def allocate():
                    if outcome == "none":
                        return None
                    if outcome == "created-then-raise-before-return":
                        created.append(object())
                    raise OSError("no returned handle")

                def hold(owner):
                    held.append(owner)
                    raise HoldObserved()

                with self.assertRaises(HoldObserved):
                    run_owned(allocate, lambda child: self.fail("no object for initialization"),
                              None, None, {}, hold)
                self.assertEqual(len(held), 1)
                self.assertIsNone(held[0]["child"])
                self.assertTrue(held[0]["launchAttempted"])
                self.assertFalse(held[0]["waitObserved"])
                self.assertEqual(held[0]["state"], "HOLD")
                if outcome == "created-then-raise-before-return":
                    self.assertEqual(len(created), 1)

    def test_pipe_reference_failure_cannot_escape_constructor_hold(self):
        class PartialChild:
            @property
            def stdout(self):
                raise KeyboardInterrupt()

        child = PartialChild()
        child.stderr = object()
        held = []

        def initialize(original):
            raise SystemExit()

        def hold(owner):
            held.append(owner)
            raise HoldObserved()

        with self.assertRaises(HoldObserved):
            run_owned(lambda: child, initialize, None, None, {}, hold)
        self.assertIs(held[0]["child"], child)
        self.assertIs(held[0]["pipes"]["stderr"], child.stderr)
        self.assertEqual(held[0]["failure"]["type"], "SystemExit")


class FakeChild:
    def __init__(self):
        self.stdout, self.stderr = object(), object()

    def wait(self):
        return 0


class FakeReader:
    def start(self):
        pass

    def join(self):
        pass


class LifecycleOwnershipTests(unittest.TestCase):
    def test_postinitialization_fault_matrix_retains_originals(self):
        for stage in ("construct-stdout", "construct-stderr", "start-stdout", "start-stderr",
                      "started", "wait", "join-stdout", "join-stderr"):
            for failure_type in (RuntimeError, KeyboardInterrupt, SystemExit):
                with self.subTest(stage=stage, failure=failure_type.__name__):
                    child, held, readers = FakeChild(), [], []
                    captures = {label: {"streamEof": True} for label in ("stdout", "stderr")}

                    def fail(boundary):
                        if stage == boundary:
                            raise failure_type("lifecycle failure")

                    class Reader(FakeReader):
                        def __init__(self, label):
                            self.label = label

                        def start(self):
                            fail("start-" + self.label)

                        def join(self):
                            fail("join-" + self.label)

                    def make_reader(label, pipe):
                        fail("construct-" + label)
                        reader = Reader(label)
                        readers.append((label, reader))
                        return reader

                    def wait():
                        fail("wait")
                        return 0

                    def hold(owner):
                        held.append(owner)
                        raise HoldObserved()

                    child.wait = wait
                    with self.assertRaises(HoldObserved):
                        run_owned(lambda: child, lambda original: None, make_reader,
                                  lambda owner: fail("started"), captures, hold)
                    owner = held[0]
                    self.assertIs(owner["child"], child)
                    self.assertIs(owner["pipes"]["stdout"], child.stdout)
                    self.assertIs(owner["pipes"]["stderr"], child.stderr)
                    self.assertEqual(owner["readers"], readers)
                    self.assertIs(owner["captures"], captures)
                    self.assertTrue(owner["initializerReturned"])
                    self.assertEqual(owner["waitObserved"], stage.startswith("join-"))
                    self.assertEqual(owner["state"], "HOLD")

    def test_complete_original_wait_joins_and_eof_allow_capture_failure_accounting(self):
        child = FakeChild()
        captures = {"stdout": {"streamEof": True, "pass": False}, "stderr": {"streamEof": True}}
        owner = run_owned(lambda: child, lambda original: None, lambda label, pipe: FakeReader(),
                          lambda owner: None, captures, lambda owner: self.fail("unexpected HOLD"))
        self.assertIs(owner["child"], child)
        self.assertTrue(owner["waitObserved"])
        self.assertEqual(owner["waitStatus"], 0)
        self.assertEqual(owner["joined"], ["stdout", "stderr"])
        self.assertEqual(owner["state"], "COMPLETE")
        self.assertFalse(owner["captures"]["stdout"]["pass"])

    def test_missing_eof_holds_after_original_wait_and_joins(self):
        held = []

        def hold(owner):
            held.append(owner)
            raise HoldObserved()

        with self.assertRaises(HoldObserved):
            run_owned(FakeChild, lambda original: None, lambda label, pipe: FakeReader(),
                      lambda owner: None, {"stdout": {"streamEof": True}}, hold)
        self.assertTrue(held[0]["waitObserved"])
        self.assertEqual(held[0]["joined"], ["stdout", "stderr"])
        self.assertEqual(held[0]["state"], "HOLD")

    def test_returning_hold_callback_cannot_release_unknown_launch(self):
        held = []

        def hold(owner):
            held.append(owner)
            if len(held) == 2:
                raise HoldObserved()

        with self.assertRaises(HoldObserved):
            run_owned(lambda: None, None, None, None, {}, hold)
        self.assertEqual(len(held), 2)
        self.assertIs(held[0], held[1])

    def test_persistence_and_pause_failures_preserve_partial_original(self):
        child, held, reports = FakeChild(), [], []

        def initialize(original):
            raise KeyboardInterrupt()

        def persist(report):
            reports.append(report)
            raise OSError("report failure")

        def pause():
            raise SystemExit()

        def hold(owner):
            held.append(owner)
            ownership.hold_step(owner, persist, pause)
            ownership.hold_step(owner, persist, pause)
            raise HoldObserved()

        with self.assertRaises(HoldObserved):
            run_owned(lambda: child, initialize, None, None, {}, hold)
        self.assertIs(held[0]["child"], child)
        self.assertEqual(len(reports), 2)
        self.assertEqual(reports[0], reports[1])
        self.assertEqual(reports[0]["status"], "HOLD_ORIGINAL_OWNERSHIP_UNRESOLVED")
        self.assertTrue(reports[0]["originalObjectRetained"])
        self.assertFalse(reports[0]["initializerReturned"])
        self.assertFalse(reports[0]["originalWaitObserved"])
        self.assertEqual(reports[0]["retry"], "NONE")
        self.assertEqual(reports[0]["release"], "NONE")


if __name__ == "__main__":
    unittest.main()
