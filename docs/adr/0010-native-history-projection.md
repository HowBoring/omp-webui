# ADR 0010: Rebuild Conversation from native history and commit navigation positions in OMP

- Status: Accepted Q1–Q3 policies and derived contract; public extensions and implementation unvalidated
- Date: 2026-11-16
- Decision: [原生历史与树导航的投影、游标和重建规则](https://github.com/HowBoring/omp-webui/issues/23)

Conversation presents the readable active native path, retaining folded older segments at compaction
and reset boundaries. The full Session Tree remains separate, and displayed history is not an exact
model-input audit. Pruned native payloads cannot be recreated by the Host.

Projection journals, cursors and assistant attempts are disposable within an explicit generation.
The live Host/worker can restore current presentation; after restart, manual reopen reconstructs only
surviving native persisted facts, preserving independent drafts without replaying execution. This accepts
new display cursors and loss of unpersisted provider detail instead of storing a second durable transcript.

History Navigation is successful only after OMP guarantees a recoverable native Historical Position,
even before another prompt. This accepts public server/data compatibility work to avoid reporting an
in-memory selection as durably complete; a Host target cache or automatic navigation replay is insufficient.
Normal shutdown may append an exit marker, but does not prove immediate navigation persistence.

The [projection contract](../projection-contract.md) specifies source identities, coherent snapshot/live
handoff, scoped seqs/pages, stale-generation rejection and validation. Fixed OMP RPC lacks the required
shared observation/revision and complete source/commit linkage. Fixed DSH surface replacement retains
human transcript originals, while physical follow restart retains old seq state. A narrow public DSH
invalidation/rebuild seam must therefore coordinate Conversation, projections and draft ownership under
the same native identity. Broad core rewrites return to composition review. All extensions follow the
existing pinned public-build, verified global OMP, single-tuple and native-data/TUI gates; none is claimed
implemented by this decision.
