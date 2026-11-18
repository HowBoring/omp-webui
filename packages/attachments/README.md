# Host attachment Originals for tickets 54, 55, 56 and 58

This is an opt-in Host-owned original store and proposed public intake contract.
No product Host registers it. Tickets 54 and 55 and umbrella ticket 29 remain open.
Native preparation, historical routes and browser upload controls remain gated by
tickets 36/38/41/45 and the matched-combination acceptance requirements. The
same-Session association seam is unregistered and consumes the #38 candidate's
public source-only receipt and query contract.

`OriginalStore` stores exact supplied bytes, an independently calculated SHA-256,
display metadata, a staged timestamp and only the minimum Host scope/index data.
Its acknowledgement says `staged-unprepared` and `unassociated`, with the
validation described below. It acknowledges exact-byte staging. A busy, already
explicitly opened Session can stage a draft.

## Supported declarations and intake checks

The upload descriptor uses canonical media types. Declare UTF-8 text or source
as `text/plain`, PDF as `application/pdf`, DOCX/PPTX/XLSX with their OpenXML media
types, and EPUB as `application/epub+zip`. The image declarations are `image/png`,
`image/jpeg`, `image/webp` and `image/gif`. The display name does not affect this
selection. A future browser carrier must supply the applicable declaration.

`utf8-only` means the stream decoded as UTF-8, including at EOF. The store writes
and hashes the supplied bytes, preserving the BOM and line endings if present.
Invalid encoding returns `attachment_invalid_utf8`. `signature-only` means the
image, `%PDF-` or ZIP local file header matched the declaration. A mismatch
returns `attachment_media_mismatch`. ZIP headers are shared by DOCX, PPTX, XLSX
and EPUB. The Host does not inspect containers or identify their internal format.
Native preparation must establish document integrity and package type, perform
conversion, and report truncation or other degradations before consumption.

## Trusted authority and public ports

`OriginalIntake<Caller>` is the proposed raw-stream Host port. Its `stage` accepts
a caller admitted by the Host carrier, a Session/draft target, display metadata,
the exact declared byte length, an async byte stream and a cancellation signal.
Its `read` returns bytes and metadata, never a filesystem path. Both methods
reject asynchronously with a known, stable `attachment_*` error code.
Invalid targets/descriptors use `attachment_invalid_target` /
`attachment_invalid_descriptor`; unexpected storage failures, including SQLite
reservation failures, use `attachment_storage_unavailable`. Existing authority,
cancellation and quota refusal codes retain their meaning. The Host callback
must recheck current browser credentials, canonical directory grants, verified
Native profile/source/instance/Session identity, trusted page/draft ownership and
the applicable occupation/access policy. It must attest explicit verified New/Open
before the first reservation/body read. Neither discovery nor a DSH owner
principal satisfies that requirement. The callback must never create/open a
Session, launch a worker, acquire a lease or grant authority as a side effect.

The trusted scope includes Host, browser, page, profile, source, instance, native
Session, canonical cwd and draft identities. These identities are not assertions
the browser can supply to the store. The source Remote accepts only target
Session/draft IDs and calls the Host authorizer to obtain the full scope.
Store callbacks run before reservation, between chunks, before publication and
before/after each read. Scope or authority-epoch changes during an operation
refuse it. An object ID or identical SHA never grants access to another scope.
Reopening the same verified page/draft scope after Host restart permits a fresh
authorized original read; it does not restore a prepared receipt or execute input.

`attachmentContribution` / `AttachmentRemote` propose the opt-in typed
`ompOriginals/exchange` Remote, with `stage-base64` and `read-base64`. The actual
public DSH Client, synthetic Connection carrier and Host Gateway are exercised in
the fixture. This is a new Host contract, not an invented existing Native API or
stock DSH upload method. After authorization and reservation, the Remote checks
that the encoded length matches the reserved byte length before decoding. Base64
must round-trip canonically, and the decoded bytes must match the reservation.
The schema bounds encoded data for a 10 MiB original. Native/RPC and renderer
budgets require separate checks.

No HTTP/WS route is provided. Before mounting either port the carrier must admit
Host/Origin, current credentials, CSRF for writes and exact resource rights before
reading a large body, parsing sensitive arguments or looking up an object. It
must bound the full JSON envelope, raw stream, request deadline, connection and
output buffering, propagate request/Peer cancellation, and use safe download
headers/rendering. Base64 in typed JSON cannot execute an HTML/SVG original;
there is no inline preview route in this slice. Real browser raw/paste/drop and
fallback behavior remain unexecuted.

## Private filesystem and durable quota

The locally configured `dataDir` must be dedicated to this component. It is
canonical, non-symlink and mode 0700; SQLite and payload files are owner-only.
Random opaque object IDs select exclusive, no-follow temporary files. Names are
display text only, including names resembling absolute or traversal paths; they
never select a destination or overwrite project files. Reads refuse symlinks,
hard links, missing files, size mismatch and digest mismatch. No browser response
contains an internal storage path or raw filesystem error.

Defaults are 10 MiB per image, 5 MiB per text or document, 8 originals / 32 MiB
per page/Session draft and 10 GiB of total original payload storage, including
in-flight and failed-cleanup temporary bytes. Text, documents, and images share
the same reservations and every draft/store limit. The fixed text/document
ceiling also applies when the Store's `objectBytes` image limit is overridden.
A transaction with `BEGIN IMMEDIATE` reserves the entire
declared size before body iteration. Chunk limits prevent writing past that
reservation; under-length streams also fail. SQLite transactions serialize
reservations across connections. The same persisted limit configuration is
required on every connection/reopen; changing options cannot bypass a full store.
Source safety bounds additionally cap the store at 100,000 object rows and
16 in-flight reservations across connections. Metadata/index/journal filesystem
overhead is separate from the attachment payload budget. These caps are safety
budgets, not measured acceptance/performance results.

