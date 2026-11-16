# ADR 0015: Retain execution while replacing a Session projection

- Status: Isolated S0 implementation; product Session admission remains closed
- Date: 2026-11-16
- Ticket: [#40](https://github.com/HowBoring/omp-webui/issues/40)

A native Session ID identifies execution. A branded projection source and generation identify disposable
presentation. The source binds the verified native source and actual Session; worker, context, branch,
retained-content discontinuity and irreparable observation gaps retire its current generation. Safe verified
append and runtime-prefix progress keep it. A projection generation is never encoded as a fake Session ID.

DSH patch 0003 adds an opt-in `projectionRebuild` policy. The default stock controller keeps its existing
behavior and explicitly refuses scoped projection requests. An authoritative typed `projection-invalidated`
control names the **next** binding. Every retained holder of that Session withdraws retired history and
projection values before cancellation listeners run, cancels old page/open/assistant work, and stages one
complete journal, projection and mandatory assistant baseline. The existing Conversation event-window
replacement publishes the new coherent cut. Failure stays visible with old branch rows withdrawn.
`ISessions.retryProjection(id)` retries only this retained Session's current authority; it cannot choose one.

The exact SessionReference, AgentContext, invocation retains and execution worker survive. Release ownership
does not change. A new holder joins the current authority; final release still disposes the Client scope.
Physical follow restart and Connection readiness repair transport within their existing generation.
`surface.replace` remains model-surface behavior and cannot withdraw append-origin human text.

All journal frames, assistant frames, pages, control/list/unary/result projection writers and scoped mutations
carry or capture the binding. Retired invalidations, late callbacks and lower same-generation cursors cannot
publish into a successor. Complete control baselines also represent absent capabilities. Staging and retired
generation tracking have explicit item/byte bounds and visible failure rather than silent mixing. The 4-MiB staging budget counts UTF-8 JSON for the complete baseline and update key/value/sequence rows, including wrappers and separators; it does not bound JavaScript heap usage. Native control openings await the current journal and return typed failure if rebuilding fails, with independent stream cancellation. A terminal control error withdraws scoped presentation. Public projection retry restores a new Session-owned control observer and its complete baseline before presentation readiness; it coalesces concurrent retries and fences retired observers and released holders. Generic Gateway streams retain their terminal semantics.

Provider-mode semantic drafts remain in the retained input shell. Rebuild aborts old hydration, preparation,
checkpoint and recovery publication, keeps newer in-memory text, ordered repeated originals and unresolved
attempts, and preserves the provider storage key. Fresh receipts use the new generation. Projection writes
do not renew retention; an actual user edit does. Unresolved submissions are not automatically replayed.

The Host fixture shares one bounded public RPC carrier between the accepted HistoryClient/LiveJournal and
InteractionBridge. Projection journals do not own native shutdown or construct new Interaction deadlines.
Native observations retain `durability: not_attested`; this decision does not supply #37 durable navigation or #36 durable submissions,
#47 product Broker admission, real-provider inference, private Session access or deferred Windows evidence.
