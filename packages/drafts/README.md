# Scoped semantic draft provider — ticket 57

`apps/chat/src/client.tsx` implements this provider's public
`ConversationDraftProvider` contract with a per-tab Web Lock owner,
sessionStorage records and the typed Host Originals Remote for preparation, and
hydrates through its public `scope`/`read`/`prepare` seam. It does not call DSH's
provider-mode `registerDraftProvider`: that composer runtime is not mounted, so
the chat surface owns atomic hydration. This is not product root admission or
MVP acceptance.
ADRs [0009](../../docs/adr/0009-original-attachments-and-drafts.md) and
[0021](../../docs/adr/0021-host-original-intake.md) retain their existing boundaries.

`createDraftProvider` accepts trusted current authority, an already acquired
exclusive tab owner and a synchronous same-tab storage port. Use sessionStorage
semantics: `setItem` publishes one whole record synchronously or throws. Storage
failure rejects the checkpoint. There is no shared localStorage fallback, async
storage implementation, Web Lock acquisition or copied-tab enrollment here.
The owner must remain live; authority must require explicit verified New/Open,
current browser/page and canonical cwd rights, exact profile/source/native
instance/Session/draft, and a fresh non-reused epoch after revoke/reacquire.
The adapter cannot establish these facts itself.

The stable key contains owner, Host context, browser, page, profile, source,
native instance, native Session, canonical cwd and draft. It excludes authority
epochs and worker/projection generations. Ephemeral scope additionally fences
the current authority epoch and public projection source/generation. Stock and
ready public projections are allowed; rebuilding, failed and aborted projections
are refused. Scope comparisons accept DSH's copied hydration scopes and exact
public projection generation. The lifetime is bounded to 128 scope identities.

Records pass the actual public `parseSemanticDraftRecord` before storage or
return. Each encoded record is bounded to 4 MiB and eight ordered originals,
including an unresolved attempt's originals. Text, command metadata, references,
quotes, display names and ordered logical original identities survive reopen.
The storage record contains no runtime readiness, receipt, upload identity,
original path, object URL or retention clock. User-authored document text is
preserved as semantic content.

Writes serialize in call order and recheck current authority, ownership,
projection and cancellation immediately before synchronous publication. Reads
wait for preceding writes and recheck authority before returning. Disposal
permanently retires the provider. A protected owned attempt cannot be edited or
implicitly cleared. A marker with `ownsDraft: false` preserves its exact attempted
snapshot while a separate newer draft changes. Marker removal requires both a
`recovery` write and the supplied `authorizeRecovery` gate for that exact previous
attempt and next record. Without that gate, even a recovery-labeled write is
refused. This is an external authoritative outcome prerequisite, not an outcome
lookup, transport-ack inference, automatic retry or Native receipt.

Read, write and preparation operations independently copy and freeze all six
required public scope fields at entry, before any queue or await. Mutating a
caller-owned copied scope cannot redirect an operation to another current draft
or let an old preparation result return under replacement authority. Copies with
the same identity remain accepted; authority is still rechecked at completion.

Original preparation returns one ordered visible invalid item by default:
`draft_native_preparation_unavailable`. The chat resolver re-reads
each exact staged Original from the trusted Host Remote under the current
explicitly opened scope, so a stored receipt is never trusted after reload or
restart; missing, expired or unauthorized objects become visible invalid items.
The adapter rejects partial cardinality, checks authority/cancellation again
after a deferred resolver and refuses preparation for unresolved storage.
It neither uploads nor creates runtime attachment IDs; DSH retains its existing
atomic hydration/revision engine and fresh receipt lifecycle.

There is no retention renewal operation. Read, hydrate, projection, edit and
recovery writes cannot update a Host clock here. Positive acknowledged edit or
active recovery renewal, protection/reclamation races and a durable retention
service remain tickets 57/58 integration work. A clock-driven resolver test only
proves that previously returned synthetic Files are not cached after expiry;
it does not implement or validate a real Host expiry service.

## Package validation

The tests use the public provider methods, actual DSH public record decoder and
constructors, synchronous in-memory storage, controlled ownership/authority and
deferred resolver promises. The provider imports the draft codec from
`@deepseek-ai/dsh-client-ui-conversation/client/semantic-draft`. The test reads
projection bindings from SessionController's public `/projection` export.

The focused scope-mutation fix added three deterministic regressions. Queued A writes must
not publish into B, pending A reads must not return B, and deferred A Files must
not return after replacement with B. Same-identity controls remain successful.

Prepare the active DSH build and dependency links using the
[DSH setup instructions](../../compatibility/dsh/README.md). Then run the checks
from the Host repository root.

```sh
bun test --no-env-file \
  --preload ./tests/interactions/no-provider.ts ./tests/drafts/provider.test.ts
bun run typecheck
```

The preload runs before DSH imports. It denies provider/network dispatch. No
Native/OMP/SDK/Host entrypoint, process/worker/listener, browser or actual provider
is executed by these tests. Synthetic authorized File and expiry results are
explicitly fixture evidence. Same-owner reopen means a new adapter in the same
process with the same storage fixture; actual refresh, Host restart, duplicate
tabs, lock contention and browser close remain unexecuted. Public Client atomic
editor observations, fresh runtime upload IDs, no-prompt/no-create request
counters and the complete stale-restore/edit matrix remain the existing DSH
fixture and future composition gates, not claims of this provider-only suite.

Native preparation/consume, authoritative durable outcomes, matched private
admission, real retention clocks/GC/deletion, selected formats, product browser
and Windows acceptance remain open.
