> Historical source direction imported from public P. This distinct filename does not replace integration ADR 0020 (tree preview). Its recorded runtime proofs do not cover this new tuple. [ADR 0026](0026-unregistered-supervision-prerequisites.md) governs the normalization scope.

# ADR 0020: Main-thread owned control-socket byte I/O

- Status: Accepted source direction; source candidate only, OS/runtime/private/global admission NOT PROVEN
- Date: 2026-11-16
- Tickets: #41 supporting component, #48 lifecycle, #61 final closure

The pinned Bun 1.4.4 extra `socket-fd` endpoint is caller-owned. The unchanged finite C child received no JS
reply through the existing `node:net.Socket` constructor path (proper network permission, child exit26, 0 JS bytes).
The same child/binary exchanged exactly 22 read/11 written bytes through public asynchronous `node:fs` (child0,
independent retaining-parent P_ALL/ECHILD). These original evidence records remain unchanged. They do not diagnose
private HELLO. The raw filesystem diagnostic cannot safely cancel an idle callback read or close concurrently with
outstanding I/O. No documented installed public Bun alternative established the required shared-socket guarantees.

Root therefore explicitly amends the internal architecture choice that excluded Host control-I/O FFI. A separate
small C module may perform **only main-thread, caller-owned socket byte I/O** through public `bun:ffi`. This does
not alter ADR0001's public RPC-only Agent boundary or ADR0004's transport responsibility. The ownership/process/
ancestry FFI restriction in ADR0018 remains dispatcher-server-only; no worker realm loads either native module.
No Agent SDK, listener, dispatcher proxy, process identity, signal, ancestry, process discovery, thread, fork/exec,
lease/admission authority or new control wire belongs in this module. Native0010 and the helper/controller policies
are unchanged. The production adapter is deliberately unwired pending independent review and actual finite proofs.

`compatibility/control-io/owned-control-io.h` defines ABI1. Adoption validates the supplied fd's socket type and
AF_UNIX/SOCK_STREAM address, rejects a currently adopted duplicate, and transfers sole caller ownership only on
success. The caller must already exclusively own the descriptor; this module cannot establish its Bun provenance.
Failure leaves the caller responsible for close. Sixty-four slots use monotonically advancing generation handles;
exhausted generations retire instead of wrapping. Handles belong to one loaded-library lifetime, never durable state.
No socket is duplicated. Synchronous `recv(MSG_DONTWAIT)` and `send(MSG_DONTWAIT|MSG_NOSIGNAL)` borrow a buffer for
that call only, without changing descriptor flags or retaining JS pointers. Close invalidates the handle **before
one attempt**; EINTR/error is `CONTROL_IO_CLOSE_UNCERTAIN`, never a numeric-fd retry or an extinction receipt.

`packages/control-io/socket.ts` implements the existing `PrivateHelperSocket` interface over this OS seam. Limits
are 64 process handles, 512-byte reads/outgoing frames, 16 queued writes/8KiB, and 64 syscalls/16KiB per scheduled
turn. A 5ms timer retries would-block/EINTR; partial writes stay ordered and own a byte copy. At most 512 input bytes
are held by this adapter; the unchanged controller owns bounded protocol decoding. Data tail precedes EOF/end/close.
Disconnect cancels scheduling, invalidates/closes synchronously with no outstanding syscall and rejects writes once.
Every callback/poll turn participates in a process-wide activity guard, including reentrant destruction and callbacks
on the final closed socket. Library close refuses active handles/callbacks/turns. Beginning library disposal prevents
new adoption even when disposal fails. Transport termination never proves helper reap, descendant extinction, server
ACK, settlement or policy completion; those remain the existing controllers' responsibilities.

`loadOwnedControlIo({ selection, approval })` requires an independently provided binary/C/header digest and ABI1,
matching selected exhaustive release entries and a declared libc platform dependency. It refuses workers and unsupported
platform/runtime **before importing FFI**. It verifies the selection, pins ordinary O_NOFOLLOW file descriptors,
hashes their exact bytes and checks inode/path/size/timestamps before and after loading through its own Linux
`/proc/self/fd/N`. The pinned descriptors live until safe library disposal. The caller must retain the independently
acquired selected maintenance lease throughout this lifetime. This is cooperative maintenance protection, not defense
against hostile same-UID writes. The loader never derives approval from its own checksum or enrolls a release.
Errors expose bounded codes/errno, with no raw causes or paths. Import and controlled tests do not load a library.

