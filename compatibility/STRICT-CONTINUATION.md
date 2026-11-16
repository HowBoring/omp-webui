# Isolated strict continuation candidate (#32)

Private product admission remains blocked. The normal interactive worker remains `--mode rpc-ui`.
The additive `--strict-start` option enters a deferred public startup protocol before ordinary Session,
extensions, model setup or extension UI. Browser input supplies an opaque registered selection and an explicit
New/Continue action; executable, arguments, native paths, profile and Session Sources are Host startup configuration.
Working-directory authorization is a separate Host decision from source visibility.

`strict_start({intent,expectedCwd,reference?})`, `get_strict_state` and `cancel_strict_start` are authored in native
wire definitions and generate the schema/clients/validators. The prelude announces the same effective explicit
answer UI policy as ordinary rpc-ui and a public strict startup policy. The policy is marked prototype until
review and the complete native-reader matrix pass. It declares Linux, required fd xattrs, process-crash durability,
format/budgets and flatten-export rollback. Other platforms/filesystems have no fallback and are unverified.

Continue resolves exactly the #31 source/physical instance/native-ID/reference tuple, acquires the actual native
exclusive ownership lease, and revalidates source, parent directory, Session and cwd identities. Ownership errors
are unknown, never the ordinary native storage's no-op release. A pinned writable fd is held through startup and
all native writes. Native append/publish critical sections serialize participating writers. Replacing a namespace
entry cannot redirect the fd or authorize writing/removing its replacement. Readbacks refresh #34's source binding
under the owned lease after full rewrites. No sibling, empty-session fallback, backup promotion, takeover, unknown
TUI termination, retarget or automatic persistence retry is permitted. No hostile same-UID integrity/availability
claim is made.

New is a distinct public intent: trusted native default location, real lease, exclusive native file creation and
native UUID/header before ordinary runtime setup. A failed/uncertain creation remains visible as unknown; it is
not deleted or retried. Explicit ordinary native New/fork/branch alone can drain and create a fresh owned backend
from genuine logical native serialization. The strict Host worker cannot invoke that transition as recovery.

## Native generation v1

A strict full rewrite cannot use stat/check/rename as an inode CAS. Instead it retains the selected carrier inode,
prepares exclusive immutable native JSONL `.gen` and bounded `.meta` files in a bound sibling directory, installs
an fd-bound checksummed xattr head, converts only the header's seven-byte `session` discriminator to `ompgen1`,
and appends a checksummed generation commit record to the held carrier. Native appends after a commit remain in
the carrier suffix. No Session-body truncate, carrier rename or unlink publishes state.

The head announces current and previous commits at explicit byte offsets. Missing/incomplete current commit means
the previous committed state (or generation zero); a complete committed head with missing/corrupt metadata/body is
an error. Complete malformed/unsupported controls are errors. A short discriminator is incompatible/indeterminate;
a short commit is not committed and writable continuation refuses the incomplete tail. Prepared controls remain
for native-only investigation. No Host repair or automatic replay occurs. Software process-crash points are tested;
there is no fsync/power-loss guarantee.

The permanent `ompgen1` header ensures ordinary copies/restores that lose both xattr and sidecars cannot masquerade
as old legacy history. Baseline native TUI refuses that header without mutating the source. Matched native readers
resolve complete logical state. Copying a carrier is not a supported backup/export; native pack/render export flattens
logical state under ownership. Rollback requires a successful flattened native export, exclusive access and baseline
reader proof on the export. Reinstalling an old binary over extended carrier data is not a rollback.

| Bound | Value |
| --- | ---: |
| Logical body / physical carrier | 128 MiB / 256 MiB |
| Retained immutable generation files | 512 MiB total, 64 generations, 128 directory entries |
| Immutable metadata / commit record / xattr head | 1024 bytes each |
| Catalog carrier prefix / control budget / winning prefix | 16384 / 6144 / 16384 bytes |

Quota counts actual retained file sizes and refuses before preparing another generation. There is no unsafe GC.
Catalog never hashes/loads full history: committed metadata binds exact prefix length/hash, carrier identity,
native ID and immutable body size. Full loaders separately verify the whole committed generation. A missing newest
committed manifest cannot silently select an older manifest, even after a large append tail: the fd head identifies
its authoritative marker directly.

Generation-aware paths include central full/stream/header loaders, FileSessionStorage read/stat/slices/scan,
ordinary SessionManager/TUI continuation and title writes, pack/render export, subagent byte reads, activity and
memory rollout readers. Generation maintenance GC/strip/compress/delete/generic relocation explicitly refuses
(or opportunistic GC skips) without partial destruction; these operations are not supported by format v1. A hardlink
alias lacking controls is an explicit catalog partial error while the original bound reference remains valid.
Full publication with multiple hardlinks refuses before mutation. Source lookup never guesses another directory.

## Typed acceptance fixture

`apps/continuation` uses real DSH Context/Connection/Registry/Gateway and typed ClientRemote calls to the Bun
`ompContinuationFixture` Remote. Host stores a bounded native reference index separately from native ownership
and actual process state. First explicit Continue registers before revalidation/startup. Discovery, reload,
reconnect and state checks never start/replay a worker. Unknown results preserve the owned worker for a read-only
state check. Cancellation before intent dispatch remains known cancelled; cancellation after effects may remain
cancelling/unknown. Known owned workers are drained; foreign native owners are only observed.

Build: `bun scripts/build-continuation-fixtures.ts`; `bun compat:build`; `bun apps/continuation/build.ts`;
`bun scripts/build-continuation-host.ts`; `bun scripts/create-continuation-fixture.ts`;
`bun scripts/enroll-candidate.ts --continuation-fixture`; run
`bun --no-env-file vendor/host-continuation/continuation-fixture-main.js`, then
`python3 tests/browser/continuation-browser.py`. Build diagnostic assets first on a fresh checkout.
The fixture authoring command replaces only its ignored synthetic `vendor/continuation-profile` and must run with
its previous owned fixture stopped. Product Host never imports the native fixture author or parses Session files.

OS fault seams are explicit synthetic-profile-only test launchers: authored C injects an actual AF_UNIX EMFILE;
owned Linux ptrace child control observes/faults genuine pwrite64 and records actual syscall return counts. A
passthrough control proves interception. No attach/global preload exists. The wire-only fixture drops exactly one
startup result. These seams are not production behavior; product launch environment never inherits fixture flags
or LD_PRELOAD. Provider pre-import guards and independently observed zero INET traces are distinct evidence.

Nested extended artifact Sessions are logically flattened for explicit native copy/fork/branch-copy operations. Real child leases and complete shared-reader cuts are prepared before destination publication; occupied/unknown/corrupt/budget cases refuse. Fresh files use Linux O_TMPFILE plus fd-bound linkat with no-clobber names; there is no rename/unlink/truncate fallback. Copy is bounded to8192 entries/256 directories/32 levels/64 native children/128MiB total body. Generic archive pack of nested extended artifacts currently refuses; parent-only flattened pack is supported. Native branch without copyArtifacts retains its ordinary no-copy semantics.
