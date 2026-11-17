# Host attachment originals: ticket 54 source slice

This is an opt-in Host-owned original store and proposed public intake contract.
No product Host registers it. Ticket 54 and umbrella ticket 29 remain open.
Native preparation, Native commit associations and browser upload controls remain
gated by tickets 36/38/41/45 and the matched-combination acceptance requirements.

`OriginalStore` stores exact supplied bytes, an independently calculated SHA-256,
display metadata, a staged timestamp and only the minimum Host scope/index data.
Its acknowledgement always says `staged-unprepared`, `signature-only` and
`unassociated`. It is neither a DSH prepared attachment receipt, a Native model
representation nor a Sent Attachment. No transcript, Native Session file parser,
Native runtime import, worker, prompt, send, queue or implicit Session creation
surface exists here. A busy, already explicitly opened Session can stage a draft;
this component cannot enqueue execution.

## Trusted authority and public ports

`OriginalIntake<Caller>` is the proposed raw-stream Host port. Its `stage` accepts
a caller admitted by the Host carrier, a Session/draft target, display metadata,
the exact declared byte length, an async byte stream and a cancellation signal.
Its `read` returns bytes and metadata, never a filesystem path. Both methods
reject asynchronously with a stable `attachment_*` error message of at most
96 characters. Invalid targets/descriptors use `attachment_invalid_target` /
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
stock DSH upload method. Base64 must round-trip canonically; decoding happens only
after authority and reservation. The schema bounds encoded data for a 10 MiB
original. It does not establish acceptable Native/RPC or renderer budgets.

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

Defaults are 10 MiB per image, 8 originals / 32 MiB per page/Session draft and
10 GiB of total original payload storage, including in-flight/failed-cleanup
temporary bytes. A transaction with `BEGIN IMMEDIATE` reserves the entire
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

There is no derived-data writer in this slice. Any future prepared/derived sink
must reserve its temporary and durable payload in this same total ledger before
writing; a separate unaccounted derived directory would violate the contract.
There is no GC, delete, sent-state, execution-protection or uncertain-commit
transition here. All published objects remain retained and charged. Tickets
57/58 must add draft clocks, protected lifecycle states and confirmed deletion
without automatically evicting history or trusting browser-supplied flags.

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

Only image magic signatures are checked here. A corrupt image with a valid
signature remains explicitly unprepared. Native bounded decoding, model/complete
encoded RPC budgets, all real selected formats, actual prepare/consume,
degradation confirmation, native durable entry associations, draft restoration,
read/download renderer safety, protected lifecycle/GC/deletion, actual Linux and
Windows Chrome/WSL2 product browser results and performance remain open gates.

See [ADR 0021](../../docs/adr/0021-host-original-intake.md) and the
[source evidence](../../docs/implementation/ticket-54-source-evidence.json).
