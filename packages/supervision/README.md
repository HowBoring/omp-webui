> Source normalization: the H/public-P prerequisites from [ADR 0026](../../docs/adr/0026-unregistered-supervision-prerequisites.md) now carry the unregistered external source composition in [ADR 0027](../../docs/adr/0027-unregistered-external-protector-composition.md). Historical results below apply only to their original artifacts. The new composition requires fresh paired review; actual runtime/global/private admission remains BLOCKED.

# Private Linux supervision (#41 / #48 / #61)

Status: **BLOCKED**, no cleanup/product admission capability. Strict static C compilation passes. The first nominal
FAILED before HELLO and its original containment failed, leaving an unresolved old fixture. After reviewed source
hardening, exactly one updated nominal again FAILED before HELLO; its independent parent reached P_ALL/ECHILD drain,
with the new helper fence retained. A later single diagnostic nominal likewise FAILED at HELLO while readiness
remained pending and one registration request was observed; its independent parent also drained. See
[the diagnostic attempt](../../docs/evidence/ticket-41-private-helper-diagnostic-attempt.md). No completion proof for the current approved-module production adapter; other OS families, Native/global/dispatcher proof
remain NOT RUN. See [the updated nominal evidence](../../docs/evidence/ticket-41-private-helper-nominal-reviewed.md)
and `docs/evidence/ticket-41-private-helper.md` for the preserved original failure. Linux only; Windows/WSL2
validation is owner-deferred. This module is a process supervisor, never an Agent, SDK adapter or Session reader.

## Public control seam

The configured C helper owns exactly one actual Native root and its adopted private children. Bun owns/waits only
for the helper. `stdio[3] = "socket-fd"` is the pinned Bun public POSIX interface; the returned numeric fd transfers exclusively to the approved public control-I/O module.
Production construction has no Socket/filesystem fallback. Native receives fd0/1/2 unchanged. The helper never writes stdout/stderr or reads
Native RPC. Its trusted fd3 is CLOEXEC and is closed in the Native child. A separate private pipe holds child exec.

Control is ASCII LF-delimited, at most 512 bytes including LF, no NUL/CR, no optional fields. Every frame carries the
immutable 64 lowercase hex generation. The Host never accepts a Native stdout frame as control.

Host commands: `START generation`, `ORDINARY_STOP generation`, `FORCE generation`, `MANDATORY generation`,
`STATUS generation`. `START` is single-use. Force is a separately authorized user action after ordinary Stop's
30-second offer threshold. `MANDATORY` is revocation/shutdown (or autonomous fd3 EOF/protocol failure), with one
absolute 30-second cooperative + 5-second TERM budget before KILL. Elapsed thresholds do not prove extinction.
Ordinary Stop and root exit do not trigger escalation. Host closes Native RPC admission before FORCE/MANDATORY.