The cohesive operator builder uses existing delivery maintenance and inventory conventions. It builds only into a
fresh unenrolled release, refuses existing destinations and `release.json`, stages the exact C/header compiled into
provenance and publishes with exclusive copies. It never installs globally or approves its output. Final enrollment
must include `lib/libomp-control-io.so`, both provenance members, Host loader/adapter bytes, ABI and actual libc/loader
platform closure. Actual Bun/native mappings, dependency resolution and maintenance lifetime remain mandatory OS
gates; naming libc in a manifest is not proof of its loaded identity. The unmerged external supervisor framework is
not copied here; later composition may share stable release-path validation without merging policies.

The first source evidence is strict shared C compilation, Host types and controlled OS/scheduler/filesystem tests.
A genuine controlled RED exposed cross-module unloading during another module's terminal callback; the process-wide
activity guard makes it GREEN. This is not C/kernel evidence. Separately staged opt-in roundtrip and idle-read/write/
disconnect tracers use an outside-release independently supplied fixture approval and the existing retaining Python
parent. Both now have the retained actual finite proofs below, after separate Root reviews and network-enabled
runtime windows; both single-use stages are consumed.
The original C child/source/binary and Socket/raw evidence are preserved. Real C stale-handle/fd reuse, adoption/close
faults, process budget, partial sends/backpressure, worker refusal, process death/EOF and fence scenarios remain later
gates, followed by the approved-module-only adapter migration and actual private HELLO/Native/global integration.
There is no owner-selected actual global target. All old orphan/fence/operator restrictions remain unchanged. Linux
is current scope; the owner deferred actual Windows acceptance.

The approved loader reserves one native-library lifetime per process, including loading and disposal. A concurrent
load is `CONTROL_IO_BUSY`; uncertain disposal retains that reservation. Reuse the loaded module for up to 64 sockets.
Reservation state strongly retains the native library, pinned descriptors and selected lease; a boolean alone cannot
prevent finalizer release.
Uncertain library unload never closes the pins. Failed-load cleanup reports `CONTROL_IO_DISPOSAL_UNCERTAIN` when
native unload throws, so a caller must retain its selection even though loading returned no module. The staged
selection-lifetime helper releases only after safe failed-load cleanup or successful module disposal. Controlled
filesystem/native-loader tests cover these public load/close/maintenance failure paths without loading FFI.

A retained exact Bun1.4.4 paired descriptor probe now establishes that the complete six-symbol `FFIType.buffer`20
shape is unsupported (`invalid ABI type`), while identical signatures using public `FFIType.ptr`12 return ABI1/live0
and permit safe unload with the approved binary/pins/selection lease. See the retained ABI-pair evidence. The loader
uses public `ptr(view)` conversions behind its unchanged typed-array interface, strongly rooting all actual views in
a library-owned set until each synchronous call returns. This preserves view offsets/lengths, prevents raw-pointer
escape and retains the C no-retained-pointer rule. No private runtime API is involved. C/header/binary/ABI/wire are
unchanged. The descriptor probe invoked no pointer-argument function or socket operation; the subsequent original finite-peer roundtrip established actual marshaling for this one exchange.
Production admission stays unwired and unproven.

The retained [pointer roundtrip proof](../evidence/ticket-41-owned-control-io-ptr-roundtrip.md) records actual
1 PASS/8 assertions, 22 read/11 written bytes, original C peer0, awaited module close then selection release,
Bun CLD_EXITED0 and independent retainer P_ALL/ECHILD. All159 posthashes matched before evidence edits.
Bounded own mappings/pin snapshots show the library/libc/loader and maintenance lease before disposal; they
are not complete dependency provenance or unload proof. The stage is USED_ONCE_PASS_DRAINED, never reusable.
The separately reviewed [idle proof](../evidence/ticket-41-owned-control-io-ptr-idle.md) records actual1PASS/8assertions,
20 read/5 written bytes, parent destroy and peer-observed EOF/exit0, awaited close/release, Bun CLD_EXITED0 and
independent retainer P_ALL/ECHILD. All181 posthashes matched before documentation updates. Peer EOF follows from
the unchanged peer source and actual exit0, without syscall tracing or a measured25ms-delay assertion. The two
own map/pin observations retain the same limits as the finite proof. Product loader/C/header/library remain
unchanged; production adapter remains unwired. Fault/backpressure/process/fence/mapping and private/global
admission gates remain outstanding.