Temporary-to-original publication is an atomic rename within this private root,
so it does not duplicate payload bytes. File and directory fsync precede the FULL
SQLite metadata commit and acknowledgement. Failed/aborted intake closes and
unlinks its files; accounting is released only after physical cleanup and
directory sync. Failed physical cleanup retains the full reservation. Stalled
streams are interrupted on cancellation without waiting for another chunk or for
an uncooperative producer's `return()` promise.

An exclusive Host startup owner opens with `recovery: "exclusive-host-startup"`
before accepting requests or opening other connections. It recovers interrupted
`receiving` rows and their partial/renamed files, releasing accounting only after
cleanup. Later connections use `shared-connection`; they must not clean another
connection's active intake. This is a trusted startup ownership precondition,
not a cross-process Host-ownership lock. No PID/process/kernel probe is performed.
Unknown or oversized/unaccounted payload files cause startup refusal; they are
not silently ignored or evicted. Missing/corrupt staged originals remain charged
and fail reads rather than being misrepresented as good data. Abrupt power-loss,
kill/restart and filesystem durability acceptance are still unexecuted.

Any future prepared or derived sink must reserve its temporary and durable
payload in this same total ledger before writing.

## Staged Original lifecycle

`OriginalStore.touchDraft` records deliberate edits and active recovery after a
trusted draft coordinator accepts the action. The store rechecks exact authority
and updates the listed, still-eligible staged IDs in that draft. The result
identifies unavailable references alongside successfully renewed IDs. The first
clock starts at publication, with existing rows initialized from their persisted
staging timestamp. Reads, refreshes and reopening the Store preserve the clock.

The Host can call `collectExpired` at 24 hours after the last activity. It inspects
at most 128 rows per pass and returns a continuation when more rows remain.
Eligible staged bytes are readable until logical removal while the staging gate
permits access. A configured gate permits staging reads only for Originals with
a current unreferenced determination.
Both collection and explicit deletion require a trusted, current unreferenced
determination for the exact Original and its full binding. Missing or unknown
evidence and occupied, executing, unresolved or Native-associated references
retain the Original. The gate must coordinate reference admission and removal
commits on every connection. Native reference evidence and coordination remain
product integration dependencies.

`previewDeletion` shows the current staged draft impact and issues a five-minute
confirmation scoped to its Store connection, Original, binding, authority epoch
and protection revision. The revision must change whenever protection or known
references change. `confirmDeletion` consumes the confirmation on the first
attempt and rechecks current authority and the protection revision before
committing logical removal. A refusal requires a new preview. Exact reads fail
after removal. Independent same-hash objects keep their own rights and quota.
Physical cleanup validates and unlinks the exact payload and syncs the directory
before releasing the charge. Failed cleanup keeps the tombstoned bytes charged
until exclusive recovery completes. Startup validates the entire payload
inventory before reclaiming interrupted writes or tombstones.

## Same-Session association

The trusted Host coordinator can reserve exact staged Original IDs using
`reserveForSubmission` with a matched Native preparation receipt. The resulting
SQLite hold survives reopen and participates in the same staged deletion and
collection locks. `recordSubmission` requires a complete correlated public
`submission_query` for that local attempt, its consumed receipt manifest, and
committed retained entry locators for all held objects. `readAssociated` requires
current authority for the exact original binding and current public query evidence
for the persisted entry. See [ADR 0031](../../docs/adr/0031-same-session-original-association.md).

## Evidence and remaining gates

Tests use real tiny synthetic byte streams, private temporary files and real
Bun SQLite. They observe public store/intake/Remote behavior. Filesystem faults
are applied only to their configured synthetic private root; no database queries
or private-field mocks assert behavior. The restart check opens a new Store/SQLite
connection in the same process. The interrupted-write check displaces the real
configured directory between chunks, then restores it before exclusive recovery;
it is not a claim of actual Host-process or power-loss acceptance.

The source tests cover exact-byte/hash reopen; two-connection concurrent
reservation and full refusal; persisted limit enforcement; object/draft/in-flight
caps; partial/aborted/mismatched streams; midstream revocation and authority-epoch
changes; current scope and same-hash isolation; missing/corrupt payloads; display
traversal/project non-overwrite; private permissions; unknown payload startup
refusal; typed public Remote base64 stage/read; and unverified/revoked scopes.
Text/document coverage includes exact split UTF-8 byte round trips across Store
reopen, independent size admission at 5 and 10 MiB, mixed-format draft and store
reservations, document signature-only results, and Remote encoding, signature
and quota refusals. The size tests exercise declared boundaries before body
consumption. They use small files for successful byte round trips. Lifecycle
tests cover the 24-hour boundary across reopen, migration from the previous
schema, a dropped upload reply, scoped renewal, protection states, bounded
scans, stale or revoked confirmations, concurrent read invalidation and
validated physical-cleanup recovery.

Native bounded decoding, model and complete encoded RPC budgets, valid and
malformed selected files through actual prepare and consume, degradation
confirmation, matched Native entry association and branch proof, draft
restoration, safe download and rendering, product lifecycle integration and
actual Linux and Windows Chrome/WSL2 browser results and performance remain open.

See [ADR 0021](../../docs/adr/0021-host-original-intake.md) and the
[source evidence](../../docs/implementation/ticket-54-source-evidence.json).
