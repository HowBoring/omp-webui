# Native public control-I/O generation owner

Status: **source-only, inactive0010, awaiting fresh Standards and Spec reviews**. Actual signed Native composition,
new argv handoff, global target and private admission remain **NOT RUN / BLOCKED**. This closes no #29/#41/#61 story.

The Native server now consumes the real public package's JS entry and types. Complete nominal v3 selection verification
and the inherited process guard precede dynamic import of the signed canonical `controlIo.package.entry.file`.
Verification repeats after import and public load, before bridge loading/listening and around asynchronous preparation.
Only the public `ControlIoError` and `loadOwnedControlIo` exports are consumed. There is no caller-supplied production
loader, uninstalled bare runtime lookup, Host owner import, copied public socket/pointer/poll implementation or fake
release approval. The internal pure lifecycle seam grants no production authority. The normal dispatcher entry and
broker backend remain unavailable; no consumer or global autoload expansion occurs.

The dynamic import is the narrow chosen exception to Native's general static-import convention: the public file's
canonical path and every byte/platform dependency are authenticated before execution. Types map to the same immutable
nominal artifact's `index.d.ts`, with JS, package.json and all five declarations pinned before/after source checks.
The public JS is `868251d0086139ca00b3e85fcf8401da2a445f3f4b77b4b5c8d5422946fd9cef`.
The independent [public-adapter nominal proof](../../../omp-webui-ticket-41-controlio-public-adapter/docs/evidence/ticket-41-public-adapter-nominal.md)
at `a259d6c` remains its mechanical fake-ACK SYSTEM case, not signed Native integration.

The singleton strongly retains the selection, namespace, module and failed load, including no returned module or
uncertain disposal. The bridge additionally requires that exact successfully loaded public owner. Build checking
caught Bun hoisting the former static `bun:ffi` import before the public load; it now imports FFI dynamically inside
guarded bridge loading. An AST rule rejects eager FFI imports in emitted builds and rejects server/public-loader/FFI
imports in the 11-module ownership client/worker graph. Unchanged catalog/consumer sources are outside that graph;
no claim of rebuilt generated catalog or final full CLI graph is made.

Prepare awaits readiness and rechecks current/shutdown state immediately before consuming a helper generation. It
creates no invented control FD API. Close stops admission/polling, drops connection output, and awaits queued responses,
appended uncertainty work and in-flight verification before disposal. Concurrent close shares one result; only proven
pre-disposal busy/drain refusal can be retried. Unknown socket, library or cleanup lifetime remains retained.

Native lacks the Host's original helper wait handle. Therefore **any committed prepare** conservatively prevents clean
generation disposal, even after trusted COMPLETE and clean EOF. Shutdown preserves unresolved peers and incomplete
fences, and never clears them as recovery. Only a generation with no committed prepare, no scopes/fences/uncertainty,
settled callbacks and disposed bridge/fence descriptors can await public module close and then release its selection.
Generation release never closes or unlocks the process-owned C descriptor. A future reviewed owning-side drain contract
is required to relax this intentional retention policy.

Validation: **76 pure tests / 328 assertions / 0 failures**, **45 files strictly checked with pinned `bun check`**, and a
**71,089-byte build-only server bundle** with zero eager FFI imports. Public-interface tests cover missing module, import
drift, load reentry, readiness before load, concurrent close, pending verification, stale preparation, sticky drift,
busy/uncertain disposal and helper drain refusal. Signed selection/inventory/platform negatives remain green. The
[check record](ticket-41-native-control-owner-checks.json), [TDD record](ticket-41-native-control-owner-tdd.json) and
[structured evidence](ticket-41-native-control-owner.json) preserve exact results and limits. A pending-promise matcher
initially blocked the pure harness; its owned tool was interrupted, bounded retries timed out, and the corrected
harness then produced a meaningful RED/GREEN readiness-race assertion. No Native or OS fixture began.

All 126 original changed Native files, HEAD, index and staged/working diffs were preserved before edits. Native HEAD,
index and staged bytes remain exact; 118 original files remain byte-identical. Exactly 11 intended source/doc/test
paths differ, including three new files. Before the single final export, the changed authoring files were preserved
again. Private-index replay reconstructed the old `4dc7455f…` tree and `78656e73…` patch byte-for-byte, then reapplied the
new patch to its exact tree. Final inactive tree is `e68927bf88110913b1bc7902293454eb194823af`, patch SHA256
`c745997759036212c3ae631741b3158cde37ee9cd8b9b2a55f950e3947919cd2`, source tuple
`74d1b9d43be6e2d365880b47778a0e4b44adaf82cd136558e30907cba54ef783`.
[Export metadata](ticket-41-native-control-owner-export.json) names the complete preservation location. Active patches,
consumer delta, patches7–9, final1–10 composition, historical evidence, orphan444480 and all old fences remain untouched.
No Native CLI/SDK/Agent/Host, FFI/library/listener/browser/kernel fixture ran, and no production approval/key/global
selection was created. Actual new C argv proof belongs to Root's separate fixture; historical C581a evidence is not
promoted. Fresh two-axis reviews and a new exact Root runtime window are still required before any actual Native test.

The restore7 finisher independently checked the preserved authoring files, original HEAD/index/staged bytes, all
evidence digests and the actual public artifact bytes, then replayed the existing export in a private index. Its
[provenance record](ticket-41-native-control-owner-finish.json) confirms the same final tree and patch, the unchanged
`4660a3ca…` launcher C and bridge C sources, and the untouched active selection/consumer delta. The existing final
export was retained; no source tests, type checks, build or runtime fixture were repeated during this handoff.
