# Coherent native history candidate (#34)

S0 fixture implementation only. Private product Session admission remains blocked. This patch does not
implement the full MVP, exact live-message settlement (#35), protected native open (#32), persistent navigation
(#37), DSH generation rebuild (#40), Attachment Original associations (#56), or formal performance acceptance (#60).
Linux Chromium is exercised. Windows Chrome/WSL2 remains explicitly deferred by the owner.

`omp/0004-coherent-history.patch` follows the exact ordered 0001 preflight, 0002 catalog and 0003 interaction
patches. It authors the native manager observation primitive, RPC handler, handwritten and generated clients,
and `wire/history.ts` in the actual pinned OMP source. No Host code imports SessionManager/AgentSession or
reads/parses native Session files. The source build verifies the complete ordered patch tree before importing
any generator. Generated Host validators and the narrow public `HistoryClient` are copied from that source.

## Public commands

- `history_snapshot_open({scope: 'tree'|'active'|'running'})` synchronously captures one native observation.
  The result has `version: coherent-history-v1`, snapshot ID, the requested scope cursor, **all three** scope
  cursors, cut, absolute expiry, item/continuation count, streaming/compacting state and running-prefix marker.
  All scope cursors reference the same immutable captured state; opening scopes separately is unnecessary.
- `history_snapshot_page({cursor})` reads immutable readable items from that cut. Tree rows use native append
  order; active rows follow the actual leaf's parent chain in root-to-leaf order; running rows represent current
  Agent messages plus the actual current streaming prefix. These are distinct views, never provider-input audits.
  The prefix's content is paged in the running scope, including when the retained tree is empty.
- `history_content_page({cursor})` reads bounded base64 parts of a retained native image representation.
  The cursor binds snapshot/source/revision/expiry/content/part. Metadata carries MIME, decoded byte size,
  SHA-256, `origin: retained_native`, and `originalAssociation: unproven`. Exact Host Attachment Originals are a
  different future association. PNG/JPEG/WebP/GIF representations remain accessible without giant history frames.
- `history_observation_poll({workerId, after})` reads contiguous bounded **observation notifications**, including
  native mutation and live event kinds. It returns a current coherent cut and `through`/`hasMore`. It is not a
  persistence journal, an entry-delta API or a live-message-to-entry join. Missing/old-worker/ahead cursors fail.
- `history_snapshot_close({snapshot})` releases a snapshot; already closed IDs are harmless. Old page/content
  cursors then fail. No read renews expiry, mutates the Session, sends input or runs a model.

A cut identifies source, native Session, worker, native context epoch, full content revision, actual leaf and
observation sequence. Every cut explicitly reports `durability: not_attested`; successful reads never prove a
message or navigation was committed. SHA-256 covers every serialized retained entry payload (including hidden state), parent
relationship, header, mutation/context counters, running message, prefix and opaque runtime context (system prompt, model, thinking and tool definitions), independently of leaf/count/mtime.
Capture runs synchronously without an await; a reentrant native mutation during serialization rejects the cut; no successive public reads or arrival-order stitching is involved.
Normal native insert/rebuild/clear/leaf/rewrite/physical-rewrite paths advance native counters. Full serialization
also catches same-shape mutations through mutable native entry payloads. Captured pages hold serialized strings
and return fresh parses; later source mutation or a caller editing a returned DTO cannot rewrite those strings.

Any later content/source/leaf/context change rejects old page and content cursors with `history_changed`, even
when leaf and count return to their original values. Expired/released/foreign/restarted cursors explicitly fail.
A failed/gapped read never means empty successful history. Caller closes/reopens and rebuilds from a new cut;
it must not merge pages from different cuts or replay a prompt/navigation.

## Source binding and shared native hooks

Unbound synthetic fixtures explicitly report `cut.sourceBindingStatus: worker`: their source ID is a worker-local
native-path/memory identity digest, **not** the catalog source ID. The worker and native Session binding still
scope every cursor. `SessionManager.bindHistorySource({sourceId,instanceId,nativeSessionId,reference})` is a native
internal integration hook for #32 after real catalog revalidation under the actual lease. It is not a public RPC
setter and cannot be invoked through this browser Remote. Mismatched native Session identity or oversized/invalid
binding fields fail. Binding changes advance revision/context and reject old cursors.

Catalog-bound cuts carry the exact supplied descriptor tuple and `sourceBindingStatus: catalog`. Native load and
physical rewrite clear that binding; #32 must refresh/rebind under its strict-open/lease authority before treating
the resulting worker as catalog-bound again. History does not grant private access or prove a lease by itself.

`SessionManager.subscribeHistoryChanges(listener)` is independent of the collaboration append callback.
`NativeHistoryChange` carries kind, native mutation/context counters, native Session, actual leaf and optional
entry ID after index mutation. Insert/rebuild/clear/setLeaf instrumentation covers title append, replication,
load/copy, rollback, discard/delete/reparent, reset/compaction, and explicit rewrites. Physical rewrites also
invalidate source bindings. These notifications describe memory/source observation, **not confirmed durability**.
`captureHistoryObservation(runtime, limits, materialize = true)` deep copies by default. Page validation/poll uses
hash-only mode in the same synchronous turn; it never publishes mutable manager objects. The per-worker
`RpcHistoryObservation` installs the native listener before opening, observes session events before output filters,
and includes the shared live watermark/prefix in each cut. #35 can add actual persistence/no-entry decisions to
this registry without replacing native collaboration listeners or guessing message/entry adjacency.

The runtime context is serialized once inside the native cut, hashed as `contextContentRevision`, and never
included in Browser DTOs. `contextId` includes source, native context counter and that opaque digest, so runtime-only
context changes at identical leaf/count also invalidate pages. The native serializer uses the existing public
`stringifyJson` lossless-bigint semantics. Known unavailable native image representations retain their readable
message and an unavailable marker, without inventing a content handle or Attachment Original association.

## Readable mapping

No native record is silently removed from the tree. Known internal/custom/configuration/credential records become
structural markers. Only explicitly displayed custom/hook messages expose readable content; details, provider
payloads, configuration objects, credential pins, signatures and extension state are never spread into DTOs.
Known text/thinking/tool result facts, safe file mentions, native summaries, reset markers and native execution
output have specific readable mappings. Retained images have bounded content cursors. Unknown entry types,
broken parents, duplicate IDs, off-branch cycles, malformed-source records and invalid content fail explicitly.

Long readable text is split into lossless continuation items with `entryId`, `partIndex`, `partCount`. The first
part retains the native ID; later part IDs are derived display IDs. `parentId` always names the native parent,
never a continuation. Consumers group by entryId and concatenate in part order; continuation IDs are not native
navigation targets. Tree membership/parent chain comes from native entries, not display row count. All parts and
retained content remain reachable. Native pruned/unavailable facts are shown as native facts, never reconstructed.
Compaction/reset boundaries preserve older retained active history; the fixture folds earlier segments for expansion.

## Fixed budgets

| Resource | Bound |
| --- | ---: |
| Retained native entries / running messages per observation | 20,000 / 20,000 |
| Total scanned records including header/prefix/context | 40,003 |
| Full serialized scan bytes | 320 MiB |
| Single serialized native entry/message/prefix/context | 64 MiB |
| Cooperative scan / complete snapshot construction deadline | 5,000 ms / 5,000 ms |
| Serialized retained storage per snapshot / aggregate cache | 256 MiB / 512 MiB |
| Concurrent snapshots | 2; refuse new snapshots rather than evict readable old pages |
| Display item / text part width | 512 KiB encoded / 32,768 UTF-16 code units |
| Items per history page / full history page including envelope reserve | 128 / 768 KiB |
| Full encoded RPC response ceiling | 1 MiB |
| Retained content objects / base64 content bytes per page | 20,000 / 256 KiB |
| Absolute snapshot TTL, never renewed | 600,000 ms |
| Live notification buffer | 4,096 records / 8 MiB |
| Notifications per poll | 128 |
| Host pending calls / input line / physical response buffer | 32 / 16 KiB / 1 MiB |
| Host request deadline / stderr drain limit | 10,000 ms / 64 KiB |

Counts and serialized byte budgets exclude bounded JS object/array overhead and native source memory. One
synchronous staging snapshot (at most 256 MiB serialized) may coexist with the retained cache, and observation
materialization is bounded by the separate 320 MiB scan budget. Active
scope rows share encoded tree strings; duplicate native image representations share snapshot content storage.
Expiry timers release snapshots even while idle. Closing/expiry clears owned timers. Page checks hash the full
native state (budgeted scan work); this is deliberately stronger than leaf/count or polling since an append ID.
Formal latency/RSS optimization and the specified reference-host P95 matrix remain #60 work, not claimed here.

Checks occur between bounded serialization/scan operations; synchronous native work cannot be preempted halfway
through JSON serialization. A native limit/deadline rejects the whole observation; no partial success/truncation.
A raw native item over 64 MiB fails `history_native_item_bytes`. Large valid text is continued; large native image
bytes are separately paged. Snapshot/cache/scan/item/content/response overlimits and invalid/expired cursors use
stable `history_*` errors. Live eviction produces `history_observation_gap`; reopening is required. The history adapter now uses the shared bounded stdio core and write queue with its own strict generated
command/result/notification policy; only validated command-catalog notifications are ignorable. Host cancellation
rejects pending work, stops and drains/reaps its owned fixture worker, and never replays a request.

## Reproduction

Use Bun 1.4.4, the fixed OMP/DSH pins and an isolated profile. Default `compat:prepare --reset` installs its own frozen
runtime dependencies. This workspace used the verified #30 dependency cache read-only through ignored symlinks:
`vendor/omp/node_modules` and `vendor/omp-runtime` point to that pinned cache. Host dependencies use the read-only #33 cache after verifying its `bun.lock` equals this branch
(the updated lock adds the shared interaction fixture dependencies). No global installation is modified.
For this cache-reuse path, `compat:prepare --reset --source-only` resets only the owned ignored native checkout and
applies every declared patch without touching dependencies. DSH public modules/build inputs use the verified clean
#30 DSH checkout read-only. Bundles and screenshots stay ignored.

```sh
bun scripts/prepare-compatibility.ts --reset --source-only
bun scripts/build-compatibility.ts
bun scripts/build-compatibility.ts --check
bun run check
bun test tests/history
bun test compatibility/omp/fixtures/history-native.test.js
bun test compatibility/omp/fixtures/history-public-rpc.test.js
bun test compatibility/omp/fixtures/history-scale.test.js
bun apps/history-fixture/build.ts
bun apps/history-fixture/main.ts
# In another terminal, while the preceding isolated fixture server runs:
python3 tests/browser/history-browser.py
```

The fixture server chooses a fresh synthetic HOME/profile **before any ordinary native imports**, writes native
synthetic data through the real SessionManager, and communicates exclusively over actual stdio RPC. All child env
is allowlisted. The no-provider preload denies fetch/preconnect, socket/TLS/HTTP/HTTP2/WebSocket/UDP and Bun.connect
network dispatch; synthetic OpenAI metadata and hard-failing model hooks prevent inference. Loopback/stdout Bun socketpairs and native Unix publish locks require the execution environment's local network allowance. This is not permission for provider calls.
`network-audit.json` in the synthetic profile records zero actual dispatches. Stopping the fixture drains its worker
and removes that profile. The main product Host remains private-Session blocked throughout.

Evidence is scoped separately: native manager/data fault tests; actual public native client/schema/server with
public rename mutation; actual Bun history transport with cancellation; labelled DSH Remote contract faults; actual
Linux Chromium→DSH→Bun→native fixture pages. `history-browser.py` explicitly labels its intercepted stale Remote
case. The real native restart case reopens the same persisted synthetic Session and rejects all old-worker cursors.
The 10,000-entry/100 MiB reachability corpus is not the formal 30-sample performance matrix.
