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
