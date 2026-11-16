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
preparation contains only public decision/protocol modules and an uncompiled C/FFI syscall bridge; the dispatcher
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
