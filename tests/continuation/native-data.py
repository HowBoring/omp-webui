"""Real PTY check of #61 native data: the enrolled build writes and reopens isolated synthetic
native history, the pinned previous release reads current data without loss, and the current
build continues data written by that release. Never touches a real user history directory."""
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import time

import pexpect

root = pathlib.Path(__file__).resolve().parents[2]
bun = (pathlib.Path(os.environ.get("BUN", "")) if os.environ.get("BUN") else pathlib.Path(shutil.which("bun") or "")).resolve()
previous_cli = pathlib.Path(os.environ.get("OMP_PREVIOUS_CLI", root / "vendor/omp-previous/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js")).resolve()
work = pathlib.Path(sys.argv[1]).resolve()
OUT = pathlib.Path(sys.argv[2]).resolve()
matched_cli = root / "vendor/omp-candidate/cli.js"
provider = root / "compatibility/omp/fixtures/navigation-provider.ts"
guard = root / "compatibility/omp/fixtures/no-provider.ts"
MODEL = "navigation-controlled/literal"
PROMPT_A = "t61 current fixture prompt"
PROMPT_B = "t61 previous fixture prompt"
PROMPT_C = "t61 continuation turn"
for path in (bun, previous_cli, matched_cli, provider, guard):
    assert path.is_file(), path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def home_for(name):
    # The controlled provider fixture refuses any HOME that is not an explicit synthetic profile.
    home = work / f"navigation-{name}"
    (home / "project").mkdir(parents=True, exist_ok=True)
    return home


def env_for(home):
    return {"HOME": str(home), "PATH": "/usr/bin:/bin", "TMPDIR": str(home), "TERM": "xterm-256color",
            "PI_CODING_AGENT_DIR": str(home / ".omp/agent"), "BUN_RUNTIME_TRANSPILER_CACHE_PATH": "0",
            "XDG_CONFIG_HOME": str(home / "config"), "XDG_CACHE_HOME": str(home / "cache"),
            "XDG_DATA_HOME": str(home / "data"), "PI_NOTIFICATIONS": "off", "NO_COLOR": "1"}


def base_argv(home, cli):
    return [str(bun), "--no-env-file", "--preload", str(guard), str(cli), "--offline", "--model", MODEL,
            "-e", str(provider), "--no-skills", "--no-rules", "--no-context-files", "--no-lsp", "--no-judge"]


def session_of(home):
    files = sorted((home / ".omp/agent/sessions").rglob("*.jsonl"))
    assert len(files) == 1, files
    return files[0]


