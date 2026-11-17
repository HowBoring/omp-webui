# ADR 0018: Global dispatcher and private Native supervision

- Status: Accepted development direction; source preparation only; runtime/global/private admission BLOCKED
- Date: 2026-11-16
- Tickets: [#41](https://github.com/HowBoring/omp-webui/issues/41), [#48](https://github.com/HowBoring/omp-webui/issues/48), [#61](https://github.com/HowBoring/omp-webui/issues/61)

Worker root exit, process groups and empty `/proc` children do not prove cleanup. An inherited private-mode flag
also misses a benign nested `env -i ... omp`: its auto-spawned broker could later be shared by an external TUI.
The private helper cannot then safely kill every descendant. Existing Native completion owners are routing metadata,
not atomic service ownership or authority. A broker lease does not protect services surviving broker exit.

Use one public independently running dispatcher for every compatible Native broker launch in the selected global
installation, including ordinary TUI. Host may bootstrap it **before** private helpers; operators may start it
independently. Ordinary clients never spawn it or fall back to local/legacy brokers. This is an explicit new TUI
startup dependency. No actual owner-selected global installation or final source tuple is established here.

The dispatcher classifies the actual peer against durably registered private helper generations using actual Linux
SO_PEERPIDFD, retained ancestor pidfds and revalidated ordinary ancestry. PID/environment/name claims are not authority.
Missing/changing chains fail closed. Helper uncertainty globally fences new shared registrations and maintenance;
orphan reparenting never promotes a private descendant to external. No recovery kills numeric guessed PIDs.

Authentication is asymmetric. The server obtains actual client/helper SO_PEERPIDFD identities. Ordinary Bun clients,
including worker realms, use public UDS APIs and verify Ed25519 replies against the operator's independently pinned
dispatcher reply public key authenticated by a separately signed outside-release approval record; clients do not load FFI or claim a retained server pidfd. Each reply
binds a fresh nonce, exact request SHA256, protocol/operation/request ID, installation ID, approved closure/schema,
server generation and response. Invalid/missing signatures or a replacement generation fail closed, without trust
enrollment, fallback or automatic keys. The dispatcher private key stays in protected local dispatcher data, never
browser state/logs or provider credentials. Signature authenticity does not prove actual global provenance, mapped
bytes, lifecycle or admission; those remain independent gates. No operator record currently exists.

The helper's bounded 512-byte C wire remains separate. Actual helper REGISTER must match the server-observed kernel
peer, direct Host parent and approved helper binary. Host prepare/status travels over the authenticated client channel;
Host must verify registered status before START. A fake endpoint's minimal helper ACK cannot by itself release Native.
The held helper socket remains bound through COMPLETE after actual extinction and server acknowledgement.

Private Native rejects named shared service administration, browser/relay, IDA, external text-prediction control and
external LSP mux before factory/token/mkdir/request/completion effects, with typed `shared_service_unsupported`.
Preserve generic bash, private background execution and Native parent-owned subagents. Private LSP and local blob
fallback require actual positive proof. These optional native feature limitations do not remove any mandatory tool
failure, chat, background or attachment story. Ordinary external TUI shared operations remain the intended supported
path through the dispatcher after all external lifetime protectors exist.

A dedicated tiny C private subreaper is the sole wait owner of one actual Native worker and adopted descendants.
Bun waits only for the helper. Native stdio stays direct; a separate trusted bounded control FD reports actual Native
PID/generation/lifetime identity. Register and durably fence the actual helper before releasing worker start. Native
leases and runtime mapping checks use the Native PID, never the helper PID. Force targets only held pidfds verified
as direct waitable children, repeatedly adopts/reaps, and completes only with root reaped + closed admission +
authoritative P_ALL/ECHILD. Deadlines are escalation points, not extinction receipts. Control EOF initiates private
fail-safe cleanup. Unresolved children retain helper, maintenance lease and durable incomplete fence.

Dispatcher-owned brokers and each surviving external service need independent maintenance protection outside all
private domains. An explicit external protector mode preserves ordinary service survival on broker/dispatcher/control
EOF while retaining lease/fence until actual extinction. It must not inherit the private EOF kill policy. No owner
refcount protocol is needed for this first policy because private registrations cannot access shared operations.

Native patch `0010-execution-ownership.patch` is reserved for the matched public contract, CLI/wire/schema/client/
server, no-auto-spawn integration, consumer guards, Linux dispatcher bridge and external lifetime policy. The current
preparation contains only public decision/protocol modules and a C/FFI syscall bridge with strict compile and bounded
socket/pidfd primitive evidence; the dispatcher
entry explicitly reports backend unavailable. It is composed after stable patches 1–6 for source work only, absent
from the active patch list. Helper/Host control work is a separate supporting component. Neither component grants
lifecycle capability independently. Concrete budgets and stage status are in the Native patch's public documentation
and [ownership preparation report](../evidence/ticket-41-ownership-preparation.md).

Next prove harmless OS mechanics, then actual synthetic Native bash/background/subagents, nested cleared-environment
denial, independent external TUI/service preservation, missing/legacy dispatcher behavior, crash/fence faults, private
LSP and mandatory attachments. Rebuild and validate one final matched global combination before private admission.
Linux is current scope; the owner deferred actual Windows Chrome/WSL2 acceptance. Arbitrary old downloaded Native,
hostile same-UID/ptrace/namespace/reparent tricks and externally delegated irreversible effects are outside this
supported lifecycle guarantee. This is not an OS sandbox or external-effects rollback.


Source preparation now separates a stable independently pinned outside-release anchor from changing release approval.
The compiled anchor contains only installation, dedicated Ed25519 approval verification key, fixed protected record
location/parent identity and version/bounds; no release closure/schema/component digest or changing-record digest.
The build order is stable anchor -> final compiled bytes -> exhaustive final closure -> signed outside approval.
The domain-separated approval binds final closure/schema, root/entry/control, bridge/helper/control-I/O/validator,
dispatcher reply key, endpoint and state/fence policy. Approval and dispatcher reply keys must differ. Signatures
authenticate approval only; actual global provenance/mappings, semantics, durable fences and data gates remain required.

Approval selection is immutable per supervision generation. The loader captures opened record identity/digest/exact
bytes/change metadata and rechecks opened/named files before/after reads and asynchronous admission; replacement or
change permanently invalidates new admission for that selection. Bootstrap retains first selection/failure. No live
reload, reconnect approval, environment/HOME/cwd/manifest trust, self-enrollment or startup key creation is permitted.
Workers retain existing independent public UDS authentication and registration semantics; publication is prohibited
while any process/realm shared lock or unresolved fence remains. These source checks do not implement or prove those
all-process publication gates.

Publishing/revoking/upgrading/rolling back approval is an explicit operator action under existing exclusive control,
all-process/shared locks, fences and current-data/TUI compatibility gates. Changed approval requires manual restart
and a new supervision generation. Old signed records bypass no actual tuple/current-data check; no updater, automatic
downgrade or new cryptographic antirollback counter is introduced. No production anchor/approval/key/global selection
exists. The normal dispatcher entry and broker publication remain unavailable pending full external-protector and
final release integration. Earlier public UDS/kernel-peer/signed-reply and C-launcher/actual-Bun lock proofs remain
separate historical evidence. The [signed-anchor public UDS fixture](../evidence/ticket-41-anchor-uds-green.md) now has one actual
synthetic PASS: authenticated inspect refusal and postchecks, accepted-client C kernel peer capture, awaited server
exit0 and retained P_ALL/ECHILD. It supplies no Native Agent/helper/broker/protector lifetime, production closure
or global/private admission; guard counters remain UNKNOWN.

The next inactive source prerequisite selects the inherited C launcher FLOCK using an explicit reserved argv locator
and a pure main-thread filesystem guard, before either bridge/control-I/O loading. The locator supplies no authority;
exact signed control metadata and bounded self-fdinfo prove the retained descriptor fact. Process exit owns lock
release; generation disposal never closes/unlocks it. Linux `pi-natives.FileLock` is an exclusive abstract UDS lock,
so it cannot substitute for the existing maintenance policy.

Composed selection has a separate strict anchor/2 + approval/3 signature domain and exhaustive digest-bound inventory,
with signed public-package/native roles, directory/link/mode verification and bounded ELF dependency/alias closure.
The concrete Native adapter implements the existing public `@omp-webui/control-io` selection contract using only
filesystem inspection; Host runtime code and I/O algorithms are not imported/copied. Historical v2 UDS approvals
cannot be promoted. At that prerequisite stage, production package resolution, public module load/lifetime and later
authenticated preparation remained absent, so server open refused before any library import. The follow-on source
slice below adds the public module owner; actual signed composition and new handoff evidence remain missing.
See [source prerequisite evidence](../evidence/ticket-41-native-control-selection.md); this is no production admission.


The next inactive source slice composes a Native-owned public control-I/O singleton. It uses an authenticated dynamic
import of the signed canonical public JS entry after complete selection verification, rather than an uninstalled bare
package lookup or copied Host owner. Compile-time types map to the exact immutable nominal package declarations;
release inventory and outside approval still bind final build bytes separately. Full checks bracket import/load and
asynchronous preparation; the final synchronous barrier precedes generation commit. Bridge loading additionally
requires the exact loaded public owner and defers its FFI import to prevent bundler hoisting before public loading.
This deliberately narrow main-only dynamic-import exception implements the authenticated release boundary.

Shutdown stops admission/polling, drains queued response/uncertainty work and requires empty, certain lifetime before
bridge/fence cleanup, awaited public module close and generation release. Native lacks the Host's original helper
wait handle: ANY committed prepare therefore conservatively prevents module/selection disposal, even after COMPLETE
or EOF. Unknown helper peers and durable fences remain retained; shutdown does not clear fences. Failed/uncertain load
or disposal remains singleton-owned. The inherited C maintenance descriptor remains process-owned until actual exit.
The ordinary dispatcher entry and broker/consumer/global/private admission remain unavailable. These are source-only
mechanisms; actual signed Native load/prepare/drain and the new C argv handoff still require separate authorized proof.
See [module-owner source evidence](../evidence/ticket-41-native-control-owner.md).


Queued response bytes are a publication boundary, including every continuation after a partial write or backpressure.
Immediately before each bridge write, the server synchronously rechecks the exact nominal loaded owner/selection,
connection/server closing and deadline state. Admission-bearing replies also recheck the current dispatcher, known
system uncertainty and fence state. A failed barrier drops the whole queued remainder; bytes already sent cannot be
retracted. Signed negative inspection replies and trusted COMPLETE acknowledgements retain separate drain semantics,
while an invalid owner forbids all output. These checks reject detected invalidation; they make no timing claim about
undetected external changes. The extracted pure reply queue creates no production owner, transport or RPC authority.
See [publication-barrier source fix](../evidence/ticket-41-native-control-publication.md); actual composition is NOT RUN.
