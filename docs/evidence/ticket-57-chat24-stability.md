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

## Reopen: native persistence is intact; failure not yet localized

Native probe against the actual candidate (`vendor/omp-candidate/cli.js`, `tools=all`,
prompt "use all controlled tools in background"): the active path and the full tree agree
on 22 items and **six distinct tool results** — `background-fixture-id`, `batch-one-id`,
`batch-two-id`, then `background-fixture-id_dup1`, `batch-one-id_dup1`,
`batch-two-id_dup1` — with two assistant tool-call messages holding the same three ids
before/after the `_dup1` repair. The repeated ids in the fixture are repaired upstream by
`ensureUniqueToolCallIds` (`node_modules/@oh-my-pi/pi-agent-core/src/agent-loop.ts:3111`)
before dispatch and persistence, so native entries are neither lost nor merged.

Browser observations:

- opening `native-0002` alone, running the batch prompt, reloading and reopening renders
  2 `s0_fixture`, 2 `s0_fixture_batch` and 2 bash results, with no `[data-chat-blocked]`;
- a full replica of phase 1 + 1b (three iterations) also rendered 2/2/2 after reload;
- only the real suite run 2 lost one `s0_fixture` result after reload (count 1) while the
  `s0_fixture_batch` count stayed at 2.

Next step that will settle it: the DBG loop used during this investigation (count and text
of every `[data-chat-tool-result]` after reload) was removed before this commit; re-add it
in `tests/chat/browser.py` at the reopen assertion and run the suite until the flake hits
(~1/4). The dump distinguishes the two remaining candidates:

1. the second batch-one result renders under its repaired call id instead of its tool name
   (`data-chat-tool-result` falls back to `value.callId` at `apps/chat/src/client.tsx:402`),
   which is a client-side pairing gap for `_dup1` ids, or
2. the Host history page omits one entry while `s0_fixture_batch` survives, which points at
   the history/live handoff (`packages/projection/live-journal.ts`) rather than at Chat.

## Running the focused evidence

```
CHROME_EXECUTABLE=/usr/bin/google-chrome \
  /home/howboring/Projects/omp-webui-recovery/venv/bin/python tests/chat/browser.py
```

The isolated variants used here (not committed) import `tests/chat/browser.py` as a module,
regenerate the fixture, start the host with `tools="all"`/`delay=2000`, and drive only
`open_session`, `send`, and the settlement paragraph. Native persistence was read directly
through `LiveTransport.open` with `history.open("tree")` / `history.open("active")`.