def records(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def record_key(record):
    kind = record.get("type", "") + (":" + record["customType"] if record.get("customType") else "")
    return f"{kind} {record.get('runtime', {}).get('version', '-')}"


def survives(before, after):
    """Every original record still present, in order; anything new is an append."""
    kept = len(before) <= len(after) and all(a == b for a, b in zip(before, after))
    return {"preserved": kept, "appended": [record_key(r) for r in after[len(before):]]}


def network_audit(home):
    path = home / "navigation-network-audit.json"
    return json.loads(path.read_text()) if path.exists() else None


def run_print(home, cli, prompt, resume=None):
    argv = base_argv(home, cli) + (["--resume", str(resume)] if resume else []) + ["-p", prompt]
    result = subprocess.run(argv, cwd=str(home / "project"), env=env_for(home), capture_output=True, text=True, timeout=180)
    return {"exit": result.returncode, "reply": "literal fixture response" in result.stdout,
            "stdout": result.stdout.strip().splitlines()[-1:] if result.stdout.strip() else [],
            "stderr": result.stderr.strip().splitlines()[-2:] if result.stderr.strip() else []}


def clean(raw):
    text = re.sub(r"\x1b\][^\x07\x1b]*(\x07|\x1b\\)", "", raw)
    text = re.sub(r"\x1b\[[0-9;?]*[ -/]*[@-~]", " ", text)
    return re.sub(r"\s+", "", text)


def open_tui(home, cli, file, expect_tokens):
    before = records(file)
    child = pexpect.spawn(base_argv(home, cli)[0], base_argv(home, cli)[1:] + ["--resume", str(file)],
                          cwd=str(home / "project"), env=env_for(home), encoding="utf-8", timeout=90, dimensions=(40, 160))
    observed = ""
    try:
        for token in expect_tokens:
            child.expect(re.escape(token), timeout=60)
            observed += child.before + child.after
        time.sleep(0.5)
        child.sendcontrol("c")
        time.sleep(0.2)
        child.sendcontrol("c")
        child.expect(pexpect.EOF, timeout=45)
        child.close()
    except Exception as error:
        observed += clean(str(child.before or ""))
        child.close(force=True)
        raise AssertionError(f"{type(error).__name__} opening {file.name}: {clean(observed)[-600:]}")
    after = records(file)
    return {"exit": child.exitstatus, "rendered": all(clean(token) in clean(observed) for token in expect_tokens),
            "write": survives(before, after)}


results = {"kind": "ticket-61-native-data", "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "scope": "isolated synthetic native data under a private HOME; no real user history is read or written",
           "provider": "controlled fixture compatibility/omp/fixtures/navigation-provider.ts (no real model inference)",
           "builds": {"current": {"path": str(matched_cli.relative_to(root)), "sha256": digest(matched_cli),
                                  "runtime": "vendor/omp-candidate" + " base 57771ae562b9345e0579bceb2d68d585e3e6927e"},
                      "previous": {"path": str(previous_cli.relative_to(root)), "sha256": digest(previous_cli)}},
           "checks": {}}
checks = results["checks"]
shutil.rmtree(work, ignore_errors=True)

current_home = home_for("current")
created = run_print(current_home, matched_cli, PROMPT_A)
current_file = session_of(current_home)
current_records = records(current_file)
header = next(r for r in current_records if r.get("type") == "session")
checks["currentCreatesNativeData"] = {"status": "pass" if created["reply"] and created["exit"] == 0 else "fail",
                                      "exit": created["exit"], "replyRendered": created["reply"],
                                      "sessionFile": str(current_file.relative_to(work)),
                                      "sha256": digest(current_file), "headerVersion": header.get("version"),
                                      "runtime": header.get("runtime"),
                                      "network": network_audit(current_home)}

tui_current = open_tui(current_home, matched_cli, current_file, [PROMPT_A, "literal fixture response"])
checks["currentTuiReopensCurrentData"] = {"status": "pass" if tui_current["exit"] == 0 and tui_current["rendered"]
                                          and tui_current["write"]["preserved"] else "fail", **tui_current}

rollback_copy = work / "previous-on-current.jsonl"
shutil.copyfile(current_file, rollback_copy)
before_rollback = records(rollback_copy)
tui_previous = open_tui(current_home, previous_cli, rollback_copy, [PROMPT_A, "literal fixture response"])
checks["previousBuildOpensCurrentData"] = {"status": "pass" if tui_previous["exit"] == 0 and tui_previous["rendered"]
                                           and tui_previous["write"]["preserved"] else "fail",
                                           "resolution": "lossless-resume", **tui_previous}

previous_home = home_for("previous")
seeded = run_print(previous_home, previous_cli, PROMPT_B)
previous_file = session_of(previous_home)
previous_records = records(previous_file)
checks["previousBuildCreatesBaseData"] = {"status": "pass" if seeded["reply"] and seeded["exit"] == 0 else "fail",
                                          "exit": seeded["exit"], "replyRendered": seeded["reply"],
                                          "sha256": digest(previous_file),
                                          "runtime": next(r for r in previous_records if r.get("type") == "session").get("runtime"),
                                          "generations": [record_key(r) for r in previous_records]}

upgrade_tui = open_tui(previous_home, matched_cli, previous_file, [PROMPT_B, "literal fixture response"])
continued = run_print(previous_home, matched_cli, PROMPT_C, resume=previous_file)
upgraded = records(previous_file)
checks["currentUpgradesPreviousData"] = {"status": "pass" if upgrade_tui["exit"] == 0 and upgrade_tui["rendered"]
                                         and upgraded[:len(previous_records)] == previous_records
                                         and continued["reply"] and continued["exit"] == 0 else "fail",
                                         "tui": upgrade_tui, "continuation": continued,
                                         "previousRecordsPreserved": upgraded[:len(previous_records)] == previous_records,
                                         "appended": [record_key(r) for r in upgraded[len(previous_records):]],
                                         "newMetadata": {"headerVersion": next(r for r in upgraded if r.get("type") == "session").get("version"),
                                                         "recordTypes": sorted({record_key(r) for r in upgraded}),
                                                         "formatUnchanged": next(r for r in upgraded if r.get("type") == "session").get("version")
                                                         == next(r for r in previous_records if r.get("type") == "session").get("version")}}

rollback_upgraded = work / "previous-on-upgraded.jsonl"
shutil.copyfile(previous_file, rollback_upgraded)
rollback_tui = open_tui(previous_home, previous_cli, rollback_upgraded, [PROMPT_B, PROMPT_C])
checks["previousBuildRollsBackUpgradedData"] = {"status": "pass" if rollback_tui["exit"] == 0 and rollback_tui["rendered"]
                                                and rollback_tui["write"]["preserved"] else "fail",
                                                "resolution": "lossless-resume", **rollback_tui}

results["status"] = "pass" if all(check["status"] == "pass" for check in checks.values()) else "fail"
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(results, indent=2) + "\n")
print(json.dumps({"status": results["status"], "out": str(OUT),
                  "failing": [name for name, check in checks.items() if check["status"] != "pass"]}))
