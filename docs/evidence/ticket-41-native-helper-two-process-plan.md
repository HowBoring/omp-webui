# Two-process Native/helper proof — SOURCE HOLD

**HOLD: production Host and Native cannot inspect the same required platform closure.** This is a prerequisite
plan, not a source-ready fixture. Actual proof, producer/retainer execution and staging remain NOT RUN. Small
candidate sources are archived outside this worktree at
`/workspace/work/mvp-implementation/research/restore8-41-helper-two-process-hold/drafts`; they are non-ready research.
The archive holds ten text source files (47,650 bytes); its `manifest.json` SHA-256 is
`4ab9e446c7a7a009586cb9ec3a3c24cc0b9b6083e6970c139c2cf4ccc5d38338`.

Base: clean Host `45800660ad9138865a1fef265b89bcf1a149eddc`. Preparation only; actual proof NOT RUN.
The reviewed inactive Native tree remains `8ef8e13ed337a70c15cdc7ff8d799fe99f2a9911`, patch SHA-256
`d243a44147da99e00306884ff5094f224aacd059f25ec17648074bd9d2e61eba`. No Native/index/export change is needed.

## Existing production seams

`OwnershipClient.prepareHelper` and `helperStatus` already use the nonce/request-bound signed public UDS
transport. `OwnershipDispatcher` binds prepare to its actual external controller `StablePeer`; REGISTER
adds the original helper peer/session. `LinuxOwnershipSystem.ready/classify/protectHelper` implement
that narrow Linux path. Its broker/publish methods and ordinary dispatcher entry still refuse with
`ownership_backend_unavailable`. Those refusals do not prevent an explicitly approved helper-only fixture.
There is no additional public control-I/O prepare method to invent: Native loads the nominal public module,
while Host's existing `createPrivateHelperOwner` invokes the supplied production prepare callback before spawn.

The Host public adapter is an external source input at
`/workspace/work/omp-webui-ticket-41-controlio-public-adapter`. Its existing nominal fixture uses a mechanical
dispatcher and synthetic prepare callback. Neither supplies authority here. Reuse its actual adapter, C helper,
finite `identity` worker and public JS/library shape, with independently pinned input hashes.

## Blocking production inspection/selection gap

Native paths below are relative to `vendor/omp-ownership/packages/coding-agent/src/launch/ownership/`.
`release-inventory.ts:141` requires the selected inventory to be exactly `<releaseRoot>/release.json`.
Its `verify()` calls `verifyOwnershipPlatformClosure` over every ELF member and recursively reached platform library.
`platform-closure.ts:93–123,126–154` requires each encountered interpreter alias to be signed, including the reviewed
Linux `/lib64` and `/usr/lib64/ld-linux-x86-64.so.2` aliases. The pinned nominal public library and bridge's libc closure
reaches libc's interpreter. Removing alias entries fails Native's exact closure verification; unused dependencies fail too.

Host `packages/delivery/coordinator.ts:20` calls the production `inspectRelease` through `resolveGlobalSelection`.
In both this tree and the public-adapter source input, `packages/delivery/artifact.ts:124–127` requires
`realpath(entry.path) === entry.path` for **every** platform dependency. It rejects those signed aliases before
`createPrivateHelperOwner` can load its public module or invoke production prepare. `ControlReleaseMember` in the public
package permits `file | directory | link`; Host's `AssetIdentity` likewise permits links, but these existing real
verification algorithms differ. Nominal declaration compatibility does not make their runtime contracts compatible.

Both inspections fix the name to `release.json`, and Native excludes only that name from its exhaustive inventory.
A sidecar is not selectable by either fixed-name inspector and remains an ordinary inventoried file. Separating
the helper paths fails Native's exact approved `/proc/<original-peer>/exe`
path check; aliasing Host's helper path fails `packages/supervision/adapter.ts:verifyMember` canonical-path verification.
These are source deductions, not newly executed ELF, helper, kernel or FFI evidence.

This missing compatible production **inspection/selection** path is distinct from the existing Native prepare/status
backend. Do not replace actual inspection with a fabricated `InspectedSelection.verify` callback, reuse mechanical
prepare/ACK, remove Native's signed aliases or silently change production APIs inside this fixture task.

The next production prerequisite needs fresh unified Host/Native platform-alias contract exploration and a separately
reviewed implementation. Possible directions are bounded signed alias verification in Host's real inspector, or a real
Host selection adapter that retains its own original maintenance lease and delegates to an equally complete authenticated
inventory verifier. Neither direction is implemented or approved here. Preserve exact alias target/mode/ancestor identity,
change/substitution checks, exhaustive platform closure, the actual helper executable path/hash and independent disposal.
Verify through public inspection/selection seams: legitimate required aliases, changed/indirect/unsigned aliases, replaced
ancestors/files, failures during verification and maintenance-lease retention. No same-UID callback supplies authority.

Revisit the candidate fixture only after that production prerequisite and fresh paired review. No production algorithm,
public API, canonical-platform policy or ordinary-entry/backend implementation changed in this pass.

## Exact fixture gaps

