# Scoped semantic draft provider — ticket 57 SOURCE candidate

This unregistered component implements the existing public DSH
`ConversationDraftProvider`. No application imports or registers it. It is not
ticket 57, attachment preparation, product recovery or MVP acceptance.
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

Original preparation returns one ordered visible invalid item by default:
`draft_native_preparation_unavailable`. An optional resolver uses the existing
public provider preparation signature and must already supply authorized,
prepared Files or current invalid reasons. Staged `OriginalIntake` bytes and
`read-base64` acknowledgements cannot implement positive Native preparation.
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

## Source validation

The tests use the public provider methods, actual DSH public record decoder and
constructors, synchronous in-memory storage, controlled ownership/authority and
deferred resolver promises. The source typecheck maps the public Conversation
and SessionController client entrypoints to exact active patches 1–3 under an
ignored, read-only `vendor/dsh` link. It includes the upstream CSS declaration;
there are no replacement public declarations or copied dependencies.

With that exact source tree and the repository dependency links available:

```sh
bun test --tsconfig-override tests/drafts/tsconfig.json \
  --preload ./tests/interactions/no-provider.ts ./tests/drafts/provider.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tests/drafts/tsconfig.json
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
and Windows acceptance remain open. Active patch manifests, locks, generated
assets, application entrypoints, admission and package scripts are unchanged.