Helper events: `HELLO generation helperPid helperStartTime nativePid nativeStartTime`,
`STATE generation waiting|running|ordinary|cooperative|term|kill|incomplete`,
`ROOT_EXIT generation exitCode signal`, and `COMPLETE generation`. PIDs are actual kernel identities; the helper
retains its root pidfd. Start times are decimal /proc field22 hints, never signal or registration authority.
Before spawn, `prepareHelper(generation)` binds the pending generation to the authenticated Host dispatcher peer.
The helper actively connects the fixed compiled installation endpoint and registers its actual socket peer before
HELLO. The dispatcher verifies its direct Host parent and approved executable/tuple, then fsyncs protection before
acknowledging. HELLO follows subreaper verification, durable helper fence + lease, fork/root pidfd and that ack,
before child exec. The Host's `registerHeldHelper` callback verifies the public dispatcher `helper_status` receipt. The Host must independently verify the selected helper digest/source review,
closure/schema/control identity and actual helper/native ancestry/identity. Its separately trusted dispatcher
registration must retain a kernel helper peer pidfd (SO_PEERPIDFD, through the Native lead's backend), independently
verify the authenticated Host↔helper parent relationship and executable identity, and fsync its incomplete fence
**before** Host sends START. A claimed PID, checked kernel version, self-reported digest or callback type is no proof.
No backend is supplied/admitted by the control protocol alone. The actual Native PID stays distinct from helper PID.

The explicit operator build refuses enrolled releases and existing helper destinations; compilation targets a
temporary file and publication uses exclusive creation. It never overwrites an approved release member.

The helper's compile configuration pins a stable installation ID/dispatcher endpoint, ordinary global entry,
maintenance control inode and stable private fence
directory (canonical, pinned device/inode, owned by the helper UID with no group/other permissions).
Only trusted Host-controlled argv are accepted after generation, with a bounded count/byte budget; no shell/PATH
lookup or browser executable/argv is permitted. The entry must be the same selected ordinary global OMP entry,
not a hidden extra production worker. Native0010 must reject all shared access in this private domain, including
nested env-i entry. This helper alone cannot certify that invariant.

## Extinction and maintenance

The helper is sole wait owner. Signaling requires a held pidfd and successful waitid(P_PIDFD) child verification;
ECHILD never authorizes a signal. Own-child snapshots or coordinator-approved numeric `/proc` directory names provide bounded candidates only;
foreign process metadata and PID trees are never read for discovery. Reap and repeat adoption,
including setsid/double fork/nested subreapers. Completion requires root reaped, helper spawn admission closed and
waitid(P_ALL) ECHILD. Empty candidate scans, root exit, process groups and Native settled are insufficient.

After that kernel proof, the helper sends `complete_helper` on the same active dispatcher socket and requires its
matching acknowledgement before clearing its own fence or exiting. Dispatcher loss keeps existing private
supervision, lease and fence; it adds no automatic force policy. Host control loss retains its mandatory policy.

The helper retains its shared maintenance lock and fsynced incomplete-generation fence until both proofs. Unresolved
resource/protocol/reap errors keep the helper alive with protection retained. SIGKILL/crash leaves the durable fence;
Native dispatcher and maintenance must refuse new registrations/updates until supported independent recovery.
Never delete fences on elapsed time, recover by PID kill or infer cleanup from helper exit. Maintenance integration
must consult both its stable lock and dispatcher durable fences; old flock-only maintenance is not sufficient.

The separately built, unregistered external source policy shares these mechanics; see [EXTERNAL.md](EXTERNAL.md)
and [ADR 0027](../../docs/adr/0027-unregistered-external-protector-composition.md). Its control EOF retains protection
and never applies private force policy to external brokers/services. The private binary cannot select that policy
through argv/environment. No external dispatcher registration or actual lifetime proof is added here.

## Agreed tests and remaining evidence

Pure tests cover bounded generation-bound protocol and admission ordering through the public control seam.
The helper and independent controller verify procfs/PID-namespace consistency before creating a private domain.
Coordinator explicitly amended the earlier internal discovery restriction: when the own-children file is absent,
numeric `/proc` directory **names only** may supply candidates. Every candidate still needs held-pidfd kernel
child verification; no foreign stat/status/cmdline/exe/PPid/name/tree inspection or numeric PID signal is allowed.
The amendment is source-only; all further runtime work requires coordinator clearance. Observer errors after
controller launch retain its owning parent. The old stranded fixture remains a separate UNKNOWN / NOT_DRAINED
operator-recovery matter; enumeration never grants a new parent recovery authority over that orphan.
After root clearance, harmless real kernel fixtures must cover actual PID/wait ownership, start barrier, setsid,
double fork, nested subreaper/early root exit, control EOF, foreign-child pidfd refusal, adoption races, fd/resource
faults, retained unresolved fence/lease, authoritative ECHILD and ordinary versus mandatory timing. Contain failed
fixtures through their own independently held kernel parent; no global tree scanning or unknown process killing.
Actual matched Native and synthetic HOME/provider tests need later root approval and pre-import egress guards.

`createPrivateHelperOwner({selection, controlIoApproval})` loads and validates one real public control-I/O module
before any preparation or helper spawn. The owner takes responsibility for retaining the inspected selection and
independent approval; callers must not release that selection themselves. `owner.launch(input)` reuses the module
for concurrent handles and verifies helper artifacts and prepare/register callbacks. Test systems are available only
through explicitly non-authorizing `testing.ts`; the production constructor accepts no loader substitution.

`owner.launch` returns an owned handle before `ready` finishes, including missing fd, adoption or listener setup
failure after spawn. Native input stays fenced; helper reap remains observable. `helperExited` alone is not drain.
Only `completed` combines matched COMPLETE, fully decoded clean control EOF and successful original helper reap.
The carried external clean-EOF correction rejects close-only/truncated completion. The module never enrolls its own
source/binary approval. Raw-fd close is attempted exactly once only before transfer; uncertainty never permits retry.

`owner.close()` stops further launches, awaits all controller completions and the module's callback-safe disposal,
then releases the selection. Completion never automatically unloads. Close during launch preparation returns busy;
retry after preparation finishes. A rejected disposal/completion close is sticky and keeps the owner, handles, module,
pins and selection strongly retained. Failed load with unknown disposal or loader busy likewise retains protection
without a returned owner. Reusing the same selected lifetime for another owner is refused without releasing it.
Source tests are recorded in [the public-adapter evidence](../../docs/evidence/ticket-41-controlio-public-adapter-source.md).
The old kernel nominal fixture now names this owner but is NOT READY for an actual window: a fresh independently
approved public-module release/approval stage is still required. Private helper C/wire remain the IO baseline; the
external composition still needs fresh review and later new build/provenance/approval proof. Native0010 and product admission remain unchanged.

Session, adapter and builder failures use `PrivateHelperError.code`; decoder errors retain their existing
`PrivateControlError` type and codes. Optional `causeCode` contains only a finite helper/system category.
Raw messages, filesystem paths, compiler diagnostics and cause objects are not carried across the seam.
Caller policy must use codes, never parse error messages. Pure controlled-OS failure evidence and compile-only
checks are recorded in [the static-review fix report](../../docs/evidence/ticket-41-private-helper-review-fix.md).

The helper-only dispatcher wire is canonical ASCII JSON+LF, at most512 bytes, version `omp-execution-helper/1`.
Requests contain `version`, independent random64hex `id`, compiled64hex `installation`, and `operation: { op,
generation }`; op is `register_helper` or `complete_helper`. Success uses exact property order `version,id,ok,
operation,generation` with `ok:true`. IDs differ from generation and each other. C checks the complete canonical
success including ID/operation/generation; stale, late, duplicate, oversized or unknown responses retain protection.
The complete selected closure/schema/helper digest comes from independent dispatcher approval, not compiled closure
hashes (which would create a hash cycle). An inherited socketpair's peer identity cannot authenticate the helper.

The lifecycle guarantee covers this compatible selected Native and ordinary nested env-i entry under Linux normal
parentage. Arbitrary downloaded old Native, hostile same-UID/ptrace bypasses, PID namespaces and delegated external
jobs are outside this lifecycle policy. Generic bash effects are not an OS sandbox or automatically reversible.

The candidate adapter retains its cursor across64-pid/256-name/5ms batches and repeats completed passes. A pass
is limited to65,536 names,4MiB name bytes and30seconds from first enumeration (ordinary worker lifetime does not
consume this pass budget). Own-child snapshots cap64KiB/1,024 PIDs. Limits, read/readdir/clock/eligibility/signal
errors report incomplete; no truncation or empty result becomes extinction. There is one transient candidate
pidfd plus fixed retained control/root/lease/fence/directory descriptors. The retained root signal path runs before
and independently of discovery. Terminal candidates go to the central sole reaper, never to signal delivery.
`__WALL`, default SIGCHLD without SA_NOCLDWAIT, single thread, no ptrace, and exclusive private construction are
required throughout. Procfs mismatch, multiple NSpid levels or a different future-child PID namespace is unsupported.
The Python fixture controller independently implements that OS interface; compile-only ABI assertions check its
zeroed Linux64 siginfo layout. None of these source/compile results proves kernel behavior.
