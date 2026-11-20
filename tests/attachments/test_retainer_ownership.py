"""Finite pure lifecycle fakes: never create a process, thread or timer."""
import unittest

import retainer_ownership as ownership
from retainer_ownership import run_owned


class HoldObserved(BaseException):
    """Escape a fake HOLD callback immediately, without a fake polling loop."""


class FakeChild:
    def __init__(self):
        self.stdout = object()
        self.stderr = object()
        self.waited = False

    def wait(self):
        self.waited = True
        return 0


class FakeReader:
    def __init__(self, failure=None):
        self.failure = failure

    def start(self):
        if self.failure:
            raise self.failure

    def join(self):
        pass


class OwnershipTests(unittest.TestCase):
    def test_postspawn_failures_hold_at_each_lifecycle_boundary(self):
        for stage in ("construct-stdout", "construct-stderr", "start-stdout", "start-stderr",
                      "started", "wait", "join-stdout", "join-stderr"):
            for failure_type in (RuntimeError, KeyboardInterrupt, SystemExit):
                with self.subTest(stage=stage, error=failure_type.__name__):
                    child = FakeChild()
                    held = []
                    created = []
                    captures = {label: {"streamEof": True} for label in ("stdout", "stderr")}

                    def fail(boundary):
                        if stage == boundary:
                            raise failure_type("fake lifecycle failure")

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
                        created.append((label, reader))
                        return reader

                    def wait():
                        fail("wait")
                        return 0

                    def hold(owner):
                        held.append(owner)
                        raise HoldObserved()

                    child.wait = wait
                    with self.assertRaises(HoldObserved):
                        run_owned(lambda: child, make_reader, lambda owner: fail("started"), captures, hold)
                    self.assertEqual(len(held), 1)
                    owner = held[0]
                    self.assertIs(owner["child"], child)
                    self.assertIs(owner["pipes"]["stdout"], child.stdout)
                    self.assertIs(owner["pipes"]["stderr"], child.stderr)
                    self.assertEqual(owner["readers"], created)
                    self.assertEqual(owner["state"], "HOLD")
                    self.assertEqual(owner["failure"]["type"], failure_type.__name__)
                    self.assertEqual(owner["waitObserved"], stage.startswith("join-"))

    def test_complete_original_wait_and_eof_release_for_result_accounting(self):
        child = FakeChild()
        captures = {"stdout": {"streamEof": True, "pass": False},
                    "stderr": {"streamEof": True, "pass": True}}
        owner = run_owned(lambda: child, lambda label, pipe: FakeReader(), lambda owner: None,
                          captures, lambda owner: self.fail("complete lifecycle entered HOLD"))
        self.assertIs(owner["child"], child)
        self.assertTrue(owner["waitObserved"])
        self.assertEqual(owner["waitStatus"], 0)
        self.assertEqual(owner["joined"], ["stdout", "stderr"])
        self.assertEqual(owner["state"], "COMPLETE")
        self.assertFalse(owner["captures"]["stdout"]["pass"])

    def test_spawn_failure_has_no_original_handle_to_hold(self):
        def spawn():
            raise OSError("fake failure before handle returned")
        with self.assertRaisesRegex(OSError, "before handle returned"):
            run_owned(spawn, None, None, {}, lambda owner: self.fail("no child to hold"))

    def test_returning_hold_callback_cannot_release_unresolved_child(self):
        child = FakeChild()
        held = []

        def hold(owner):
            held.append(owner)
            if len(held) == 2:
                raise HoldObserved()

        with self.assertRaises(HoldObserved):
            run_owned(lambda: child, lambda label, pipe: FakeReader(RuntimeError("start fault")),
                      lambda owner: None, {}, hold)
        self.assertEqual(len(held), 2)
        self.assertIs(held[0], held[1])
        self.assertIs(held[0]["child"], child)

    def test_hold_reporting_and_pause_faults_do_not_discard_original_references(self):
        child = FakeChild()
        reports = []
        held = []

        def persist(report):
            reports.append(report)
            raise OSError("fake report failure")

        def pause():
            raise KeyboardInterrupt()

        def hold(owner):
            held.append(owner)
            ownership.hold_step(owner, persist, pause)
            ownership.hold_step(owner, persist, pause)
            raise HoldObserved()

        with self.assertRaises(HoldObserved):
            run_owned(lambda: child, lambda label, pipe: FakeReader(RuntimeError("start fault")),
                      lambda owner: None, {}, hold)
        self.assertIs(held[0]["child"], child)
        self.assertEqual(len(reports), 2)
        self.assertEqual(reports[0], reports[1])
        self.assertEqual(reports[0]["status"], "HOLD_ORIGINAL_OWNERSHIP_UNRESOLVED")
        self.assertFalse(reports[0]["pass"])
        self.assertFalse(reports[0]["originalWaitObserved"])

    def test_missing_eof_holds_even_after_original_wait_and_both_joins(self):
        child = FakeChild()
        held = []
        captures = {"stdout": {"streamEof": True}, "stderr": {"streamEof": False}}

        def hold(owner):
            held.append(owner)
            raise HoldObserved()

        with self.assertRaises(HoldObserved):
            run_owned(lambda: child, lambda label, pipe: FakeReader(), lambda owner: None, captures, hold)
        self.assertIs(held[0]["child"], child)
        self.assertIs(held[0]["captures"], captures)
        self.assertTrue(held[0]["waitObserved"])
        self.assertEqual(held[0]["joined"], ["stdout", "stderr"])
        self.assertEqual(held[0]["state"], "HOLD")

    def test_second_reader_start_fault_holds_original_child_pipes_and_readers(self):
        child = FakeChild()
        readers = [FakeReader(), FakeReader(RuntimeError("fake second start"))]
        held = []

        def hold(owner):
            held.append(owner)
            raise HoldObserved()

        with self.assertRaises(HoldObserved):
            run_owned(lambda: child, lambda label, pipe: readers[0 if label == "stdout" else 1],
                      lambda owner: None, {}, hold)
        self.assertEqual(len(held), 1)
        self.assertIs(held[0]["child"], child)
        self.assertIs(held[0]["pipes"]["stdout"], child.stdout)
        self.assertIs(held[0]["pipes"]["stderr"], child.stderr)
        self.assertEqual(held[0]["readers"], list(zip(("stdout", "stderr"), readers)))
        self.assertEqual(held[0]["state"], "HOLD")
        self.assertFalse(held[0]["waitObserved"])
        self.assertFalse(child.waited)


if __name__ == "__main__":
    unittest.main()
