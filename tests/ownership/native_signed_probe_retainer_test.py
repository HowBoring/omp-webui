"""Public Retainer fault boundary with inert OS adapters; no retainer import, ctypes, main or real launch/wait."""
import ast
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

SOURCE = Path(__file__).resolve().parents[2] / "scripts/retain-native-signed-probe.py"


class ResultFile(io.StringIO):
    def __init__(self, system):
        super().__init__()
        self.system = system

    def __exit__(self, *args):
        self.system.result = json.loads(self.getvalue())
        return super().__exit__(*args)


class FakeSystem:
    O_CLOEXEC, O_WRONLY, O_CREAT, O_EXCL = 1, 2, 4, 8
    POSIX_SPAWN_DUP2, P_ALL, P_PIDFD = 9, 10, 11
    WEXITED, WNOHANG, WNOWAIT, CLD_EXITED = 16, 32, 64, 1

    def __init__(self, fault=None, read_error=False):
        self.fault, self.read_error = fault, read_error
        self.pipe_count = self.next_fd = 0
        self.opened = {}
        self.pipe_writers = {}
        self.child_alive = self.spawned = False
        self.wait_round = 0
        self.result = None
        self.early_reader_closes = []
        self.read_attempts = 0
        self.read_faults = {}
        self.close_faults = set()
        self.now = 0
        self.path = SimpleNamespace(lexists=lambda _path: False)

    def descriptor(self, kind):
        self.next_fd += 1
        self.opened[self.next_fd] = kind
        return self.next_fd

    def pipe2(self, _flags):
        self.pipe_count += 1
        if self.fault == f"pipe{self.pipe_count}":
            raise OSError("injected pipe exhaustion")
        reader = self.descriptor("input-reader" if self.pipe_count == 1 else "reader")
        writer = self.descriptor("writer")
        self.pipe_writers[reader] = writer
        return reader, writer

    def open(self, path, _flags, _mode):
        if self.fault == path.name:
            raise FileExistsError("injected occupied/unavailable log")
        return self.descriptor(path.name)

    def close(self, descriptor):
        if self.opened[descriptor] == "reader" and self.child_alive:
            self.early_reader_closes.append(descriptor)
        del self.opened[descriptor]
        if descriptor in self.close_faults:
            raise OSError("injected failed-reader close error")

    def set_blocking(self, _descriptor, _blocking):
        pass

    def chdir(self, _path):
        if self.fault == "chdir":
            raise OSError("injected cwd failure")

    def posix_spawn(self, _command, _argv, _environment, *, file_actions):
        self.child_alive = self.spawned = True
        return 777

    def pidfd_open(self, _pid):
        if self.fault == "pidfd":
            raise OSError("injected original pidfd acquisition failure")
        return self.descriptor("pidfd")

    def waitid(self, kind, _identity, _flags):
        if kind == self.P_PIDFD:
            return None
        if not self.spawned or self.wait_round >= 2:
            raise ChildProcessError()
        self.wait_round += 1
        if self.wait_round == 1:
            return None
        self.child_alive = False
        return SimpleNamespace(si_pid=777, si_code=self.CLD_EXITED, si_status=0)

    def read(self, descriptor, _size):
        self.read_attempts += 1
        fault = self.read_faults.pop(descriptor, None)
        if fault is not None:
            raise fault
        if self.read_error:
            raise OSError("injected nonrecoverable original-reader failure")
        if self.pipe_writers[descriptor] in self.opened or self.child_alive:
            raise BlockingIOError()
        return b""

    def write(self, _descriptor, data):
        return len(data)

    def fdopen(self, descriptor, _mode):
        self.close(descriptor)
        return ResultFile(self)

    def getpid(self):
        return 9000

    def select(self, readers, _writers, _errors, _timeout):
        return list(readers), [], []

    def poll(self):
        return SimpleNamespace(register=lambda *_args: None, poll=lambda _timeout: [(99, 1)])


def retainer(system):
    tree = ast.parse(SOURCE.read_text())
    selected = [node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Retainer"]
    scope = {"os": system, "time": SimpleNamespace(monotonic=lambda: system.now), "json": json, "WALL": 0,
             "select": SimpleNamespace(select=system.select, poll=system.poll, POLLIN=1, POLLHUP=2,
                                       POLLERR=4, POLLNVAL=8), "report": lambda _result: None}
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(SOURCE), "exec"), scope)
    return scope["Retainer"](Path("/tmp/inert-retainer-fixture"))


