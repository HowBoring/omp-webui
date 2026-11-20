"""Build an owned synthetic submission Session for the native TUI probe.

The caller supplies a sanitized HOME (name contains `submission-`) and the strict fixture entry. One deterministic
prompt is submitted through the public strict worker, so the resulting Session has genuine submission metadata and
generation sidecars; the TUI then opens that same file in place.
"""
import json
import os
import pathlib
import select
import subprocess
import sys

home = pathlib.Path(sys.argv[1]).resolve()
native_root = pathlib.Path(sys.argv[2]).resolve()
bun = sys.argv[3]
provider = pathlib.Path(sys.argv[4]).resolve()
guard = pathlib.Path(sys.argv[5]).resolve()
assert "submission-" in str(home) and native_root.is_dir() and provider.is_file() and guard.is_file()
cwd = home / "project"
cwd.mkdir(parents=True, exist_ok=True)
(home / ".omp/agent").mkdir(parents=True, exist_ok=True)
env = {key: value for key, value in os.environ.items() if key.lower() not in
       ("all_proxy", "http_proxy", "https_proxy")}
env.update(HOME=str(home), PI_CODING_AGENT_DIR=str(home / ".omp/agent"),
           BUN_RUNTIME_TRANSPILER_CACHE_PATH="0", NODE_DISABLE_COMPILE_CACHE="1")
args = ["--no-env-file", "--no-install", "--preload", str(guard), str(native_root / "packages/coding-agent/src/cli.ts"),
        "--mode", "rpc-ui", "--strict-start", "--offline", "--no-lsp", "--no-skills", "--no-rules", "--no-spotlight",
        "--no-judge", "--no-context-files", "--model", "submission-controlled/literal", "--trusted-extension", str(provider)]
child = subprocess.Popen([bun, *args], cwd=native_root, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE)

def read(timeout=30):
    ready, _, _ = select.select([child.stdout], [], [], timeout)
    return json.loads(child.stdout.readline()) if ready else None

def wait(request_id, timeout=60):
    while True:
        message = read(timeout)
        if message is None or (message.get("type") == "response" and message.get("id") == request_id):
            return message

def send(command):
    child.stdin.write((json.dumps(command) + "\n").encode())
    child.stdin.flush()
    return wait(command["id"])

try:
    assert read(30) is not None
    assert send({"id": "neg", "type": "negotiate_protocol", "protocolVersion": 2})["success"]
    started = send({"id": "start", "type": "strict_start", "intent": "new", "expectedCwd": str(cwd)})
    assert started["success"], started
    binding = started["data"]["binding"]
    target = {key: binding[key] for key in ("sourceId", "instanceId", "nativeSessionId")}
    ack = send({"id": "submit", "type": "submission_submit", **target, "clientSubmissionId": "tui-1",
                "preparationId": "prep:tui-1", "inputType": "prompt", "message": "Synthetic fixture input",
                "idleOnly": True})
    assert ack["success"], ack
    for attempt in range(600):
        page = send({"id": f"query-{attempt}", "type": "submission_query",
                     "clientSubmissionId": "tui-1", "limit": 128})["data"]
        if page["terminal"]:
            break
    else:
        raise RuntimeError("TUI fixture submission did not settle")
    assert page["persistence"] == "committed" and page["inputOutcome"] == "generated", page
    print(json.dumps({"session": str(home / ".omp/agent/sessions" / binding["aliases"][0]),
                      "nativeSessionId": binding["nativeSessionId"], "terminal": True}))
finally:
    child.stdin.close()
    try:
        child.wait(timeout=20)
    except subprocess.TimeoutExpired:
        child.kill()
    if child.returncode not in (0, None):
        sys.stderr.write(child.stderr.read().decode()[-4000:])
