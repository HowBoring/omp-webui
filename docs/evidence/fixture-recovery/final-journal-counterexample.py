"""Independent pure-fake counterexample; accepts a source file, never its ONE-run entry."""
from contextlib import ExitStack
import importlib.util
import json
import sys
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("retainer_counterexample", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with ExitStack() as guards:
    for target, name in [(module.os, "pidfd_open"), (module.os, "read"),
                         (module.os, "set_blocking"), (module.os, "urandom"),
                         (module.subprocess, "Popen"), (module.signal, "pidfd_send_signal")]:
        guards.enter_context(patch.object(target, name, side_effect=AssertionError("unfaked boundary: " + name)))
    guards.enter_context(patch.object(module.selectors, "DefaultSelector", return_value=object()))
    original = SimpleNamespace(wait=lambda **_options: -15)
    retainer = module.Retainer(challenge_factory=lambda: "c" * 32)
    retainer.emit = lambda _value: None
    retainer.children = {"native": original}
    retainer.pidfds = {"native": 99}
    retainer.generation, retainer.phase = "a" * 64, "NATIVE_AWAIT_READY"
    retainer.launch_returned = {"native"}
    retainer.buffers = {("native", "stdout"): b"", ("native", "stderr"): b""}
    retainer.reader_channels = retainer.eof = set(retainer.buffers)
    retainer.failures = [{"role": "native", "code": "ownership_unresolved",
                          "codeSource": "public_code", "phase": "native_server_open"}]
    retainer.enter_hold(RuntimeError("RETAINER_CHILD_RETAINED_FAILURE"))
    retainer.recovery_attempted = True
    failed_emissions = []
    def fail_final(value):
        if value["journal"][-1]["event"] == "RECOVERY_COMPLETE_RUN_STILL_FAILED":
            failed_emissions.append(value["status"])
            raise OSError("injected final journal failure")
    retainer.emit = fail_final
    poll = SimpleNamespace(register=lambda *_args: None, poll=lambda _timeout: [(99, module.select.POLLIN)])
    guards.enter_context(patch.object(module.select, "poll", return_value=poll))
    guards.enter_context(patch.object(module.os, "waitid", side_effect=ChildProcessError))
    close = guards.enter_context(patch.object(module.os, "close"))
    assert retainer.recovery_step() is False
    assert retainer.recovery_step() is False
    print(json.dumps({"finalJournalFailures": len(failed_emissions),
                      "closeCalls": [call.args[0] for call in close.call_args_list],
                      "sameOriginalChild": retainer.children["native"] is original,
                      "status": retainer.receipt()["status"]}))
    assert failed_emissions == ["FAILED_EARLY_NATIVE_ORIGINAL_DOMAIN_DRAINED"]
    assert retainer.children["native"] is original
    close.assert_not_called()
    print("PASS_FINAL_JOURNAL_FAILURE_RETAINS_ORIGINAL_PIDFD")
