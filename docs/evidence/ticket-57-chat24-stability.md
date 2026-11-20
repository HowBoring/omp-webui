# Chat24 merged-tree stability (ticket 57 follow-up)

Scope: the two Chat24 reds on the merged tree (`browser.py` line 582
`reused id history survives reopen`, and phase-2 `stop settles cancelled`), not the
product contract. No product behavior claims beyond the wire evidence below.

## Reproduction rate

`tests/chat/browser.py` was run four times on the same clean tree (HEAD 6363772):

| run | result |
| --- | --- |
| 2 | failed at `browser.py:582` (reopen); all live tool assertions passed |
| 3 | failed at `browser.py:612` `stop settles cancelled: result: succeeded · settled: true` |
| 4 | failed at `browser.py:612`, same text |
| loop probe it2 | same `succeeded` settlement, second prompt then accepted (no busy alert) |

So neither red is deterministic: reopen failed 1/4, Stop 2/4. Neither is caused by the
LiveJournal tool-owner change in 0006: the two failing assertions are downstream of
projection/receipts that are not touched by it, and the stop outcome is produced by the
native prompt receipt (`operationOutcome`), not by the projection.

## Stop: root cause is the fixture's first-call fast path

`compatibility/omp/fixtures/live-provider.ts` applied `OMP_LIVE_FIXTURE_DELAY_MS` only
when `calls > 1`; the first model call in every worker streamed with 80 ms deltas. The
`delay=2000` Chat host therefore produced a **~240–400 ms turn** for the first live prompt,
which is the turn phase 2 expects to still be streaming:

- busy refusal, Stop click, native abort and turn end all land inside the same few hundred
  milliseconds, so the receipt flips to `completed`/`succeeded` as often as `aborted`/`cancelled`.

Wire evidence (isolated host, `delay=2000`, one prompt then busy send then Stop):

```
it0 3.38s session/prompt -> accepted
it0 3.52s session/prompt -> busy (native Session is busy.)
it0 3.58s ompStop/stop  -> status stopping, nativeSettled false
it0 3.66s ompChat/state -> settled true, committed, operationOutcome cancelled,
                            result {status: aborted, agentInvoked: true, sessionSettled: true}

it2 7.08s session/prompt -> accepted            (attempt 8f9d…)
it2 7.44s accepted
it2 7.50s ompChat/state -> settled true, committed, operationOutcome succeeded,
                            result {status: completed, agentInvoked: true, sessionSettled: true}
it2 7.78s session/prompt -> accepted            (attempt 4072…) ← session already idle
it2 13.88s ompChat/state -> 4072… succeeded     (the 6 s stream happened here)
```

The product Stop path is correct in that evidence: when the turn is actually streaming,
the three controls abort it and the receipt is `cancelled`. The test premise was wrong.

Fix: `OMP_LIVE_FIXTURE_DELAY_MS` now applies to every streamed call (default 80 ms when
unset, so the live/native suites are unchanged). A `delay=2000` prompt is a real ~6 s
stream, so the busy refusal and Stop always reach an in-flight turn.

## Reopen: the records are intact, the assertion raced a row rebuild

Native probe against the actual candidate (`vendor/omp-candidate/cli.js`, `tools=all`,
prompt "use all controlled tools in background"): the active path and the full tree agree
on 22 items and **six distinct tool results** — `background-fixture-id`, `batch-one-id`,
`batch-two-id`, then `background-fixture-id_dup1`, `batch-one-id_dup1`,
`batch-two-id_dup1` — with two assistant tool-call messages holding the same three ids
before/after the `_dup1` repair. The repeated ids in the fixture are repaired upstream by
`ensureUniqueToolCallIds` (`node_modules/@oh-my-pi/pi-agent-core/src/agent-loop.ts:3111`)
before dispatch and persistence, so native entries are neither lost nor merged, and both
the call record and its result carry the repaired id (so `ToolCallLedger` in
`packages/projection/history-records.ts` finds an owner for every result).

DOM evidence at the failing assertion, from a run that reproduced it:

