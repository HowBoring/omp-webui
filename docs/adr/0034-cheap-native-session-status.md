# ADR 0034 — A cheap Native status projection for Session membership

- Status — Compatibility decision for [#60](https://github.com/HowBoring/omp-webui/issues/60). Requires the authored OMP patch `compatibility/omp/0014-rpc-session-status.patch`.

Session membership lists every Native Session with its `running` flag. The
`running` flag is authoritative only from the Native worker, so the Host reads
it through the public RPC surface. `get_state` also builds the system prompt,
dumps the tool registry, computes context usage, token rates and todo phases,
and scans the transcript; on a 10,000-entry Session that costs roughly one
second. The list blocked on that read (measured 249–1335 ms) and the reload
could not finish before DSH published the index.

## Decision

OMP gains one additive public RPC command, `get_status`, and `get_state` stays
untouched.

1. `get_status` returns only `sessionId`, `isStreaming`, `isCompacting`,
   `isSettled`, `hasPendingAsyncWork`, `queuedMessageCount`, `steeringCount`
   and `followUpCount`. Absent settlement inputs project as `false` and absent
   queue counts as `0`, matching the existing `get_state` projection.
2. It reads no transcript, prompt, tool registry, context usage, token rate or
   todo phase, and it never awaits the goal controller.
3. It is allowed during navigation like `get_state`, so membership stays
   readable at any point of a Navigation.
4. The Host validates the response against a strict schema and keeps every
   ownership, authority, worker and generation check. Settlement is decided by
   `statusSettled`, which treats any streaming, compaction, pending asynchronous
   work, queued message, steering or follow-up as unsettled.
5. Membership remains synchronous: the list still awaits the Native status of
   every open worker instead of publishing a cached or optimistic value.

## Consequences

The list no longer pays for prompt or transcript work it never reads. Status is
still Native-authoritative per request; no cached flag can outlive its worker,
and a stale, busy or malformed answer fails the read rather than reporting a
Session idle.
