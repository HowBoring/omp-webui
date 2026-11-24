"""Real PTY check of a navigation-recovered native carrier: the matched TUI renders and
continues it, the restored baseline refuses its generations header without rewriting it."""
import hashlib
import json
import os
import pathlib
import sys
import time
import pexpect

root = pathlib.Path(__file__).resolve().parents[2]
home = pathlib.Path(sys.argv[1]).resolve()
file = pathlib.Path(sys.argv[2]).resolve()
mode = sys.argv[3]
bun = sys.argv[4]
assert mode in ("matched", "baseline"), mode
assert file.is_relative_to(home) and (home / "project").is_dir(), (file, home)
env = {"HOME": str(home), "PATH": "/usr/bin:/bin", "TMPDIR": str(home), "TERM": "xterm-256color",
       "PI_CODING_AGENT_DIR": str(home / ".omp/agent"), "BUN_RUNTIME_TRANSPILER_CACHE_PATH": "0",
       "XDG_CONFIG_HOME": str(home / "config"), "XDG_CACHE_HOME": str(home / "cache"),
       "XDG_DATA_HOME": str(home / "data"), "PI_NOTIFICATIONS": "off", "NO_COLOR": "1"}
before = hashlib.sha256(file.read_bytes()).hexdigest()
if mode == "matched":
    cli = root / "vendor/omp-strict/packages/coding-agent/src/cli.ts"
    argv = [bun, "--no-env-file", "--preload", str(root / "compatibility/omp/fixtures/no-provider.ts"), str(cli),
            "--session", str(file), "--offline",
            "-e", str(root / "compatibility/omp/fixtures/navigation-provider.ts"),
            "--no-skills", "--no-rules", "--no-context-files", "--no-lsp", "--no-judge"]
else:
    cli = pathlib.Path(os.environ["OMP_BASELINE_CLI"]).resolve()
    argv = [bun, "--no-env-file", "--preload", str(root / "compatibility/omp/fixtures/no-provider.ts"), str(cli),
            "--session", str(file), "--offline", "--no-extensions", "--no-skills", "--no-rules",
            "--no-tools", "--no-context-files"]
assert cli.is_file(), cli
child = pexpect.spawn(argv[0], argv[1:], cwd=str(home / "project"), env=env, encoding="utf-8",
                      timeout=30, dimensions=(40, 160))
observed = ""
try:
    if mode == "baseline":
        child.expect(pexpect.EOF)
        observed += child.before
        child.close()
        assert child.exitstatus not in (0, None), (child.exitstatus, observed[-4000:])
        assert "header" in observed.lower() and ("malformed" in observed.lower() or "missing" in observed.lower()), observed[-4000:]
        assert hashlib.sha256(file.read_bytes()).hexdigest() == before
        print(json.dumps({"kind": "baseline-navigation-tui-refusal", "exit": child.exitstatus,
                          "invalidHeader": True, "dataUnchanged": True}))
    else:
        child.expect("fixture prompt 1")
        observed += child.before + child.after
        child.expect_exact("\x1b]7501;state=idle:app=omp")
        time.sleep(0.5)
        observed += child.before + child.after
        assert "fixture prompt 2" not in observed, "abandoned branch leaked into the recovered TUI"
        child.send("/rename Navigation TUI continued title")
        child.send("\r")
        child.expect("Navigation TUI continued title")
        time.sleep(0.3)
        observed += child.before + child.after
        child.sendcontrol("c")
        time.sleep(0.1)
        child.sendcontrol("c")
        child.expect(pexpect.EOF)
        child.close()
        assert child.exitstatus == 0, (child.exitstatus, observed[-4000:])
        print(json.dumps({"kind": "navigation-native-tui", "historyRendered": True,
                          "abandonedBranchHidden": True, "explicitRename": True, "exit": 0,
                          "recoveredLeaf": sys.argv[5] if len(sys.argv) > 5 else None}))
finally:
    if child.isalive():
        child.close(force=True)