- the dump taken immediately before the failing count showed **all six result rows**:
  `[bash, s0_fixture, s0_fixture_batch, bash, s0_fixture, s0_fixture_batch]`, no
  `[data-chat-blocked]`, i.e. no row rendered under a `_dup1` call id and no unknown node;
- sampling the reopened view 12 times at 250 ms after the reload selector resolved gave the
  identical frame `[2 s0_fixture, 2 s0_fixture_batch, 6 results, scrollTop 0, scrollHeight 1854,
  clientHeight 1854]` every time — the six rows are stable and the view is not virtualized
  (scrollHeight equals clientHeight at the top).

So neither remaining candidate was right: no entry is lost on reopen and no result loses its
tool name. The red was the assertion itself. `locator.all_inner_texts()` reads the DOM once
with no auto-wait, and the reopened conversation rebuilds its rows when the live shell
re-attaches after the reload, so a single frame with fewer than two `s0_fixture` result rows
failed the assertion while the projection already held all six. The reopen check now waits
for the native records (`wait_for_function` over `[data-chat-tool-result]` counts), which
still fails if an entry is ever really missing.

## Port and process lifetime

`start_host()` already killed leftovers and waited for the port, but it accepted health from
whatever answered on the port. A predecessor still draining past the SIGTERM window could
therefore pass the health probe while the freshly spawned child had not bound yet, and the
next phase would talk to a host whose access authority was already closing — the
`401 Access invalidated` replies on `ompChat/state`, `ompStop/confirmForce`, `ompRetry/offer`
and the `net::ERR_CONNECTION_RESET` reconnects seen in the suite log. That is a shutdown-window
reply, not a lost credential: `chat-component-main.ts` only closes the authority on SIGTERM
(`access.close()`), never revokes, and `AccessStore` keeps credentials while the origin and
data directory match, so a reload after restart stays admitted.

The launcher now also verifies the listener is the child it started: it truncates
`vendor/chat-host.log`, and the Host prints its `S2-isolated-chat` origin line only after it
binds, so a health response without that line is a predecessor and the spawn is retried
instead of adopted.

## Running the focused evidence

```
CHROME_EXECUTABLE=/usr/bin/google-chrome \
  /home/howboring/Projects/omp-webui-recovery/venv/bin/python tests/chat/browser.py
```

The isolated variants used here (not committed) import `tests/chat/browser.py` as a module,
regenerate the fixture, start the host with `tools="all"`/`delay=2000`, and drive only
`open_session`, `send`, and the settlement paragraph. Native persistence was read directly
through `LiveTransport.open` with `history.open("tree")` / `history.open("active")`.

## Re-run evidence

Full `tests/chat/browser.py` three consecutive times on this tree (port 32957, Linux
Chromium 157.0.8103.38): PASS, PASS, PASS — 1242 s of wall time for all three, i.e. about
414 s per run against a 351 s single-run baseline, so no run doubled the normal duration
and no run was killed. All reopen and Stop scenarios are in every pass:
`native-tool-history-reopen`, `native-background-tool-result`, `busy-refusal-retains-draft`,
`ordinary-stop-settles-cancelled-keeps-draft`, `idle-stop-keeps-draft-no-force`,
`stubborn-force-offered-after-30s`, `stubborn-force-confirm-terminated-reaped`,
`pending-ui-cancelled-by-stop`, `retry-stop-settles-cancelled-and-recovers-admission`.

The delayed fixture is what makes those Stop scenarios the same in every run: phase 2 waits
for `data-chat-stop-status="stopping"` on a 2000 ms-per-delta stream and then for
`data-chat-settlement="settled"` with `cancelled`, and phase 2b waits the full 30 s before
the force offer appears. Both now pass 3/3, where the pre-fix tree settled `succeeded` in 2
of 4 runs.

Also green on this tree: `tests/chat/images.py` (18 scenarios), `tests/chat/drafts.py`
(5 cases, no boundaries), `bun test tests/chat` (67 tests), 
`bun test compatibility/omp/fixtures/live-public-rpc.test.js` (9 tests), `bun run typecheck`.
