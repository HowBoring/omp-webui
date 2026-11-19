# #37 durable navigation: isolated Linux evidence

This is an S0 synthetic-fixture acceptance, not product admission. Private Session admission stays blocked. The
native worker, public RPC v2 navigation commands and the `ompHistoryNavigationSource` Remote are real; the Host
supplies fixture-owned adapters for authority, joint idle, metadata and projection, and every seam is labeled below.

Artifacts: [native worker report](ticket-37-native-navigation.json),
[browser report](ticket-37-browser.json), [TUI report](ticket-37-tui.json). The authoritative semantics remain
[ADR 0025](../adr/0025-history-navigation-source-ports.md) with its #37 update.

## Reproduction

```sh
bun scripts/build-navigation-host.ts            # installs the pinned navigation validators, then vendor/host-navigation
bun apps/navigation-fixture/build.ts            # vendor/dsh-navigation (browser bundle + manifest)

OMP_NAVIGATION_FIXTURE_PORT=3186 /home/howboring/Projects/omp-webui-recovery/venv/bin/python \
  tests/browser/navigation-browser.py           # drives the page, kills, reopens, queries; stops the Host itself

/home/howboring/Projects/omp-webui-recovery/run-with-system-fixtures.sh python3 \
  tests/continuation/navigation-probe.py /tmp/t37/nav-evidence --cases all \
  --output docs/evidence/ticket-37-native-navigation.json

CARRIER=$(find vendor/navigation-profile/.omp/agent/sessions -name '*.jsonl' | tail -1)
python3 tests/continuation/navigation-tui.py vendor/navigation-profile "$CARRIER" matched "$(command -v bun)"

mkdir -p /tmp/navigation-tui-baseline/home/project
cp -r vendor/navigation-profile/.omp /tmp/navigation-tui-baseline/home/.omp
COPY=$(find /tmp/navigation-tui-baseline/home/.omp/agent/sessions -name '*.jsonl' | tail -1)
OMP_BASELINE_CLI=/home/howboring/.local/bin/omp python3 tests/continuation/navigation-tui.py \
  /tmp/navigation-tui-baseline/home "$COPY" baseline "$(command -v bun)"
```

`scripts/build-navigation-host.ts` calls `scripts/install-navigation-validators.ts` first: it copies the
`durable-navigation-v1` candidate artifacts into
`vendor/omp-strict/packages/coding-agent/src/modes/rpc/navigation-{command,result,preview}.generated.js`, writes the
`navigation.generated.ts` wrapper the patched native code imports, and records the installed bytes in
`compatibility/omp/candidates/native-cohort-38/strict-runtime-inputs.json`. The probe re-hashes those four files
against the manifest before any case runs and refuses a tree that still contains the permissive probe shim.

The browser driver owns the fixture lifetime: it spawns `vendor/host-navigation/navigation-fixture-main.js`, waits
for `/healthz` `fixture: "idle"`, drives Chromium (`/usr/bin/google-chrome`) and terminates the Host. The Host
starts the real `vendor/omp-strict` worker (tree `b102d9db2b9b91e7baa1de484ca901705785993b`) with the controlled
fixture provider and hooks.

## Acceptance coverage

