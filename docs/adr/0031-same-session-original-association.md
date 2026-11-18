# ADR 0031 — Associate Originals with committed entries in the same Session

- Status — Source component for [#56](https://github.com/HowBoring/omp-webui/issues/56). Host registration and product acceptance are pending.

The #38 attachment candidate publishes a preparation receipt with exact Original and
prepared object identities and separate digests. Its durable `submission_query`
publishes the consumed preparation manifest and Native-computed attachment links
on retained entry relations. Each link supplies the saved part kind and index.
The [candidate artifact manifest](../../packages/contracts/candidates/attachment-association-v1/candidate.json)
pins the receipt and query validators to that schema. The earlier submission
candidate has no attachment manifest or locators.

Before dispatch, the trusted Host preparation coordinator checks the ready receipt
from its matched, correlated public RPC transport against its attempt, selected
Original IDs, live authorization and the exact stored Original digests. It records
a durable hold in the Original SQLite database. Hold creation and staged expiry or
deletion serialize in that database. Held Originals stay charged and cannot renew
their staged lifetime. The coordinator needs to recheck whether it can dispatch
after the hold operation. Dispatch and commitment require their own evidence.

Settlement accepts a complete, first-page read-only query of at most 128 relations
from the matching Native worker. The submitted ID, local origin, source, instance,
Session and consumed preparation must match the hold. Settlement needs a retained
committed initiating input and a unique retained committed entry locator for every
held object. The Native relation places an image in the input's `content` array
and prepared text in its companion entry's `files` array. Unknown, inherited,
paged or ambiguous evidence keeps the hold in place. Both exact retry and
conflict handling use persisted facts across Store connections and reopen.

Committed Originals use the same overall object and byte quotas and release
their staging draft quota. They remain protected by the existing staged-only
deletion and collection paths. The internal read requires current browser,
directory, Session and exact staged binding authority and verified current query
evidence at the saved entry. It checks the Original bytes against the staged
digest and rechecks authority before returning metadata or bytes. The Store saves
only object and causal metadata. Filesystem paths, Native model representations and
conversation content stay outside the ledger.

Native attachment preparation and read-only query transport still require
matching product composition. The caller must enforce response bounds,
request/worker correlation, first-page query identity, and current grants.
Safe preview/download routes, historical grants beyond the original page/draft,
terminal no-input and cancellation release, authoritative branch-copy provenance,
associated deletion review and real matched Native/browser acceptance remain open.
The tests exercise the unregistered Store with synthetic public candidate frames
and real temporary SQLite files. The reopen checks use a fresh Store connection
in the same process.