1. The historical signed probe is v3/anchor2 and helper-free. A separate strict v4/anchor3 bootstrap must
   authenticate each complete outer launch closure before either process imports its Native/Host-bearing graph.
   Preserve the historical proof and never promote consumed stageB keys, runtime or READY records.
2. Two separate product processes need coordination through their original parent-owned stdin/stdout handles.
   Host must retain its original signed client and actual helper handle. HELLO PID/start hints are correlation
   only; actual Native status and original C peer/session remain authority.
3. Hold Host's `registerHeldHelper` callback after signed `registered` status and HELLO correlation, before START.
   Parent asks Native to close; Native invokes `server.close()` and reports that admission drainage began.
   Only then may parent release Host's callback. The finite worker starts, exits, and trusted C sends COMPLETE.
   Native must keep the original registered connection and every COMPLETE ACK continuation polling during close.
4. Native independently awaits terminal peer exit, authenticated held-directory absence/fsync/recheck and local
   callback/output quiescence before public-module/selection close. Host independently awaits matched COMPLETE,
   clean decoded control EOF/tail, original helper exit0 and both output readers before owner/module/lease close.
   Neither process may convert the other's event or a fixture callback into its own terminal authority.
5. One fresh reviewed build input must generate helper constants, helper source/header/build provenance and
   signed helper-fence fields. The helper binary hash must match both approvals. Do not sign an old helper
   configured for a different endpoint/control/fence directory, or claim hashing decodes its constants.
6. The existing one-process retainer cannot establish two-process closure. The archived candidate original-handle retainer
   needs original `Popen` handles, captured pidfds, bounded stdout/stderr readers, subreaper ownership and
   authoritative final `waitid(P_ALL)` ECHILD. No PID discovery, kill groups, hints or deadline-as-success.

## Source slices and verification

The agreed pure seam is the new fixture's Host coordination gate: refusal on mismatched HELLO/generation or
nonregistered signed status; START callback remains pending until the original parent releases it. Use fake
external client/parent boundaries only. Production client/dispatcher/peer authority is never mocked into actual proof.
The archived candidate adds separate Native and Host entries and a build-only unsigned producer; its real Host
inspection hits the blocker above. A ready producer must pin bounded source
inputs and public artifact fingerprints, emits no private key bytes, creates no keys/approval, never runs emitted
code, and has no runtime-copy operation. Root owns future fresh keys, disk reclamation and exact staging.

Prototype checks: RED missing gate module; GREEN 3 tests/9 assertions under the preimport guard and env-i synthetic
HOME/profile/cwd; strict types for 54 files; build-only bootstrap/Native/Host/producer graphs. Bootstrap, Native and
producer have zero eager FFI imports. Host's maintenance graph is imported only after outer launch authentication.
Emitted bundles remained in memory and were never executed. Strict checks caught and corrected a possibly undefined
tuple element and an unsupported `Bun.build` option. These checks prove no compatible production selection or runtime
authority. No C changed or C compile ran; the reviewed 109/971, strict53/C/build results remain historical and were not
rerun. No Python/retainer source was imported or executed. Exact draft source hashes and bounded check notes accompany
the archive; no binary, private key, operator record, runtime or dependency tree was archived.

Allowed future checks are pure fake tests under the existing preimport guard, strict types, strict C compile without load,
and build/AST checks without emitted execution. No actual Native/helper, FFI, library, socket, kernel probe, CLI/SDK/
Agent, serializer, listener, signature-key operation or operator record is authorized by this source pass.

## Lifecycle preflight and remaining wait domains

Before a later single run, Root must review exact source/input hashes, fresh independent keys/anchor3/approval4/domain4,
both launch inventories and all final component bytes, one canonical runtime, platform closure, trusted C capabilities,
held maintenance control, empty known fence directories, bounded resource budgets and the exact retainer manifest.
The approximately 75 MB available at source-plan time cannot accommodate a fresh 107 MB Bun; Root must reclaim
artifacts before future materialization. This pass copies no runtime, compiler, Python, ELF or dependency tree.

Unmatched prepare/lost reply; uncertain REGISTER; wrong controller/peer/session; helper alive; missing trusted COMPLETE;
partial/lost ACK; output backpressure; control EOF/tail errors; original helper wait rejection/nonzero; pidfd errors;
fence present/replaced/unknown; fsync/close failure; pending callbacks; surviving scopes/protectors; and uncertain module
or lease close each retain their owning domain. Deadlines report unresolved state and retain original ownership.

Fault matrix required before broader claims: v3/v4 rejection, lost prepare reply, status rejection, wrong peer/session,
close-before-REGISTER, close-after-REGISTER/before-START, COMPLETE while alive, EOF/exit without COMPLETE, partial/lost ACK,
Host control backpressure/delivery failure, helper exit75, pinned fence replacement/fsync error, callbacks/scopes outstanding,
and module/lease close failure. The first future nominal proof covers only the explicit nominal row; other rows stay NOT RUN.

After fresh paired source review, stop for Root's exact-stage review and ONE separately authorized runtime gate.
Whole #41/MVP, backend/ordinary entry, 7–9 or full 1–10 composition, global selection and private Session admission remain BLOCKED.
