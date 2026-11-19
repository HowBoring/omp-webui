# READY receipt cancellation and late consent: Source only

This adds one sequential public-RPC negative case for #38 at parent
`c98925c7b623901314771337e577f812a0e4e446`, following the frontier PLAN's
priority-5 first transition. The prior malformed-base64 case is actual PASS in
its own consumed scope. Whole #38/#53/#54/#29 remain open.

One valid 28-byte UTF8 original is prepared through the existing public client,
which validates the public receipt schema, correlation, order and representation
digest. The new test requires READY, matching draft/target binding, exact text,
pinned original/prepared hashes and no degradations. It captures otherwise-valid
receipt consent before awaiting public `attachment_cancel`, which must return
`{cancelled:true}`. Late public `submission_submit` with that same consent must
return `ATTACHMENT_RECEIPT_STALE`. Public query must have no reservation/admission,
terminal result or relations; entry snapshots and all controlled-provider effects
must remain exactly unchanged after preparation, cancellation and late refusal.
The complete caller draft/original remains exact; browser persistence is unproved.
The returned public `expiresAt` must still be in the future immediately before
late submission, isolating cancellation from natural expiry. TTLs/clocks remain
unchanged. This is a sequential ready-cancel transition, with pending-publication
races, already-reserved cancellation, repeated cancel and restart left separate.

The expected code is grounded in the existing public contract, not invented:
`rpc-attachments.md` says cancellation invalidates ready receipts; the public
cancel dispatcher calls `attachments.cancel(preparationId)`. For unreserved
matching receipts, `receipts.ts` deletes the token and returns cancelled:true.
`validateAndFreeze` rejects a missing token with `ATTACHMENT_RECEIPT_STALE`, and
`rpc-submissions.ts` calls it before durable `reserveSubmission`. The static
contract audit pins these exact files; runtime proof remains pending.

Only this new test explicitly selects the existing additive candidate alongside
the earlier explicitly selected cases. Existing public preflight/candidate paths
are unchanged: base `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`, source
`d8d12deee18a1b8a56c57785f8bf2f5a23fbb3a21389427cf9fc4eba6e5622d9`, patch
`069eaf6f90773d17d09bf4c3faf3f66ade3a3e362156e03650701ecad4e31b8c`, schema
`8f9c3a086dade38eee57fdb535f1d5b66e81a1f770a2f44e9bc077f41b0e5566`.
Compiled and physical generated identities remain distinct. No Native source,
index/schema, API, build/generator, Host runtime or candidate artifact changed.

Full normal Host noEmit types PASS. Source AST PASS proves all prior 14 cases and
surrounding source bytes exact with one new case (15 direct expect calls).
Public cancellation contract source audit PASS; retainer whole-source comparison
and Python syntax PASS. Runtime red/green remains pending Root's window.
No Native-bearing import/test/actor/preflight/codec, retainer pre/run/post,
generator/build, private field/clock mutation or consumed checker ran.

Fresh Source packet:
`/workspace/work/mvp-implementation/recovery/ticket38-ready-cancel-public-v1-source-20261117/`.
The compact freeze chains from the latest malformed-base64 992-record freeze,
with one test override and current evidence/source additions. It preserves prior
actual receipts/artifacts by hash, with no full inventory/source copies.
`public-retainer.py` keeps the reviewed original ownership/capture semantics,
changing only ready/module labels, case name, fresh evidence/home prefixes and
started-event label. Root alone runs fresh metadata pre, exactly one anchored
case (14 filtered), and metadata post after paired Source review and coordinated
one-window/no-provider capacity. First failure stays failure; no retries, fixes,
weakened expectations, numeric recovery or consumed-scope reruns. Original
ownership uncertainty stays HOLD through original wait/readers/EOF. No P_ALL,
general extinction, Windows, global/private/product or browser support claim.