class RetainerFailureTest(unittest.TestCase):
    def test_pre_spawn_failures_release_own_pipe_writers_and_finish_after_actual_eof(self):
        for fault in ["pipe1", "pipe2", "pipe3", "stdout.log", "stderr.log", "chdir"]:
            with self.subTest(fault=fault):
                system = FakeSystem(fault)
                owner = retainer(system)
                with self.assertRaises(OSError):
                    owner.launch()
                owner.uncertain()  # Same public exception handoff as main, without executing main.
                self.assertFalse(system.spawned)
                self.assertNotIn("writer", system.opened.values(), "own writer would prevent real reader EOF")
                self.assertNotIn("input-reader", system.opened.values())
                self.assertEqual(owner.drain(), 1)
                self.assertEqual(system.result["status"], "FAIL")
                self.assertEqual(system.result["kernelEndpoint"], "P_ALL/ECHILD")
                self.assertEqual(system.result["originalReadersEof"], fault in ["stdout.log", "stderr.log", "chdir"])
                self.assertEqual(system.opened, {})

    def test_pidfd_failure_preserves_launched_child_until_exit_reader_eof_and_echild(self):
        system = FakeSystem("pidfd")
        owner = retainer(system)
        with self.assertRaises(OSError):
            owner.launch()
        owner.uncertain()
        self.assertTrue(system.child_alive)
        self.assertEqual(owner.drain(), 1)
        self.assertEqual(system.result["rootStatus"], {"pid": 777, "code": 1, "status": 0})
        self.assertTrue(system.result["originalReadersEof"])
        self.assertFalse(system.result["originalPidfdKernelExit"])
        self.assertEqual(system.early_reader_closes, [])
        self.assertEqual(system.opened, {})

    def test_nonrecoverable_read_failure_keeps_original_handles_until_child_exit_and_reports_failed_terminal(self):
        system = FakeSystem(read_error=True)
        owner = retainer(system)
        owner.launch()
        stdout_reader = list(system.pipe_writers)[1]
        owner.receive(stdout_reader)
        self.assertIn(stdout_reader, system.opened)
        self.assertTrue(system.child_alive)
        self.assertEqual(owner.drain(), 1)
        self.assertEqual(system.result["status"], "FAIL")
        self.assertFalse(system.result["originalReadersEof"])
        self.assertEqual(system.result["originalReaderOutcomes"], {"stdout": "FAILED", "stderr": "FAILED"})
        self.assertTrue(system.result["originalPidfdKernelExit"])
        self.assertEqual(system.early_reader_closes, [])
        self.assertEqual(system.opened, {})

    def test_read_failure_after_echild_reports_actual_mixed_reader_outcomes_even_if_failed_close_errors(self):
        system = FakeSystem()
        owner = retainer(system)
        owner.launch()
        system.wait_round = 1  # Fake kernel delivers original root exit and then ECHILD before reader readiness.
        stdout_reader = list(system.pipe_writers)[1]
        system.read_faults[stdout_reader] = OSError("injected terminal read error")
        system.close_faults.add(stdout_reader)
        self.assertEqual(owner.drain(), 1)
        self.assertFalse(system.result["originalReadersEof"])
        self.assertEqual(system.result["originalReaderOutcomes"], {"stdout": "FAILED", "stderr": "EOF"})
        self.assertEqual(system.opened, {})

    def test_interrupted_read_and_diagnostic_deadline_keep_waiting_for_actual_exit_and_eof(self):
        system = FakeSystem()
        owner = retainer(system)
        owner.launch()
        stdout_reader = list(system.pipe_writers)[1]
        system.read_faults[stdout_reader] = InterruptedError()
        owner.receive(stdout_reader)
        self.assertIn(stdout_reader, system.opened)
        system.now = 31
        self.assertEqual(owner.drain(), 1)
        self.assertEqual(system.result["rootStatus"], {"pid": 777, "code": 1, "status": 0})
        self.assertTrue(system.result["originalReadersEof"])
        self.assertEqual(system.result["originalReaderOutcomes"], {"stdout": "EOF", "stderr": "EOF"})
        self.assertEqual(system.early_reader_closes, [])
        self.assertEqual(system.opened, {})


if __name__ == "__main__":
    unittest.main()