## Public module and retained Host composition (2026-11-17, source only)

The authoritative byte-I/O implementation now owns `ControlSocket` and exposes `packages/control-io/index.ts`.
It has no delivery/supervision dependency. `ControlIoSelection` is a documented immutable selected release,
independently authenticated exhaustive manifest identity/inventory/platform closure, and retained maintenance
verification/release contract. Its `verify` must recheck maintenance before/after the complete inventory. Host's
`selectedControlIo(InspectedSelection)` freezes a snapshot while delegating the original exhaustive verification
and maintenance protection. This is an adapter, not weaker path/checksum approval. ABI/binary/C/header approval
still comes independently; native pinning, public pointer binding and the singleton loader reservation are retained.

The dedicated package is `@omp-webui/control-io`, with only `.` exported as ESM `index.js` and `index.d.ts`.
No import loads FFI. Controlled factories remain non-authorizing, explicitly in source `testing.ts`, excluded from
package exports/publication. The existing fresh-release builder now stages exact public implementation/build inputs,
Bun1.4.4/TypeScript6.0.3 settings and package/lock provenance, emits JS plus declarations and publishes exclusively
under the same outside maintenance update lease and pre/post unenrolled/destination checks. It neither installs,
enrolls nor independently approves bytes. Exhaustive release inventory must include the public JS/types/package,
all provenance, Host adapter/controller bytes and actual libc/loader closure before external approval. Source-only
public staging compiles JavaScript/types without acquiring maintenance or loading any native module.

Host production construction is `createPrivateHelperOwner({selection, controlIoApproval})`. It loads/validates the
real singleton public module before returning an owner, so no helper preparation or spawn can precede approval.
`owner.launch` verifies the selected helper and preserves the authenticated prepare/register callbacks before START.
Concurrent handles reuse that module. Post-spawn startup failure returns an owning handle; the owner strongly retains
all handles, selected lease and module even if the caller drops its reference. `owner.close` stops launches and awaits
all matched COMPLETE + fully decoded clean EOF + successful original helper reap, then awaited module disposal and
selection release. Completion itself never unloads. Pending preparation refuses close as busy; all uncertain
startup/controller/socket/library disposal retains protection. Repeated owner creation cannot release an active
owner's selection. Loader-busy/uncertain failed creation retains its supplied protection without a returned owner.
A rejected close is sticky. Raw-fd close is invalidated before exactly one attempt after failed adoption; transferred
sockets are never closed again by numeric fd. A socket's uncertain close now also prevents module disposal.

Only the accepted external branch's clean-EOF TypeScript correction/tests were carried from
`5608b676..1693d9e`. Private helper C, candidate/header, control wire, IO C/header and pointer code remain exactly the
IO baseline. The full external merge is a later distinct source/approval tuple, not implicitly included here.
Native0010 authoring, approval schema and preparation remain untouched. Its future main-dispatcher adapter must
supply this same public selection contract from independently authenticated signed finalized inventory and retained
maintenance protection, and separately provide ABI1/binary/C/header approval before acknowledging preparation.
Existing `{file,sha256}` control-IO approval cannot satisfy it. `prepareHelper` still exposes no fd and never becomes
a socket-byte API; existing opaque peer/listener ownership stays unchanged. Workers never import/load FFI.

The ancestor finite/idle proofs remain scoped to their original artifacts. This new source composition is NOT an
actual helper/Native/global proof. Its fresh two-axis review and separately authorized nominal production-adapter
window remain mandatory, followed by the outstanding fault/backpressure/platform/mapping/private/global gates.
See [source evidence and next contract](../evidence/ticket-41-controlio-public-adapter-source.md).
