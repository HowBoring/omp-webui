# ADR 0014: Reserve native submission identity before execution

- Status: S0 component implementation candidate; private product admission blocked
- Date: 2026-11-16
- Scope: [#36](https://github.com/HowBoring/omp-webui/issues/36), parent [#29](https://github.com/HowBoring/omp-webui/issues/29)

OMP owns reservations, causal entry provenance and commit facts. The Host uses public JSONL RPC and stores only
submission/attachment association metadata. A stable client key binds the exact source, physical instance, native
Session, immutable preparation identity and a fingerprint of the actual input. OMP publishes a reservation under
the genuine native exclusive lease and pinned descriptor **before** extension input, builtin, abort, model or tool
dispatch. Repeated keys return facts; changed bindings or input conflict. A reserved interrupted operation never
resumes automatically, even if no entry is visible. This prevents replay after acknowledgement loss without
claiming exactly-once external effects or undoing work.

`submission_submit` and bounded `submission_query` share authored server, wire schema, generated SDKs and a narrow
public client. Query reads protected logical bytes without prompt execution, provider work, migration, flush,
repair or retry. Reservation, input generation, terminal completion and each relation's persistence are separate.
Native live observations, acknowledgements, results and memory `get_entries` are not commit evidence. A commit
requires protected native publication containing metadata and corresponding entries, followed by reading the
committed logical state. The durability claim covers software process crashes and excludes fsync/power loss.
An uncertain protected write stays unknown; ordinary repair cannot clear the protected backend's latch.

Explicit original-object carriers cross queued input, prepared companions, extension delivery, native lifecycle
and persistence queues. Task-local scope carries ingress through native async work; it does not substitute for
queued-object provenance. Entries receive minimal origin metadata before append. No relation is reconstructed
from text, hashes, timestamps, entry order or tool-call ID reuse. A fingerprint detects conflicting admission,
never a message association. Extension-handled input may produce no primary input while adding committed messages;
a model refusal/error can coexist with committed user input.

Native control records preserve the active leaf and stay outside the native tree/model index. The leading header stores only the required feature marker. Permanent bounded tombstones
survive state restore, rewind, compaction and copies; capacity refusal cannot make an old key executable. Completion
retains original committed entry facts even after a later native rewrite removes their payload. Full copy, fork and
path branch retain origins and distinguish inherited facts from admission to the destination. A copied origin
receipt is not authorization or a new destination admission. Logical header `ompsub1`, carrier `ompgen2` and required
feature decoding make unsupported native rollback refuse submission-bearing data, including logical copies.
Matched readers normalize the header for TUI/tree/leaf/context use. Future native metadata namespaces must retain
these monotonic tombstones and extend the shared feature decoder rather than replacing its ledger.

The public prototype policy fixes 10,000 permanent keys / 32 MiB of control metadata per native Session, 100,000 committed entry
facts and 4,096 no-entry facts per completion, 128 relations per query page, 262,144 UTF-8 message bytes, 524,288 encoded
image bytes and 4,096 pending causal tasks. Over-limit admission refuses before dispatch; an over-limit later
completion remains explicitly unresolved/failed and never authorizes replay. After one feature upgrade, protected append/readback publishes reservations and completions without creating a full generation per input. An owned validated source proof checks native identity/head, inode size/ctime/mtime and generation file identity/stamps before and after append; unexpected drift latches unknown instead of reloading it. The native logical source and physical carrier budgets still include control bytes. The native source and generation
budgets remain those of ADR 0013. These are explicit component limits, not measured full-MVP performance claims.

Evidence uses isolated synthetic profiles, a pre-import egress guard, deterministic provider/tool boundaries,
actual native workers and Linux syscall/process faults. The browser seam uses the actual DSH Client provider's
pre-dispatch marker/request identity, Bun and public native RPC; its host/store and UI are explicitly fixtures.
It does not implement the product original store, private Session admission, a global installation, Windows/WSL2
acceptance or real provider inference. Maintainer acceptance and final combined gates remain separate.
