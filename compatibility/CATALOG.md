# Ticket 31 native readonly catalog candidate

Public additive patch `omp/0002-readonly-catalog.patch` follows the exact 0001 preflight patch.
The CLI accepts **only** `--rpc-catalog`; it lazily imports a dedicated server, never ordinary rpc-ui,
AgentSession, session opening/loading, migration, backup repair, title index or extension/model/tool setup.
Preflight remains Session-readfree and still advertises only its original diagnostic capabilities.
The product Host/default APIs and private admission remain blocked. This is an isolated synthetic candidate.

The authored `wire/catalog.ts` commands and definitions generate the native schema, TypeScript and Python/Rust/Go
clients. The narrow public `catalog-client.ts` and its validators are copied from that same source by the build,
with import locations rewritten; Host imports no private SDK and never reads native Session files.
`--rpc-catalog` uses the same enrolled source-mode runtime closure as ordinary CLI. Its native dependencies remain
external source inputs so native asset lookup works; preflight never imports this closure.

## Public v1 contract

- `catalog_sources` reports `version: readonly-catalog-v1`, actual startup-selected profile, native default source
  and local startup `OMP_CATALOG_SOURCES` JSON absolute directories (at most 15 custom sources). It uses OMP's own
  profile/XDG/default path resolver. Browser cwd grants do not configure Session Sources. Invalid sources remain
  visible as invalid; no recursive machine/profile search or custom-file breadcrumb discovery is performed.
- `catalog_page({cursor?,pageSize?})` reports `scanning`, `complete` or `partial`, absolute snapshot observation/
  expiry, examined entry count, bounded failures and an opaque next cursor. Scan continuations have no items until
  bounded native traversal completes, then all captured descriptors have stable sourceId/nativeSessionId/instanceId
  codepoint ordering. Completed result pages are immutable observations; they do not promise a filesystem-wide
  atomic snapshot. Per-item timestamps describe their actual observation. Header/title changes afterward do not
  rewrite old pages; `describe_session` obtains a fresh observation. Directory membership/identity changes invalidate
  a snapshot explicitly. A new discovery is required after expiry, eviction, stale directory or child restart.
- `describe_session({reference})` returns verified descriptor, missing, replaced, invalid_reference,
  source_unavailable or inaccessible. It never opens a Session or reserves a lease.

A descriptor contains native Session ID, sourceId, instanceId, durable scoped reference, verified relative aliases,
header title (optional, at most 512 characters), header timestamp as createdAt, **filesystem mtime** as modifiedAt,
actual recorded/canonical cwd or unknown/missing/inaccessible/invalid status, observation timestamp, native
held/free/unknown ownership observation with timestamp, and optional parentSession/continuationOf relations.
It exposes no transcript, prompt, exact message count, model state or title-generation request. Metadata beyond the
16 KiB first header line is not scanned. Missing title is honest; no current worker cwd substitutes for a missing header cwd.

sourceId = SHA256(profile + ':' + canonical source root + ':' + SHA256(dev:ino:birthtimeNs)).
instanceId = SHA256(dev:ino:birthtimeNs:nativeSessionId). Native Session ID is a distinct logical identifier.
The reference is base64url JSON `{sourceId,locator,instanceId,nativeSessionId}`; it is an identifier, **not authorization**.
Native descriptor verification merges proven same-physical-file aliases, while same-ID copies remain distinct.
Different source scopes remain distinct even if hard links connect them. Physical replacement/atomic rewrite
invalidates the old instance binding; a fresh descriptor can reissue it while retaining the logical native ID.
Move/rewrite is never silently followed. Ticket 32 must revalidate these exact facts while holding the real native
lease, maintain first-write protection and recheck current directory authority; this readonly observation is no reservation.
In-place edits of a physical file retain its physical instance; no full-history content-integrity claim is made.

The Linux implementation anchors root and descendant traversal to open directory descriptors with O_NOFOLLOW,
O_DIRECTORY and regular-file checks. Configured aliases may canonicalize to the same source; file/bucket aliases
must resolve inside that source. Escaping symlinks become explicit partial failures. Root replacement fails closed.
Only the root and one native bucket level are scanned; deeper directories are not native Session buckets.
Linux native ownership probes call the real `FileLock.isHeld` backend without bind/acquisition. Other platforms
return unknown until their native backend is validated; Windows/WSL2 acceptance remains explicitly deferred.

## Fixed budgets and errors

