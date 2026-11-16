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
public key in an outside-release approval record; clients do not load FFI or claim a retained server pidfd. Each reply
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


Source preparation now includes an explicit pinned outside-release approval/key loader, public Bun UDS client and
nonblocking C-backed independent server module for the first synthetic identity tracer. The normal dispatcher entry
remains unavailable, no compiled production operator pin exists, and broker start/publish remain unavailable pending
external protector integration. The opt-in tracer has not run. Its controlled source/tool identity is separate from
actual global provenance or lifecycle admission; maintenance retention and helper paths remain independently unproven.
