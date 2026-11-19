#!/usr/bin/env python3
"""Real native strict-RPC evidence for durable navigation (ticket #37).

Every case drives an actual vendor/omp-strict worker over public JSONL RPC v2:
new session, two prompts, isolated tree snapshot, explicit navigation, then a
successor process verifies the durable position.  Crash cases SIGKILL the
worker while a navigation is mid-hook; the write-failure case runs the worker
under the syscall fault controller.  Output is a sanitized JSON record.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUN = shutil.which("bun") or "/home/howboring/.bun/bin/bun"
CLI = ROOT / "vendor/omp-strict/packages/coding-agent/src/cli.ts"
EXTENSION = ROOT / "compatibility/omp/fixtures/navigation-provider.ts"
GUARD = ROOT / "compatibility/omp/fixtures/no-provider.ts"
FAULTS = ROOT / "tests/continuation/syscall-faults.py"
CASE_TIMEOUT = 120.0
HEX64 = re.compile(r"^[a-f0-9]{64}$")


class RpcError(Exception):
    pass


def hex64(label: str) -> str:
    return hashlib.sha256(label.encode()).hexdigest()


def git_tree(path: Path) -> str:
    return subprocess.run(["git", "-C", str(path), "write-tree"], check=True,
                          capture_output=True, text=True).stdout.strip()


def wait_file(path: Path, timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.exists():
            return
        time.sleep(0.02)
    raise TimeoutError(str(path))


class Worker:
    def __init__(self, name: str, home: Path, *, resume: str | None = None,
                 hook: str | None = None, fault: str | None = None,
                 carrier: Path | None = None):
        self.name = name
        self.home = home
        self.cwd = home / "project"
        self.cwd.mkdir(parents=True, exist_ok=True)
        (home / ".omp/agent").mkdir(parents=True, exist_ok=True)
        self.resume = resume
        self.hook = hook
        self.fault = fault
        self.carrier = carrier
        self.proc: subprocess.Popen[str] | None = None
        self.binding: dict = {}
        self.pending: dict[str, dict] = {}

    def env(self) -> dict[str, str]:
        env = {k: v for k, v in os.environ.items()
               if k not in {"OMP_STRICT_FAULT", "OMP_STRICT_FAULT_TARGET", "OMP_STRICT_FIXTURE_HOME"}}
        env.update({
            "HOME": str(self.home), "PI_CODING_AGENT_DIR": str(self.home / ".omp/agent"),
            "BUN_RUNTIME_TRANSPILER_CACHE_PATH": "0", "NODE_DISABLE_COMPILE_CACHE": "1",
        })
        if self.hook:
            env["OMP_NAVIGATION_HOOK"] = self.hook
        if self.fault and self.carrier:
            env.update({"OMP_STRICT_FAULT": self.fault, "OMP_STRICT_FAULT_TARGET": str(self.carrier),
                        "OMP_STRICT_FIXTURE_HOME": str(self.home)})
        return env

    def start(self) -> None:
        args = [BUN, "--no-env-file", "--no-install", "--preload", str(GUARD), str(CLI),
                "--mode", "rpc-ui", "--strict-start", "--offline", "--no-lsp", "--no-skills",
                "--no-rules", "--no-spotlight", "--no-judge", "--no-context-files",
                "--model", "navigation-controlled/literal", "--trusted-extension", str(EXTENSION)]
        command = [sys.executable, str(FAULTS), *args] if self.fault else args
        self.proc = subprocess.Popen(command, env=self.env(), cwd=str(ROOT / "vendor/omp-strict"),
                                     text=True,
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, bufsize=1)
        while (ready := self.read()).get("type") != "ready":
            pass
        self.command({"type": "negotiate_protocol", "protocolVersion": 2})
        command = {"type": "strict_start", "intent": "new", "expectedCwd": str(self.cwd.resolve())}
        if self.resume:
            command.update(intent="continue", reference=self.resume)
        data = self.command(command)["data"]
        self.binding = data["binding"]

    def read(self) -> dict:
        assert self.proc and self.proc.stdout
        deadline = time.monotonic() + CASE_TIMEOUT
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"{self.name}: no frame")
            line = self.proc.stdout.readline()
            if line:
                return json.loads(line)
            if self.proc.poll() is not None:
                stderr = self.proc.stderr.read() if self.proc.stderr else ""
                raise RpcError(f"{self.name}: exited {self.proc.returncode}: {stderr[-2000:]}")

    def command(self, payload: dict) -> dict:
        assert self.proc and self.proc.stdin
        payload = {"id": str(uuid.uuid4()), **payload}
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()
        self.pending[payload["id"]] = payload
        while True:
            frame = self.read()
            if frame.get("id") != payload["id"]:
                continue
            if frame.get("success") is True:
                return frame
            error = frame.get("error") or {}
            if isinstance(error, dict):
                raise RpcError(f"{self.name}: {payload['type']} -> {error.get('code')}: {error.get('message')}")
            raise RpcError(f"{self.name}: {payload['type']} -> {error}")

    def data_command(self, payload: dict) -> dict:
        return self.command(payload)["data"]

    def submit(self, text: str) -> dict:
        submission = {
            "type": "submission_submit",
            "sourceId": self.binding["sourceId"], "instanceId": self.binding["instanceId"],
            "nativeSessionId": self.binding["nativeSessionId"],
            "clientSubmissionId": f"navigation-fixture-{uuid.uuid4()}",
            "preparationId": f"prep:{uuid.uuid4()}", "inputType": "prompt",
            "message": text, "idleOnly": True,
        }
        ack = self.data_command(submission)
        client = submission["clientSubmissionId"]
        deadline = time.monotonic() + CASE_TIMEOUT
        while True:
            state = self.data_command({"type": "submission_query", "clientSubmissionId": client,
                                       "limit": 128})
            final = state.get("state") or state
            if final.get("terminal") is True or final.get("persistence") in {"failed", "unknown"}:
                return {"ack": ack, "final": final, "query": state}
            if time.monotonic() > deadline:
                raise TimeoutError(f"{self.name}: submission did not finish: {state}")
            time.sleep(0.05)

    def tree(self) -> dict:
        opened = self.data_command({"type": "history_snapshot_open", "scope": "tree"})
        snapshot, cursor, items = opened["snapshot"], opened.get("cursor"), []
        try:
            while cursor is not None:
                page = self.data_command({"type": "history_snapshot_page", "cursor": cursor})
                items.extend(page["items"])
                cursor = page.get("cursor")
        finally:
            self.data_command({"type": "history_snapshot_close", "snapshot": snapshot})
        return {"cut": opened["cut"], "items": items}

    def leaf(self) -> str:
        return self.tree()["cut"]["leafId"]

    def message_entry(self, needle: str) -> dict:
        for item in self.tree()["items"]:
            if item.get("role") == "user" and needle in (item.get("text") or ""):
                return item
        raise AssertionError(f"{self.name}: no user item containing {needle!r}")

    def inspect(self, entry_id: str) -> dict:
        return self.data_command({"type": "navigation_inspect", "entryId": entry_id})

    def navigate(self, navigation_id: str, entry_id: str, preview: dict, *, summarize: bool) -> dict:
        return self.data_command({
            "type": "navigate_tree_committed", "navigationId": navigation_id,
            "sourceId": self.binding["sourceId"], "instanceId": self.binding["instanceId"],
            "nativeSessionId": self.binding["nativeSessionId"], "entryId": entry_id,
            "expectedContextRevision": preview["contextRevision"],
            "expectedTargetRevision": preview["targetRevision"], "summarize": summarize,
        })

    def query(self, navigation_id: str) -> dict:
        return self.data_command({"type": "navigation_query", "navigationId": navigation_id})

    def kill(self) -> int:
        assert self.proc
        os.kill(self.proc.pid, signal.SIGKILL)
        return self.proc.wait(timeout=30)

    def close(self) -> int:
        assert self.proc
        if self.proc.poll() is None:
            self.proc.stdin.close()
            try:
                return self.proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                raise
        return self.proc.returncode


def carrier_for(home: Path, native_session_id: str) -> Path:
    matches = sorted(home.glob(f".omp/agent/sessions/*/*{native_session_id}.jsonl"))
    if len(matches) != 1:
        raise AssertionError(f"expected one carrier for {native_session_id}, got {matches}")
    return matches[0]


def failure_code(callable_) -> str:
    try:
        callable_()
    except RpcError as error:
        return str(error).split(" -> ", 1)[1].split(":", 1)[0]
    raise AssertionError("call unexpectedly succeeded")


def conversation_position(tree: dict) -> str:
    items = {item["id"]: item for item in tree["items"]}
    current = tree["cut"]["leafId"]
    while current is not None and items.get(current, {}).get("kind") == "custom":
        current = items[current]["parentId"]
    assert current is not None
    return current


def exit_records(carrier: Path) -> list[dict]:
    return [record for record in map(json.loads, carrier.read_text().splitlines())
            if record.get("customType") == "session_exit"]


def receipt_shape(result: dict) -> dict:
    keys = ["outcome", "persistence", "reservation", "terminal", "found", "duplicate", "admission",
            "requestedTargetId", "targetParentId", "summaryEntryId", "summaryOrigin", "draftOriginEntryId",
            "draftStatus", "beforeHookInvoked", "beforeHookCompleted", "summaryHookInvoked",
            "summaryHookCompleted", "treeHookInvoked", "treeHookCompleted", "hookChangedLeaf",
            "actualLeafId", "commitId"]
    return {key: result.get(key) for key in keys if result.get(key) is not None}


def case_committed(base: Path) -> dict:
    home = base / "navigation-home"
    worker = Worker("committed", home)
    worker.start()
    first = worker.submit("fixture prompt 1")
    worker.submit("fixture prompt 2")
    before = worker.tree()
    target = worker.message_entry("fixture prompt 1")
    carrier = carrier_for(home, worker.binding["nativeSessionId"])
    digest_before = hashlib.sha256(carrier.read_bytes()).hexdigest()
    preview = worker.inspect(target["entryId"])
    digest_after = hashlib.sha256(carrier.read_bytes()).hexdigest()
    assert digest_before == digest_after, "inspect must not write"
    navigation_id = f"fixture-committed-{uuid.uuid4()}"
    result = worker.navigate(navigation_id, target["entryId"], preview, summarize=True)
    reply_leaf = worker.leaf()
    query = worker.query(navigation_id)
    assert result["terminal"] is True and result["persistence"] == "committed"
    assert result["actualLeafId"] == result["summaryEntryId"] == reply_leaf, "summary entry is the committed leaf"
    assert query["found"] is True and query["commitId"] == result["commitId"]
    audit = json.loads((home / "navigation-hooks.json").read_text())
    provider_effects = json.loads((home / "navigation-provider-effects.json").read_text())
    worker.close()
    successor = Worker("committed-successor", home, resume=worker.binding["reference"])
    successor.start()
    resumed = successor.tree()
    resumed_query = successor.query(navigation_id)
    successor.close()
    exits = exit_records(carrier)
    assert exits and exits[0]["data"]["reason"] == "dispose", exits
    assert exits[0]["parentId"] == result["actualLeafId"], (exits[0]["parentId"], result["actualLeafId"])
    assert conversation_position(resumed) == result["actualLeafId"], resumed["cut"]["leafId"]
    assert resumed_query["found"] is True and resumed_query["persistence"] == "committed"
    return {
        "firstSubmission": {"ackPersistence": first["ack"].get("persistence"),
                            "finalPersistence": first["final"].get("persistence"),
                            "finalTerminal": first["final"].get("terminal")},
        "treeBefore": before, "target": target, "preview": preview,
        "navigate": result, "navigateShape": receipt_shape(result),
        "query": query, "replyLeaf": reply_leaf, "inspectWriteBytes": [digest_before, digest_after],
        "hooks": audit, "providerCalls": provider_effects.get("calls"),
        "providerRealInference": provider_effects.get("realInference"),
        "normalExit": {"records": len(exits), "reason": exits[0]["data"]["reason"],
                       "parentId": exits[0]["parentId"], "id": exits[0]["id"]},
        "resumedTree": resumed, "resumedQuery": resumed_query,
    }


def case_crash_after_reply(base: Path) -> dict:
    home = base / "navigation-home"
    worker = Worker("crash", home)
    worker.start()
    worker.submit("fixture prompt 1")
    worker.submit("fixture prompt 2")
    target = worker.message_entry("fixture prompt 1")
    preview = worker.inspect(target["entryId"])
    navigation_id = f"fixture-crash-{uuid.uuid4()}"
    result = worker.navigate(navigation_id, target["entryId"], preview, summarize=True)
    assert result["persistence"] == "committed" and result["terminal"] is True
    reply_leaf = worker.leaf()
    exit_signal = worker.kill()  # no further prompt, no native exit marker
    successor = Worker("crash-successor", home, resume=worker.binding["reference"])
    successor.start()
    resumed = successor.tree()
    query = successor.query(navigation_id)
    successor.close()
    assert resumed["cut"]["leafId"] == reply_leaf, (reply_leaf, resumed["cut"])
    return {"navigate": result, "navigateShape": receipt_shape(result), "replyLeaf": reply_leaf,
            "exitSignal": exit_signal, "resumedTree": resumed, "query": query}


def case_cancelled(base: Path) -> dict:
    home = base / "navigation-home"
    worker = Worker("cancelled", home, hook="cancel")
    worker.start()
    worker.submit("fixture prompt 1")
    worker.submit("fixture prompt 2")
    target = worker.message_entry("fixture prompt 1")
    preview = worker.inspect(target["entryId"])
    before_leaf = worker.leaf()
    navigation_id = f"fixture-cancel-{uuid.uuid4()}"
    result = worker.navigate(navigation_id, target["entryId"], preview, summarize=False)
    after_leaf = worker.leaf()
    query = worker.query(navigation_id)
    hooks = json.loads((home / "navigation-hooks.json").read_text())
    worker.close()
    successor = Worker("cancelled-successor", home, resume=worker.binding["reference"])
    successor.start()
    resumed = successor.tree()
    resumed_query = successor.query(navigation_id)
    successor.close()
    assert result["outcome"] == "cancelled" and result["terminal"] is True
    assert result["persistence"] == "committed"
    assert result.get("summaryEntryId") is None and result["actualLeafId"] == before_leaf
    assert after_leaf == before_leaf
    assert conversation_position(resumed) == before_leaf, resumed["cut"]["leafId"]
    return {"navigate": result, "navigateShape": receipt_shape(result), "beforeLeaf": before_leaf,
            "afterLeaf": after_leaf, "query": query, "hooks": hooks,
            "resumedTree": resumed, "resumedQuery": resumed_query}


def case_unknown_receipt_crash(base: Path) -> dict:
    home = base / "navigation-home"
    seed = Worker("unknown-seed", home)
    seed.start()
    seed.submit("fixture prompt 1")
    seed.submit("fixture prompt 2")
    before = seed.tree()
    seed.close()
    carrier = carrier_for(home, seed.binding["nativeSessionId"])
    worker = Worker("unknown-fault", home, resume=seed.binding["reference"],
                    fault="crash-navigation-receipt", carrier=carrier)
    worker.start()
    target = worker.message_entry("fixture prompt 1")
    preview = worker.inspect(target["entryId"])
    navigation_id = f"fixture-unknown-{uuid.uuid4()}"
    worker.proc.stdin.write(json.dumps({
        "id": str(uuid.uuid4()), "type": "navigate_tree_committed", "navigationId": navigation_id,
        "sourceId": worker.binding["sourceId"], "instanceId": worker.binding["instanceId"],
        "nativeSessionId": worker.binding["nativeSessionId"], "entryId": target["entryId"],
        "expectedContextRevision": preview["contextRevision"],
        "expectedTargetRevision": preview["targetRevision"], "summarize": False,
    }) + "\n")
    worker.proc.stdin.flush()
    exit_status = worker.close()
    successor = Worker("unknown-successor", home, resume=seed.binding["reference"])
    successor.start()
    resumed = successor.tree()
    query = successor.query(navigation_id)
    after_query = successor.tree()
    successor.close()
    durable = [json.loads(line)["data"]["payload"]["value"]["result"] for line in
               carrier.read_text().splitlines() if "navigation-v1" in line]
    assert exit_status == 91, exit_status
    assert [record["outcome"] for record in durable] == ["reserved"], durable
    assert query["found"] is True and query["outcome"] == "reserved", query
    assert query["persistence"] == "unresolved" and query["terminal"] is False, query
    assert query.get("actualLeafId") is None and query.get("commitId") is None, query
    assert conversation_position(resumed) == conversation_position(before), (resumed["cut"]["leafId"], before)
    assert after_query["cut"]["leafId"] == resumed["cut"]["leafId"], "query must not execute"
    assert before["cut"]["leafId"] != target["entryId"]
    return {"exitStatus": exit_status, "durable": durable, "beforeTree": before,
            "targetEntryId": target["entryId"],
            "resumedTree": resumed, "afterQueryTree": after_query,
            "query": query, "queryShape": receipt_shape(query)}


def case_write_failure(base: Path) -> dict:
    home = base / "navigation-home"
    seed = Worker("write-seed", home)
    seed.start()
    seed.submit("fixture prompt 1")
    seed.submit("fixture prompt 2")
    seed.close()
    carrier = carrier_for(home, seed.binding["nativeSessionId"])
    worker = Worker("write-fault", home, resume=seed.binding["reference"], fault="refuse-navigation",
                    carrier=carrier)
    worker.start()
    target = worker.message_entry("fixture prompt 1")
    preview = worker.inspect(target["entryId"])
    navigation_id = f"fixture-write-{uuid.uuid4()}"
    result = worker.navigate(navigation_id, target["entryId"], preview, summarize=True)
    query = worker.query(navigation_id)
    worker.close()
    successor = Worker("write-successor", home, resume=seed.binding["reference"])
    successor.start()
    resumed = successor.tree()
    successor_query = successor.query(navigation_id)
    successor.close()
    assert result["persistence"] == "unknown" and result["terminal"] is False
    assert result["outcome"] == "unknown"
    assert query["found"] is False and query["outcome"] == "unknown"
    assert query["persistence"] == "unknown" and query["code"] == "NAVIGATION_SOURCE_UNREADABLE"
    assert successor_query["found"] is True and successor_query["outcome"] == "reserved"
    assert successor_query["persistence"] == "unresolved" and successor_query["terminal"] is False
    assert successor_query.get("actualLeafId") is None and successor_query.get("commitId") is None
    durable = [json.loads(line)["data"]["payload"]["value"]["result"] for line in
               carrier.read_text().splitlines() if "navigation-v1" in line]
    assert [record["outcome"] for record in durable] == ["reserved"], durable
    return {"navigate": result, "navigateShape": receipt_shape(result), "query": query,
            "resumedTree": resumed, "queryAfterRestart": successor_query,
            "queryShape": receipt_shape(successor_query)}


def case_invalid_target(base: Path) -> dict:
    home = base / "navigation-home"
    worker = Worker("invalid", home)
    worker.start()
    worker.submit("fixture prompt 1")
    before = worker.tree()
    inspect_error = failure_code(lambda: worker.inspect("f" * 32))
    preview = worker.inspect(worker.message_entry("fixture prompt 1")["entryId"])
    navigation_id = f"fixture-invalid-{uuid.uuid4()}"
    navigate_error = None
    try:
        worker.navigate(navigation_id, "f" * 32, preview, summarize=False)
    except RpcError as error:
        navigate_error = str(error).split(" -> ", 1)[1].split(":", 1)[0]
    query = worker.query(navigation_id)
    after = worker.tree()
    worker.close()
    assert inspect_error and navigate_error
    assert after["cut"]["leafId"] == before["cut"]["leafId"]
    return {"inspectError": inspect_error, "navigateError": navigate_error,
            "query": query, "queryFound": query.get("found"), "beforeTree": before,
            "afterTree": after}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workdir", type=Path)
    parser.add_argument("--cases", default="all")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    args.workdir.mkdir(parents=True, exist_ok=True)
    source_tree = git_tree(ROOT / "vendor/omp-strict")
    assert source_tree == "b102d9db2b9b91e7baa1de484ca901705785993b", source_tree
    selected = ["committed", "crash", "cancelled", "unknown", "write", "invalid"] \
        if args.cases == "all" else args.cases.split(",")
    cases = {"committed": case_committed, "crash": case_crash_after_reply,
             "cancelled": case_cancelled, "unknown": case_unknown_receipt_crash,
             "write": case_write_failure, "invalid": case_invalid_target}
    evidence = {"kind": "native-durable-navigation", "sourceTree": source_tree,
                "nativeVersion": json.loads((ROOT / "vendor/omp-strict/packages/coding-agent/package.json")
                                            .read_text())["version"]}
    for name in selected:
        shutil.rmtree(args.workdir / name, ignore_errors=True)
        started = time.monotonic()
        evidence[name] = cases[name](args.workdir / name)
        evidence[name]["seconds"] = round(time.monotonic() - started, 2)
        print(f"[{name}] ok {evidence[name]['seconds']}s", file=sys.stderr)
    output = args.output or args.workdir / "navigation-native.json"
    output.write_text(json.dumps(evidence, indent=2) + "\n")
    print(str(output))
    return 0


if __name__ == "__main__":
    sys.exit(main())
