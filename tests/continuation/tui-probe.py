"""Owned synthetic native PTY only. The caller supplies a sanitized fixture profile and fixed launcher choice."""
import json
import os
import pathlib
import sys
import time
import select
import pexpect

root = pathlib.Path(__file__).resolve().parents[2]
home = pathlib.Path(sys.argv[1]).resolve()
file = pathlib.Path(sys.argv[2]).resolve()
baseline = sys.argv[3] == "baseline"
assert file.is_relative_to(home) and (home / "project").is_dir()
bun = sys.argv[4]
launcher = "/workspace/work/rpc-public-module-probe/tarball/package/dist/cli.js" if baseline else str(root / "vendor/omp-candidate/cli.js")
env = {"HOME": str(home), "PATH": "/usr/bin:/bin", "TMPDIR": str(home), "TERM": "xterm-256color",
       "PI_CODING_AGENT_DIR": str(home / ".omp/agent"), "BUN_RUNTIME_TRANSPILER_CACHE_PATH": "0",
       "XDG_CONFIG_HOME": str(home / "config"), "XDG_CACHE_HOME": str(home / "cache"),
       "XDG_DATA_HOME": str(home / "data"), "OPENAI_API_KEY": "synthetic-unused-no-provider-calls",
       "PI_NOTIFICATIONS": "off", "NO_COLOR": "1"}
args = ["--no-env-file", "--preload", str(root / "compatibility/omp/fixtures/no-provider.ts"), launcher,
        "--session", str(file), "--offline", "--provider", "openai", "--model", "gpt-4o",
        "--no-extensions", "--no-skills", "--no-rules", "--no-tools", "--no-context-files"]
child = pexpect.spawn(bun, args, cwd=str(home / "project"), env=env, encoding="utf-8", timeout=15,
                      dimensions=(40, 160))
observed = ""
try:
    if baseline:
        child.expect(pexpect.EOF)
        observed += child.before
        child.close()
        assert child.exitstatus not in (0, None), (child.exitstatus, observed[-4000:])
        assert "header" in observed.lower() and ("malformed" in observed.lower() or "missing" in observed.lower()), observed[-4000:]
        print(json.dumps({"kind": "baseline-tui-refusal", "exit": child.exitstatus, "invalidHeader": True}))
    else:
        child.expect("Synthetic fixture input")
        observed += child.before + child.after
        child.expect_exact("\x1b]7501;state=idle:app=omp")
        time.sleep(0.25)
        child.send("/rename Matched TUI continued title")
        child.send("\r")
        child.expect("Matched TUI continued title")
        time.sleep(0.5)
        observed += child.before + child.after
        if sys.argv[3] == "hold":
            print(json.dumps({"kind":"owned-native-tui-holding", "historyRendered":True}),flush=True)
            while not select.select([sys.stdin],[],[],0.05)[0]:
                try: child.read_nonblocking(65536,timeout=0.05)
                except pexpect.TIMEOUT: pass
            assert sys.stdin.readline().strip() == "release"
        child.sendcontrol("c")
        time.sleep(0.1)
        child.sendcontrol("c")
        child.expect(pexpect.EOF)
        observed += child.before
        child.close()
        assert child.exitstatus == 0, (child.exitstatus, observed[-4000:])
        print(json.dumps({"kind": "matched-native-tui", "historyRendered": True, "explicitRename": True,
                          "exit": child.exitstatus}))
except BaseException:
    sys.stderr.write(observed[-4000:] + str(child.before)[-4000:])
    raise
finally:
    if child.isalive():
        child.terminate(force=True)