| Resource | Bound |
| --- | ---: |
| Directory entries examined per request / snapshot | 256 / 8192 |
| Directories / Sessions per snapshot | 2048 / 4096 |
| Native first-header read | 16384 bytes |
| Requested items per page | 1–32 |
| Full JSON response including reserved envelope allowance | 262144 bytes |
| Retained serialized descriptor bytes per snapshot | 16777216 |
| Retained snapshots per child | 4 (oldest evicted explicitly through invalid cursor) |
| Scan loop window / cumulative scan time | 250 ms / 10000 ms |
| Hard native request wall deadline | 3000 ms, child exits on stuck I/O |
| Absolute token TTL | 60000 ms, no read renewal |
| Native input line / Host response buffer | 16384 / 262144 bytes |
| Failure records / aliases per physical instance | 128 / 16 |

Directory state adds at most 2048 bounded paths/stat records; only the current directory is open. Native metadata
reads are serial. Window timing is checked between filesystem operations; the hard child deadline covers a stuck
operation. Descriptor-byte memory excludes directory/map/array/JS overhead, bounded separately by the above counts.
The native response packer returns fewer items with a continuing cursor when needed; it never hides the remainder.
The Host catalog transport independently bounds pending requests and queued/inflight writes at 32, releases
write slots in finally, and skips queued requests that expired before writing. Its startup budget covers ready
and negotiation together, separately selectable from requests/drain; default budgets are unchanged.
The Host catalog transport rejects chunk frames because every permitted catalog response fits below the physical
RPC ceiling, and keeps its actual byte buffer at the catalog response bound.

Cost/metadata errors yield partial results and stable codes (`SCAN_LIMIT`, `DIRECTORY_LIMIT`, `HEADER_LIMIT`,
`INVALID_METADATA`, `OUTSIDE_SOURCE`, `ALIAS_LIMIT`, filesystem codes). Invalid configured sources never produce
empty-success. More than 128 failures ends with `FAILURE_LIMIT`. Corrupt header payloads/error strings are not echoed.
Request failures use `CATALOG_PAGE_LIMIT`, `CATALOG_RESPONSE_LIMIT`, `CATALOG_STALE`,
`CATALOG_CURSOR_SCOPE`, `CATALOG_CURSOR_INVALID_OR_EXPIRED` or bounded generic failure. Invalid command/schema,
oversized input, wrong negotiation or partial EOF terminates the dedicated child. No requests are replayed.

## Pipeline hooks for subsequent patches

`scripts/omp-source.ts` exports ordered `ompPatches`, explicit `authoredPaths` and `temporaryPaths`, plus
`patchedTree(omp, patches)` using an isolated Git index. Verification compares the working authored diff with the
canonical exact ordered patch tree before any upstream generator imports. Hash identity covers base plus all exact
ordered patch bytes. Extend these lists and the narrow generator hook for each real capability. The exporter writes
only the final configured patch against the preceding exact tree; later features must regenerate after merging the
current integration and prior patches. No later feature should edit or collapse 0001/0002.

## Actual native and browser evidence

`bun test tests/catalog/catalog.test.ts` passes 10 tests / 234 assertions: every one of 1000 Sessions in 1000 distinct
buckets is reachable; whole synthetic-home byte/inode/mode/size/mtime/ctime manifests are identical before/after (atime excluded); selected profile/custom
scope, aliases/same-ID copies, unknown cwd, native lease held/free and injected real socket EMFILE→unknown,
metadata/scan/response limits, partial permission errors, stale paging and file/root replacement are exercised.
Actual large descriptors require multiple byte-packed pages; every descriptor remains reachable.
Real 60-second TTL and cross-child/page-scope checks pass separately. Protocol tests prove malformed/oversized input,
ordinary Session commands, partial EOF and cancellation fail without native mutations or orphaned children.
`scripts/trace-catalog.py` proves no write/create/rename/unlink, ordinary Session imports, lease binds or non-Unix
connects in the actual candidate. Bun runtime transpiler caching is explicitly disabled in controlled fixture
children so the entire HOME remains unchanged. The authored new native modules pass strict TypeScript using actual
upstream types; unrelated full-upstream diagnostics are outside that narrow check, not claimed as passing.

The [typed DSH fixture](../apps/catalog/README.md) and [Linux evidence](../docs/evidence/ticket-31-catalog.md)
record the real browser/native path, exact tuple, clean patch reproduction, fixed corpus and remaining product gates.
Only the isolated readonly component is delivered; it does not admit private Sessions or implement protected open.
