# Read-only Session Tree: ticket 50 source slice

This opt-in source adapter and public React slot show native tree pages, the
actual active path and an independent selected-node preview. They are not mounted
in any product Host. Ticket 50 and the MVP remain open.

`ReadonlyTree` uses the existing generated public `HistoryClient` contract:
`history_snapshot_open(scope: tree, handoff: current)`, bounded
`history_snapshot_page(cursor)` and `history_snapshot_close(snapshot)`. It neither
uses an unbounded `get_tree` nor fabricates native pagination. Parent IDs, stable
entry IDs, split-part indices, source cuts and compaction/reset/branch boundaries
come from the current candidate public DTOs. This is candidate source support,
not attestation of the installed global OMP or an accepted product combination.

## Integration boundary

Mount `treeHostContribution` and `ReadonlyTree` only behind the current Host
Session broker. Its synchronous authorization callback must recheck the live
browser credential, directory grant, exact native source/instance and Session,
current worker/context/projection binding, and external-writer occupation. It
returns a read-only port to the already admitted worker and an authority epoch.
It must never register/open a Session, acquire a writer or launch a worker as a
side effect of a tree read. DSH's owner principal is insufficient authorization.
The callback is checked before and after asynchronous reads. Revocation, binding
changes, canceled invocations and disposed peers refuse content.

The only native port methods are snapshot open/page/close; the port has no prompt,
mutation, configuration, file, binary-content or process surface. Host snapshot
handles belong to their Browser View's public Peer; another authorized Peer
cannot consume or evict them. A preview rereads the original strict native cursor
to validate freshness before returning its cached text. It does not advance the
native leaf, issue input, update Conversation or navigate history.

On the client, `registerReadonlyTree(ctx)` registers the public opt-in
`omp.history` slot through DSH's actual slot API and mounts the typed `ompTree/read`
Remote. A parent must explicitly declare/render that root-scoped child with the
current authorized `sessionId` and `authorityEpoch`. Change the epoch on worker,
projection or connection invalidation; unmount on revoked authority. The keyed
component then discards its prior pages and preview. This registration does not
wire any stock DSH shell, create a Session, or invoke private controller methods.
`TreeBrowser.invalidate()` provides synchronous clearing for owners that mount
`TreePanel` directly. The panel also expires its native snapshot at its deadline.
No source/live subscription is added by this slice: the product owner must wire
its existing authoritative binding invalidation before mounting this slot.

## Continuity and presentation

Pages remain explicitly partial until every native part is read. Only then does
the Host validate every parent chain, missing parents/cycles, the actual leaf and
all active flags, and publish the root-to-leaf active path. Append order is never
treated as the active branch. Preview is blocked while the tree is partial.
Native cut changes, stale/expired cursors, malformed parts, unknown content/roles,
unsupported boundaries and resource limits explicitly invalidate the snapshot.
The browser clears old rows and selection on a failed read or invalidation and
rejects late replies; it never retries or replays a mutation.

The full-tree surface shows one native page at a time with explicit parent edges;
previously loaded pages remain selectable. Active-path segments before native
compaction/reset/branch boundaries default to closed details and can be expanded.
Each expanded segment initially renders 64 nodes, with an explicit show-more
action. Selection displays safely escaped text and leaves current Session/leaf
and active-path membership unchanged. No navigation or branch action is included.

The allowlist sends node identity, parent, kind, active flag, supported role and
boundary plus safe native-readable text on selection. Configuration/state kinds
(`custom`, `credential_pin`) and structural kinds use fixed text; provider/model
objects, timestamps, content handles/digests, catalog references, extension state,
raw JSON and binary downloads are not forwarded. Native-sanitized visible custom
messages, file mentions, summaries and readable tool/execution text remain plain
text. Unknown content or continuity types block the relevant read.

The current public DTO flattens rich content into `text`. It has **no typed
per-entry pruning fact**: this view preserves the native `[Native pruned content]`
notice without inferring pruning from strings or reconstructing payload. It makes
no per-entry model-input claim. Rich thinking/tool blocks, original attachment
associations and the complete ticket 46 renderer remain future integration work;
this slice does not claim that flattening satisfies that ticket.

## Bounds and evidence

Disposable memory only: 8 concurrent snapshots, 20,000 nodes and 60,000 parts per
snapshot, 16 MiB encoded cached node/text data per snapshot and 32 MiB across the
service. Preview text is capped at 2 Mi UTF-16 units; a native page at 1,024 items.
Limits fail explicitly, never silently truncate a tree or claim completion. Native
frame, snapshot and expiry bounds still apply through the actual transport. These
are source safety budgets, not measured accepted performance targets. No tree or
transcript is written to disk.

The tests exercise actual public DSH Client Remote → synthetic in-memory
Connection carrier → public Host Gateway → `ReadonlyTree` → actual generated
`HistoryClient` → synthetic native DTO port. The public `TreeBrowser` and React
component use that same Remote result. No private DSH instance is mocked.
They cover the selected/active separation, folding, all cut-field changes,
full-tree continuity failures, split records, stale cursors, source rewrites,
unknown content, hidden configuration, concurrent reads, authority cancellation,
external occupation, revocation during a read, cross-view isolation, late view
replies and explicit page/snapshot budgets. A 2,048-node synthetic tree takes 64
native pages and renders 96 node buttons (one 32-node tree page and 64 active-path
nodes); this establishes fixture reachability only, not Native or browser speed.

TDD red traces: the first Remote test failed on the absent contract; the component
tracer failed on its absent module. The concurrent-read test exposed a refused
read releasing another read's exclusion, then passed after guarding ownership of
that exclusion. Oversized advertised snapshots and empty nonterminal pages failed
before their explicit boundedness checks were added. The full focused suite now
passes: 22 tests, 86 assertions; repository strict TypeScript also passes.

Every Bun run used the approved Bun 1.4.4 executable, `env -i`, synthetic HOME,
profile and cwd, TMPDIR=/tmp, `--no-env-file`, and the existing
`tests/preferences/no-provider.ts` guard before imports. OMP types are erased;
no OMP runtime package is imported. Dependencies are read-only links to the
existing integration installation; no install, vendor copy or compatibility build
was performed. No Native/SDK/Agent/Host process, socket/listener, browser, FFI,
private runtime or private data was admitted. Windows is deferred.

Real Native/browser traces, public source/build/asset identities for the final
supported tuple, broker/auth carrier wiring, live invalidation across actual
Browser Views, ticket 46 rendering, retained/pruned data recovery and the full
acceptance/performance matrix remain unverified. See the [source evidence](../../docs/implementation/ticket-50-source-evidence.json).