| Criterion | Delivered behavior and proof |
| --- | --- |
| AC1: target/parent/summary/hook and durable commit are publicly queryable | Browser: page `inspect`→`confirm` yields `confirmation … options native_defaults notice files_and_external_effects_are_not_rolled_back`, then `operation committed / persistence committed / projection ready` with native leaf and commit id; `query` returns the same commit after completion. Native `committed` case proves the receipt carries requested target, target parent, `summaryEntryId == actualLeafId`, `summaryOrigin "native"`, the unsent inline draft offer, `beforeHookInvoked/Completed`, `treeHookInvoked`, `hookChangedLeaf false`, and that `inspect` did not write a byte. |
| AC2: success reply then termination with no prompt and no exit marker still recovers the position | Browser: the page is SIGKILLed immediately after the committed reply (`crash`), the Host reopens the same native session in a new worker, the reopened tree's active entry equals the committed native leaf and `query` returns the same `commitId`. Native `crash` case proves the same over raw RPC, with `-9` exit and no normal-exit record. |
| AC3: normal exit, failed write, cancel, unknown and invalid target are distinct | Native `committed` shows the successor appends `session_exit reason dispose` at the committed leaf and resumes on it. `write` (0-byte fault on the terminal receipt write) returns `outcome unknown/persistence unknown`, in-process `query` reports `NAVIGATION_SOURCE_UNREADABLE`, and the successor reads exactly one durable `reserved` record with `persistence unresolved` and no commit id. `unknown` (SIGKILL at the receipt append entry) leaves one durable `reserved` record, `found: true, outcome reserved, persistence unresolved, terminal false`, and the tree position unchanged. `cancelled` commits a cancelled terminal receipt, keeps the original leaf and does not run the summary. `invalid` rejects inspect/navigate with `NAVIGATION_ENTRY_NOT_FOUND`, leaves no record and no position change. |
| AC4: no Host auto-navigation, no second tree, no in-memory leaf claim | `confirm` is explicit, token-bound, single-use and requires joint idle; nothing navigates from a stored target. The Host keeps no tree: the page tree comes from `history_snapshot_open/page/close` over the public RPC, the service holds only metadata records (no messages, text or target snapshots), and recovery is read back from the native carrier through a new worker, never from a cached leaf. The report labels the Host metadata repository as `fixture-adapter` (in-memory, non-durable) and the projection proof as a fixture rebuild. |
| Boundary: malformed command/result cannot cross the RPC validators | The native `boundary` case sends six malformed navigation commands (non-string/empty `entryId`, non-hex source/instance ids, wrong `summarize` type, illegal `navigationId`, missing `navigationId`) and every one returns `NAVIGATION_COMMAND_SCHEMA`; a well-formed `inspect` still returns its preview, the leaf is unchanged and the carrier digest is byte-identical. `tests/navigation/validators.test.ts` drives the installed wrapper and `NavigationClient`: malformed `navigate`/`query` replies throw `NAVIGATION_RESULT_SCHEMA`, malformed inspect replies throw `NAVIGATION_PREVIEW_SCHEMA`, valid replies pass, and the installed files match the manifest hashes. |
| AC5: real Bun/DSH page + public worker; native TUI and data compatibility | Browser: Linux Chromium → DSH typed Remote/Gateway → Bun Host → public `ompHistoryNavigationSource/action` → real strict worker → public RPC v2. TUI: the matched native TUI opens the recovered carrier in a real PTY, renders only the recovered branch (`fixture prompt 1` + reply, abandoned `fixture prompt 2` hidden), reaches the native idle marker, accepts an explicit rename and exits 0. Baseline OMP `19.0.0` refuses the candidate carrier with a malformed/missing `header` error, exits 1 and leaves the file byte-identical, so the data is not silently downgraded. |

## Seams and limits

Real: native strict worker and its session storage/generation machinery, public navigation RPC commands and the
pinned generated validators (`navigation-command.generated.js` `56285798…`, `navigation-result.generated.js`
`0ebf9aab…` = the compiler receipt hash, `navigation-preview.generated.js` `4fc00773…`), `ompHistoryNavigationSource`
Remote over real DSH Connection/Remote/Gateway, Chromium page, PTY TUI, installed baseline binary (read-only).

Fixture-owned and labeled: authorization scope/policy and stable client per worker, joint-idle `StopSnapshot`, the
metadata repository (in-memory, metadata-only, non-durable), the projection rebuild (generation counter over the
real native tree), the controlled model provider and the `session_before_tree`/`session_tree` hooks inside the
fixture extension.

Not claimed: Host process restart durability or a production repository backend, real all-holder projection
handoff, draft conflict resolution in the TUI, long-history performance, Windows, and any private Session reading —
the Host only spawns the worker and parses no Session file. Probe/browser/TUI identifiers are per-run; the source
tree hash pins the native implementation. `vendor/` is prepared by `scripts/prepare-compatibility.ts` and is not
committed.

The candidate's `navigation-command.js` is 115052 bytes while the earlier compiler receipt listed 122957 bytes for the
same schema; the Host here installs the pinned candidate artifact (the authoritative validator for this source) and
the manifest now records the installed bytes instead of the stale compiler output. `navigation-result.generated.js`
is byte-identical to that receipt.
