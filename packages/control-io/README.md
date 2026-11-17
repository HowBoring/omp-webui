> Source normalization: this copy belongs to the unregistered H/public-P source tuple. Historical results below apply only to their original artifacts. See [ADR 0026](../../docs/adr/0026-unregistered-supervision-prerequisites.md) and the new tuple evidence; actual composed runtime/global/private admission remains BLOCKED.

# Owned control-socket I/O (source candidate)

See [ADR0020](../../docs/adr/0020-owned-control-socket-io.md). The explicit Host owner now composes this module in source;
production admission and actual composed-helper acceptance remain BLOCKED. The original finite peer and idle read/write/disconnect now have actual public
pointer/socket proofs; broader runtime acceptance remains outstanding.

The main-thread-only `loadOwnedControlIo({ selection, approval })` entrypoint loads an independently approved ABI1
library from a selected release. Retain the selected maintenance lease until `await module.close()` succeeds.
`module.openControl(fd)` implements the public `ControlSocket`; success transfers exclusive socket ownership, failure
leaves caller ownership. `destroy()` is idempotent; inspect `socket.failure` for bounded close uncertainty. Never close
the raw fd after successful adoption. No other wrapper or asynchronous filesystem call may use the socket.

`module.close()` refuses while any module has handles or callback/poll activity. Await it after terminal callbacks
return. After disposal begins, that module cannot adopt another fd, including after disposal failure. Errors and
transport close are not helper/descendant drainage receipts. A failed shutdown remains unresolved.
If loading itself rejects with `CONTROL_IO_DISPOSAL_UNCERTAIN`, retain the selection lease as well: native unloading
could not be confirmed. Neither path permits a disposal retry against the
uncertain native library. The loader keeps strong references to the library, all pinned members and the selection;
this prevents finalizers from silently dropping protection, and does not replace the caller's duty to retain its lease.

`createOwnedControlIo(system, scheduler)` is the controlled synchronous OS/scheduling seam used by pure tests and the
approved loader. It does not authenticate custom system adapters or replace production approval. It performs no FFI
or import-time I/O. `createOwnedControlIoLoader(system)` likewise supplies a controlled filesystem/native-loading
boundary for the public load/close/maintenance tests; it never authenticates a custom adapter. Each controlled loader
has its own simulated lifetime. Production uses only the singleton `loadOwnedControlIo`, with its process reservation,
real pinning and public FFI implementation. The production scheduler retries at 5ms with bounded work per turn.

The source-only builder is `scripts/build-control-io.ts`. Use a fresh unenrolled release, never an approved release.
It requires the existing independently pinned delivery maintenance control. Builder output is not approval. Include
the library, exact source/header and actual libc/loader dependencies in the final exhaustive release inventory and
independently approve that tuple. No enrollment helper or production approval record is generated here.

Opt-in OS cases are `tests/supervision/owned-control-kernel.test.ts`. The existing retaining parent has
separate `control-io-roundtrip` / `control-io-idle` selectors. Each requires its own explicit Root runtime clearance and an
outside-release `OMP_CONTROL_IO_APPROVAL` JSON record conforming to that test's strict schema. Roundtrip requires the
original retained finite child binary SHA256 `5f754c6e77c7eb52eec5a9dd89315eb4d0ed4d60bd51dde67924ac567aa63bd8`;
idle requires the independently reviewed finite `control-idle-peer.c` build. Neither selector starts a Native worker,
helper, listener or service. Compile-only evidence cannot substitute for running either case with actual permissions,
retaining its original tool handle, and recording the independent parent's eventual P_ALL/ECHILD.

The approved loader reserves one native-library lifetime per process, including loading and disposal. A concurrent
load is `CONTROL_IO_BUSY`; uncertain disposal retains that reservation. Reuse the loaded module for up to 64 sockets.

Pinned Bun1.4.4 rejects the original full six-symbol descriptor using `FFIType.buffer`20 with `invalid ABI type`.
The exact same approved binary and six signatures using public `FFIType.ptr`12 returned ABI1/live0 and closed safely;
see [the retained paired proof](../../docs/evidence/ticket-41-owned-control-io-abi-pair.md). The loader therefore uses
public `ptr(view)` for each C pointer argument. A library-owned set strongly retains every actual typed-array view
through the synchronous call, preserving its byte offset and existing byte length. Raw pointers do not escape the
adapter and C retains none. C/header/binary/ABI1/wire and the array-facing `ControlIoNativeLibrary` seam are unchanged.
The paired proof called no pointer-argument function. The subsequent
[original-peer roundtrip](../../docs/evidence/ticket-41-owned-control-io-ptr-roundtrip.md) passed through the actual
production pointer binding: 22 read/11 written bytes, peer0, safe disposal return and independent P_ALL/ECHILD.
The separately reviewed [idle proof](../../docs/evidence/ticket-41-owned-control-io-ptr-idle.md) also passed:
20 read/5 written bytes, parent disconnect, peer-observed EOF/exit0, awaited disposal and independent P_ALL/ECHILD.
Both single-use stages are consumed and cannot be rerun. Their bounded own maps/pins observations are not complete
mapping/dependency/unload proof. Actual production-adapter acceptance and private/global/fault/process gates remain outstanding.


The public entry is `index.ts` in source and the published package `@omp-webui/control-io` `.` export (`index.js` /
`index.d.ts`). Host consumes this entry; a future Native main-dispatcher adapter can consume the same exported
`ControlIoSelection` without Host internals. It carries immutable selected release root/independently authenticated
manifest identity, complete inventory/platform closure and exhaustive `verify` with retained maintenance protection.
Host supplies a frozen adapter from `InspectedSelection`; release only after awaited safe disposal. The contract
requires independently approved finalized bytes, not self-enrollment. Public export excludes controlled test factories.

`buildControlIo` also emits `control-io/index.js`, five declarations and package metadata, plus exact public source,
build script, root package/lock and compiler-setting provenance. All publication remains under its existing fresh
unenrolled-release/exclusive-destination/maintenance gates. It does not install or publish to npm. The internal public
source-staging helper only compiles staged JS/types; it supplies no approval or release publication authority.
Two clean source builds and an independent consumer typecheck are recorded in the source evidence. The actual
public-module tuple still needs exhaustive inventory, outside approval and runtime proof. A socket's uncertain close
makes module close reject permanently while keeping the library/pins/selection retained; never retry its numeric fd.
