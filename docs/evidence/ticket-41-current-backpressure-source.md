# #41 current-C external backpressure source candidate

SOURCE READY, runtime NOT RUN; fresh paired Source review and a separate Root unsigned-artifact review are required.
This component does not close [#41](https://github.com/HowBoring/omp-webui/issues/41) or
[#29](https://github.com/HowBoring/omp-webui/issues/29). Product/private Session admission remains BLOCKED.

The base is `602f4988c7e09b8d3d7d708b07fc36e4516b560a`, tree
`c817c96c5a003fbd4347a3957774a4e39a8e6273`. Production C and headers remain byte-for-byte at that base;
the adjacent JSON records their commits, blobs and SHA256 plus every new fixture source hash.
R16 proves its private nominal two-process fixture only; its fault matrix remains NOT RUN.
Historical `07edf62e7cbe634a7748d7f791f4650ce546ef3c` records PASS_DRAINED for its own older external tuple.
Neither is current-C backpressure evidence. The obsolete `external-write-fault.py` remains untouched and must
never be invoked or imported: it compiles at runtime and has unsafe cleanup.

The new adapter has exactly one case: actual current-C external fd3 backpressure followed by normal drainage.
The fixed broker accepts only `__omp_worker_daemon_broker`, reads one `X`, exits0, emits nothing and creates
no descendants. The fake dispatcher uses the existing external JSON protocol, validates exact operation,
installation, generation and distinct64-hex request IDs, and holds completion ACK after exact
`ROOT_EXIT <generation> 0 0`. These fake ACKs do not authenticate Native, ancestry, approval or publication.

The new files separate inert policy, proposed runtime boundaries, runtime entry and Root-only preparation/sealing.
No preparation command runs a compiler. Root must compile in a separate compiler-only session, then seal and
independently inspect the unsigned artifacts. Runtime never compiles, imports Native, loads FFI, scans proc,
discovers candidates, forks a cleanup process, signals numeric PIDs, targets groups or clears failed fences.
The original Popen object is retained before `__init__`; the original pidfd is captured immediately after a
successful constructor, and both bounded output readers are owned before launch. Constructor ambiguity,
pidfd failure, interrupt, observer error, late/unclean EOF, journal failure, reporter failure and clock failure
retain all original live owners in HOLD. Redundant parent-only write ends close only after successful original
binding. The fixture duplicate closes only at normal drainage or after the original guardian has actually reaped
in manual recovery. There is no disposal/finally cleanup path.

Root authorizes the exact manifest once with the outer command. `used-once.jsonl` uses O_EXCL, and its file
and directory are fsynced before the controller constructor. The controller must receive an original inherited
bootstrap pipe message from that outer parent, then creates its own O_EXCL journal. Before START, it emits
the original guardian PID, held pidfd number and device/inode, generation, marker and fresh challenge.
Root must send the exact emitted `ROOT_START_ORIGINAL ...` command on original stdin. The same held pidfd
identity and direct-child waitability are checked again before durable START intent. This is fixture scope,
not Native authentication. Waiting for the first Root byte retains owners without a business deadline;
once a command begins it has one absolute5s/512-byte budget. No recovery challenge exists before failure.

The duplicate writes4096-byte `!` chunks to the actual guardian fd3 send queue, with one absolute5s budget,
until actual EAGAIN. Filling must be positive and strictly below1MiB. After durable ACK-release intent, the
adapter releases the held ACK, observes the same live waitable guardian, own incomplete fence and denied
exclusive maintenance lock for at least250ms, then closes the duplicate. Exact filler, exact COMPLETE,
clean EOF, original guardian Popen wait0, both original reader EOFs and controller P_ALL/ECHILD share one
absolute5s completion budget. Fence absence and exclusive lock availability are required before normal PASS.
The outer retains its original controller Popen/pidfd/readers, requires original wait0 and reader EOFs and its
own P_ALL/ECHILD before outer PASS. Successful actual receipts must include pre/post input hashes, config
and compiler identities, raw frames/ACKs, errno/filler count, protection observations and every original tool
output through EOF. Root must independently collect pre/post hashes and compare to the sealed manifest.

The outer20s budget is explicitly sampled from its first observation of the durable business-start marker,
not a hard wall or a termination mechanism. It checks expiry before terminal/ECHILD acceptance. Crossing
the budget marks normal PASS ineligible; observation continues holding originals. Only genuine original
wait, readers EOF and ECHILD within a fresh bounded observation window can produce
`LATE_OR_MANUAL_DRAINED_NOT_PASS`. A failed clock/readiness/journal observation cannot infer termination
and enters HOLD. No timeout alone drops owners or releases protection.

## Finite failure and manual recovery policy

Every operation has a finite attempt budget. HOLD itself intentionally has no automatic expiry: dropping
owners while termination is unproven would be unsafe. Reporting, JSON serialization, waits and interrupts
cannot escape the retention loop. Root must preserve the original tool session and its owner processes.

Manual recovery is eligible only after all of: the original guardian Popen and original pidfd were bound;
exact START/running was received; the fixed synthetic broker was naturally reaped as exact ROOT_EXIT0;
the controller has failed; the original guardian is still live/waitable; the own incomplete fence and denied
exclusive maintenance lock still match. Before START, unknown construction, unknown root status, missing
pidfd, changed identity, failed journal, missing fence, unknown lease or an already attempted recovery all
mean HOLD with no signal, lookup or reconstruction. Ineligible phases have no executable recovery proposal.

On an eligible retained failure only, the adapter mints and durably records a fresh challenge and emits an
exact `ROOT_KILL_ONLY_ORIGINAL <original-pid> <pidfd-device> <pidfd-inode> <challenge>` command. Root must
explicitly send this fresh command after inspecting the failure and original-handle proof. A durable signal
intent precedes one SIGKILL syscall through that original pidfd. External TERM is intentionally ignored,
so no TERM attempt, retry or guessed escalation exists. An uncertain signal/journal outcome consumes the
attempt and stays HOLD. No second command can signal again.

After a successful one-shot syscall, manual recovery still requires original Popen wait `-SIGKILL`, bounded
original stdout/stderr EOF, bounded control drain/EOF and controller ECHILD. The original failed fence bytes
must remain unchanged. Controller result2 and outer actual wait2/EOF/ECHILD mean MANUAL recovery only;
they never become COMPLETE, normal-cleanup PASS, Native authentication or product admission. Any missing
proof retains the owners. SIGKILL is a proposed narrowly gated emergency action for this original guardian,
not an implemented product shutdown policy. No signal is sent during source work.

## Source validation

The pre-agreed seams are existing public fd3/control frames, fake dispatcher protocol and supervisor OS
callbacks. `python3 -B tests/supervision/fixtures/external_backpressure_policy_test.py` runs21 pure tests:
constructor interruption, expiry before ECHILD and crossing expiry, partial writes/actual EAGAIN requirement,
strict size bound, exact filler/COMPLETE/EOF, durable-intent failure, recovery identity/phase/single use,
reporter/interrupt retention, exact START/root-zero grammar, unknown-constructor HOLD, dispatcher exact ACK
and duplicate-ID refusal, file+directory fsync failure, bounded reader overflow, sampled outer late drainage
and clock failure. AST-selected definitions execute only with fake OS/clock/socket/process callbacks.
Runtime adapters and staging modules are not imported or invoked. All new Python sources AST-parse; no ELF,
build, actor, proc observation, pidfd acquisition, Native import, key or signal operation is performed here.

## Prospective Root sequence, not execution clearance

After fresh paired Source GO, Root may prepare source files only:

```text
/usr/bin/python3 -B tests/supervision/fixtures/external_backpressure_stage.py --prepare-source external-current-602f498-backpressure-r17-v1
```

Then, in a separate compiler-only Root session with environment exactly `PATH=/usr/bin:/bin`, compile only:

```text
/usr/bin/gcc -std=c11 -Wall -Wextra -Werror -O2 -static /tmp/omp-external-current-backpressure-r17-20261117/root.c -o /tmp/omp-external-current-backpressure-r17-20261117/release/bin/omp
/usr/bin/gcc -std=c11 -Wall -Wextra -Werror -O2 -static -include /tmp/omp-external-current-backpressure-r17-20261117/configuration.h /workspace/work/omp-webui-ticket-41-current-backpressure/compatibility/supervision/external-protector.c -o /tmp/omp-external-current-backpressure-r17-20261117/release/bin/omp-external-protector
/usr/bin/python3 -B tests/supervision/fixtures/external_backpressure_stage.py --seal-unsigned external-current-602f498-backpressure-r17-v1
```

Record compiler version/identity, actual commands/config bytes/device/inodes and binary digests. Preserve
that compiler session and all raw outputs through actual compiler EOF/waits. No target executes there.
Fresh unsigned-artifact Spec and Standards review must independently validate the exact staged C/config,
both static ELF identities and source/manifest/environment closure. Only then may Root authorize ONE
actual window using the inspected literal manifest SHA256. The prospective command shape, requiring that
future digest and its own separate clearance, is:

```text
env -i PATH=/usr/bin:/bin HOME=/tmp/omp-external-current-backpressure-r17-20261117/home TMPDIR=/tmp LC_ALL=C /usr/bin/python3 -B tests/supervision/fixtures/external_backpressure.py --run-once external-current-602f498-backpressure-r17-v1 <ROOT_INSPECTED_MANIFEST_SHA256>
```

Root must keep the original stdin available for the emitted original-pidfd business gate and any separately
approved fresh manual recovery command, and preserve this original tool until actual EOF. Never rerun a
used stage or an historical scope. A fresh attempted case needs a newly reviewed path/generation/marker.
No Bun is needed. Any later pure Bun command must set `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`.

External EPIPE is frontier-only: NOT IMPLEMENTED/NOT RUN. It requires its own fresh independently reviewed
case and recovery/artifact scope. Real Native external approval/registration/publication, public Host/FFI,
peer ancestry, surviving real services, final source/schema/assets, actual global launcher selection and
product admission remain unresolved. The production external builder and its maintenance provenance are
not exercised or established by this synthetic direct compiler recipe.
