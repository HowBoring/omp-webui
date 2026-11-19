# Source38 submission recovery, fault and compatibility runtime

Ticket: [#36](https://github.com/HowBoring/omp-webui/issues/36). This note covers the acceptance points that
`submission-runtime.md`, `submission-loss-runtime.md` and `submission-write-refusal-runtime.md` explicitly deferred:
delayed first write, crash before the first query, a short protected write, extension input transformation, handled
builtins, native copies/branches and metadata compatibility with rollback. The candidate remains unregistered.

## Implementation identity

The worker was built from `compatibility/omp/candidates/native-cohort-38/replay.py` against the pinned
`vendor/omp` checkout. The patched native source tree is
`b102d9db2b9b91e7baa1de484ca901705785993b`, and `replay.py --verify-wire` passes the wire freshness test and
scoped `tsc`. Submission command/result validators are the exact candidate artifacts in
`packages/contracts/candidates/durable-submission-v1/`; their schema definitions are byte-identical to the pinned
native wire schema. Standalone validators that Source38's Host compiler normally generates for unrelated strict
commands (`navigation.generated.ts`, `attachments.generated.ts`) were permissive probe shims in the scratch tree;
no navigation or attachment command was sent, and the submission validators were not shimmed.

Worker: `bun packages/coding-agent/src/cli.ts --mode rpc-ui --strict-start --offline --no-lsp --no-skills
--no-rules --no-spotlight --no-judge --no-context-files --model submission-controlled/literal
--trusted-extension submission-provider.ts`, isolated `HOME`, synthetic deterministic provider, pre-import egress
guard. No network, no real inference, no real user history.

Recorded pages are committed as `tests/compatibility/fixtures/submission-native.json`; the Host contract check is
`tests/compatibility/submission-native.test.ts` (`bun test tests/compatibility/submission-native.test.ts`). The
fixture preserves full result pages so the public client validators and the Host receipt proof are exercised on the
actual bytes.

## Fault matrix

| Window | Observation | Committed proof |
| --- | --- | --- |
| delayed first write | submit ack: reservation committed, input unresolved, 0 relations; first query unchanged; after native user message the input is generated but persistence unresolved | only after execution completes: `terminal`, `persistence committed`, 4 relations |
| lost acknowledgement | reply was not delivered; successor worker after `SIGKILL` queries the same key | committed input, same entry IDs, provider calls 1 |
| crash before first query | submit ack received, worker killed before any query; successor queries for 10s | found, local, reservation committed, persistence unresolved, terminal false — never absent or committed |
| short protected write | `pwrite` of the source carrier truncated to 20 bytes, `ENOSPC` injected | query `SUBMISSION_SOURCE_UNREADABLE`, absent admission; syscall log records `actual_written:20`, `injected_return:-28`; adapter and receipt return no result |
| extension transform | extension rewrites `transform` to `equal transformed input` | input entry keeps the transformed text and the submitted source key; no Host text matching |
| handled builtin | extension handles the input without a primary entry | `inputOutcome no_input`, one additional relation, complete no-input receipt |
| native copy | `SessionManager.persistCopy` then ordinary worker on the copy | `admission inherited`, original `origin` and relation entry IDs retained; inherited is not a destination admission |
| native branch | `createBranchedSession` then ordinary worker on the branch | same inherited origin, distinct destination native Session |
| old native reader | prepared base CLI opens the submission-bearing file | exits 1, empty stdout, `the session header is missing or malformed. The file was not modified.`; current reader lists entries with submission roles |

Copy/branch entry IDs are the copy's own original-session IDs, not the unrelated normal session's; the fixture
records each original final page next to its copy.

## Limits

This is not a registered product admission. Global installation, Windows/WSL2, browser delivery, real provider
inference, fsync/power-loss durability, and maintainer acceptance gates remain separate. The syscall fault driver
attaches with `ptrace` and requires a Linux tracer; it is not a portable test.

Primary policy: [`docs/adr/0014-native-durable-submission.md`](../../../docs/adr/0014-native-durable-submission.md).

## Native TUI compatibility and rollback

The interactive check uses a dedicated uv-managed Python 3.14.4 environment with pexpect 4.9.0 and the
unprivileged overlay runner (`run-with-system-fixtures.sh`, user namespace, system `strace` overlay, no global
OMP change). The ticket worktree's strict fixture is built by `replay.py` into `vendor/omp-strict` (source tree
`b102d9db…`, pristine `strict-mode.ts`); the candidate TUI entry is
`vendor/omp-strict/packages/coding-agent/src/cli.ts`, and the pinned baseline is
`vendor/omp-candidate/cli.js` from the main checkout (base `7c49c11a…`, no submission patches).

Synthetic session: built in place because generation commitments bind to the carrier inode (`carrierIdentity` =
hash of `dev:ino:birthtimeNs`), so a copied JSONL cannot be replayed. `tests/continuation/tui-fixture.py` opens a
strict worker with `compatibility/omp/fixtures/submission-provider.ts`, submits one deterministic prompt
(`tui-1`, `Synthetic fixture input`), waits for a committed terminal page, and prints the resulting Session path.
Then `tests/continuation/tui-probe.py` opens that same file in a real PTY. Reproduction (inside the ticket
worktree, HOME name must contain `submission-`):

```
run-with-system-fixtures.sh <venv>/bin/python tests/continuation/tui-fixture.py \
  /tmp/t36/submission-tui2 "$PWD/vendor/omp-strict" /home/howboring/.bun/bin/bun \
  compatibility/omp/fixtures/submission-provider.ts compatibility/omp/fixtures/no-provider.ts
# -> {"session": "/tmp/t36/submission-tui2/.omp/agent/sessions/…/<id>.jsonl", "terminal": true}

for mode in current baseline; do
  OMP_BASELINE_CLI=<main>/vendor/omp-candidate/cli.js \
  OMP_CANDIDATE_CLI="$PWD/vendor/omp-strict/packages/coding-agent/src/cli.ts" \
  run-with-system-fixtures.sh bash -c 'cd '"$PWD"' && <venv>/bin/python tests/continuation/tui-probe.py \
    /tmp/t36/submission-tui2 "<session>" '"$mode"' /home/howboring/.bun/bin/bun'
done
```

Observed: `current` → `{"kind": "matched-native-tui", "historyRendered": true, "explicitRename": true,
"exit": 0}` — the current TUI renders the committed history, accepts an explicit `/rename`, and exits cleanly.
`baseline` → `{"kind": "baseline-tui-refusal", "exit": 1, "invalidHeader": true}` and leaves the file
untouched. Both runs used the actual native PTY path under the overlay runner; no model inference was sent.
Global installation, real provider inference and Windows/WSL2 remain separate.
