# Native ownership/lifetime contract proposal (source only)

Status: **PROPOSED / NOT IMPLEMENTED**. No Native patch number, wire name or capability is reserved by this note.
The coordinator must approve a concrete public contract and patch boundary before implementation. This note
supports #41's maintenance-lifetime decision and `S1-CHILD-OWNERSHIP-FOLLOWUP`; it does not publish cleanup proof.

## Actual source constraints

Read-only current candidate source (`vendor/omp`) retains these baseline paths/behaviors:

- `launch/client.ts` `#connectOnce()` attempts existing broker connection, then calls `#spawnBroker()` on connection
  failure. Reconnect can repeat that path. `#spawnBroker()` uses private `resolveWorkerSpawnCmd` and a private worker
  argument, `detached: true`, `child.unref()`. Existing options supply runtime directory and idle grace only. There
  is no public Host external-launch policy or no-fallback guarantee.
- `launch/services.ts` derives service owner from native Session/Agent identity. Dispose unregisters completion
  with `preservePending: true` and clears its in-process map; that is not owner-service termination. Session change
  deliberately retains completion replay. The Host cannot read those private maps or treat disposal as extinction.
- `launch/broker.ts` separately owns native broker lease/authenticated IPC and service generations. Its shutdown
  path preserves permitted detached services; recovery can monitor them after broker restart. Broker exit is not
  proof every service has exited or stopped loading a release. Internal broker tokens/PID metadata are not a
  public Host ownership/launch authority and should not be exposed to browsers.
- Internal `DaemonOperation.stop` has optional `id` (snapshot generation); the current broker checks it, but older
  brokers may ignore it. `stop`/`restart`/`mode` have no owner predicate. `start` with replacement can terminate an
  existing named generation before assigning the new owner. Filtering `list` in Host followed by `stop` cannot
  become an atomic owner guarantee. `owners`/`detachedOwners` in the wire envelope control completion routing,
  not authority or per-service shared ownership. A single `snapshot.owner` cannot prove that another TUI has no
  resource share in a shared service. The new contract needs atomic owner+service+generation matching, and a
  public shared-owner reference/exemption policy before publication.
- `#stopRecord` refreshes detached metadata then calls `Process.fromPid(...).terminate(...)`, waits within a
  budget and may return while the record remains stopping. A new public native result must preserve unresolved
  termination and must not treat existing method return as an extinction receipt or stable PID authority.
- Real builtin shell execution can `setsid` and outlive a forced root worker. Process group killing, PID-tree
  guesses, `sessionSettled` and direct root reap do not establish private-child cleanup. Existing source research
  in the coordinator's owned-child notes remains applicable.

## Proposed public native semantics

The smallest acceptable addition needs all of the following; method/type names remain undecided:

1. An explicit startup-enforced execution-ownership mode and effective public report available before risky
   Session/UI creation. In this mode, generic tool/native private subprocesses remain inside the supervised private
   domain. No implicit broker spawn can occur during import, initial connection, reconnect or fallback. Unsupported
   ownership mode fails before spawn/publication; a capability flag alone does not prove this behavior.
2. A public native request to obtain an externally owned shared broker for a **validated native scope**, carrying
   opaque request/worker generation, scope identity and expected delivery/maintenance identity. Native pauses before
   spawning/serving. Host accepts only this versioned operation from its authenticated owned worker; browsers never
   receive raw executable/argv or broker credentials. The Host invokes only a reviewed public Native broker entry
   under the selected same approved global closure, outside the private helper domain. A public safe broker start
   entry must be authored; the Host must not call the current private worker argument/helper API.
3. A broker-generation handshake that validates native scope, public ownership mode, actual source/schema/closure,
   maintenance control and a stable external lifecycle token **before** publication to clients. It must distinguish
   an existing matching broker from an old/unknown broker. Connection failure, stale token, broker death/restart and
   concurrent two-owner start races cannot fall back to an unclassified native child.
4. An owner-scoped public stop/drain/status result for Session-owned services, with generation-safe terminal and
   unresolved outcomes. It must preserve another Session's services and explicitly define persistent/detached
   policy. Its atomic broker operation must match owner identity/registration, service identity and generation,
   with a conflict outcome that sends no signal after ownership changes. Shared service membership cannot be
   inferred from completion subscriptions. Only Host-supervised owner shares are stopped/released; unrelated
   TUI owners and the broker itself remain intact. Denying existing service behavior is a scope decision, not an implementation shortcut. Any permitted
   surviving service that may load the release needs its own independently retained maintenance lease or an equally
   proven stable source arrangement. A broker-only lease does not protect a service surviving broker exit.
5. Same-source authored wire/schema, server/client validators and public README/JSDoc for these guarantees, plus
   exact semantics on config/policy changes. Native owns Session/Agent service association; Host owns supervision
   and authorization and never imports private SDK/runtime or parses native Session data.

## Proposed Linux private helper boundary

A dedicated small helper can create a **private** child-subreaper domain before launching the single native worker.
This avoids mixing unrelated Host children and avoids Bun becoming the wait owner of adopted processes. It is a
supervisor, not another Agent/production worker. The helper must be the sole wait owner of its registered native
child and adopted private children; Bun owns only the helper. Parent/child stdio must carry the actual native
protocol directly, without human output. A separate inherited trusted control channel reports the actual Native
PID/identity/generation and lifecycle results, never inferred from numeric-PID trees. Native lease and mapping
checks remain bound to that actual Native PID, not the helper PID.

Before signaling, every candidate needs stable pidfd identity plus verified child relationship; no `ECHILD`
assumption grants signal authority. The helper must account for new-session/double-fork/nested adoption and
coordinated status collection. Empty `/proc` lists/polls are not cleanup completion. Completion requires root reap,
closed spawn admission and an authoritative no-private-children endpoint. Failure/unknown children retain the
supervision fence and block another generation. Host crash/helper control EOF need an explicit fail-safe policy;
force signaling is not a receipt of exit, and uninterruptible tasks may exceed the 30+5-second escalation budget.

Shared broker creation **must** route outside this private domain before any spawn or publication. Exempting an
already adopted broker by command name/PID or killing it with the private children is invalid. Shared service
owner-scoped cancellation and maintenance leases remain distinct from private-domain cleanup.

## Required evidence before approval can become a capability

Use bounded harmless OS fixtures for helper mechanics, then matched real native builtin shell and two-synthetic-
Session shared services. Cover PID reuse/foreign-child rejection, setsid, double fork, nested subreaper adoption,
early root exit, competing waits, fd exhaustion/errors, control EOF, blocked exit/deadline failure, no leaked helper
or private descendant, failure-before-broker-spawn/reconnect, generation mismatch and preservation of the other
owner's service. Independently clean failed tests through an owned containment boundary. Bind final Native PID,
selected global delivery bytes and effective schema to actual runtime mappings. Repeat on actual Linux and later
owner-deferred WSL2. All such native/helper lifecycle results remain **NOT RUN** in this delivery slice.

## Bounded first policy alternative (also PROPOSED, not implemented)

A startup-enforced **private execution only** mode can avoid adding shared service ownership/refcount semantics
for the first Host-supported build. Ordinary global TUI outside that mode keeps its existing behavior. The mode
must be effective and publicly reported before Session/UI/import side effects, immutable for that process, and
inherited/revalidated by every native-owned helper/subagent worker. It must reject shared daemon creation,
replacement, restart, mode change, stop, send/signal and shutdown **before** effects. It cannot merely guard the
bash `service` option: shared daemon consumers also include browser/relay, IDA, image blob backend, text prediction
and LSP mux. New unsupported actions need a stable typed public reason; no success/deferred fallback may hide them.

The strongest minimal implementation denies shared broker access at the native client factory before directory/
token creation, then guards every operation/connect/reconnect path as defense in depth. A later optional read-only
existing-broker path must use an existing token only, never mkdir/create/read-or-create or auto-spawn. Current
`request()` envelopes publish owners/completion subscriptions even for ping; they are not a read-only protocol and
must not be reused unchanged. All mutation operations above must be denied, plus any direct daemon control socket
shutdown/replacement logic outside that broker client. Unknown/external services are never signaled.

Actual source makes a bounded policy plausible, with important checks:

| Surface | Actual source behavior and required policy treatment | Mandatory spec impact |
| --- | --- | --- |
| Generic native bash/background/subagents | Native shell/private descendants remain in helper domain; do not disable them with `--no-tools` | Preserve stories 23–25, 28, 34–39 and parent-owned subagents |
| Named bash services | `startService()` uses shared project client; service mode/stop paths may affect shared named resources | No explicit named shared service administration story; typed refusal is compatible with tool failure rendering, subject to coordinator scope decision |
| LSP | `lsp/client.ts` prefers shared path but explicitly falls back to private `ptree.spawn`; a separate external lspmux wrapper may already route to a shared server | Preserve private LSP fallback; bypass/deny implicit external multiplexed creation in this mode rather than silently managing unknown services |
| Image blob daemon | `connectDaemonBlobBackend()` catches failure and returns null; `LiveImageUrlService` builds local backends as fallback, potentially prewarming them | Shared-to-private backend can preserve image input semantics, but attachment/model budgets, bytes and degradation guarantees in stories 57–64 must be rerun; no blanket image PASS from source alone |
| Native browser/relay and IDA | Project/global broker users may create/replace shared services; browser health code may stop an existing named daemon | Deny before requests/effects and render actual native error; full native tool/TUI feature parity is out of scope, but product tool failure rendering remains mandatory |
| Text prediction | Existing connect logic can send shutdown to an older daemon directly before starting its replacement | Disable this optional shared prewarm/control path before connection; do not rely only on central start guard |

This alternative preserves core browser coding/streaming/tools **only if** real Native tests confirm private bash,
background/descendant execution, subagents and any required attachment conversion/input path still work, while
explicit unsupported errors are visible. The spec promises readable actual tool failures, not every native TUI
feature. It still requires all mandatory attachment formats and ordinary Stop/revocation/owned-process behavior;
none of those may be removed merely to make the policy pass. The coordinator must record the supported policy
and decide whether any affected optional native action is actually required before reserving a patch.

An inherited environment flag alone does not prove all nested ordinary OMP entry paths are classified: a generic
tool can launch another ordinary OMP with a cleared environment. Before granting cleanup, the contract must define
whether all such descendants are unconditionally private (including nested broker publication), or provide an
entry/backend enforcement that prevents a nested native process publishing a shared broker from the private domain.
The global ordinary TUI path outside supervision cannot be classified from a guessed command name/PID. This is a
specific remaining policy/enforcement question, not a same-UID sandbox promise or permission to kill a shared broker.

## Helper/control/provenance/maintenance invariants for either policy

- Host starts one reviewed helper, which enables/verifies subreaper before fork. Only that helper forks the native
  root, records its child identity and owns its wait status. The actual selected ordinary global C entry execs
  packaged Bun without changing the child PID. Native lease stays native; Host runtime maps use that Native PID.
- Use an inherited private control socket separate from native stdin/stdout/stderr. Pinned Bun public types expose
  POSIX `stdio[3] = "socket-fd"` and caller-owned `subprocess.stdio[3]`, suitable for a future real socketpair fixture.
  This is source feasibility only, not a tested transport. Frame/control byte/member/queue limits and ownership of
  both fd ends must be fixed. No endpoint/credential or raw executable choice is exposed to a browser.
- Handshake binds Host nonce/generation, approved helper digest, expected delivery identity, actual helper PID and
  helper-forked Native PID before native stdio admission. Only the owned inherited channel grants authority;
  stdout frames, self-reported arbitrary PIDs, `/proc` guesses and stale control generations cannot substitute.
  Host verifies actual Native runtime mappings against the same release before risky Session operations.
- Cooperative Stop/EOF/TERM/force and Native root exit are distinct from adopted-private-child drain. The helper
  retains its shared installation lease until authoritative no-private-children completion; a root-only fd or
  helper exit notification is insufficient. Descendants may continue loading the release after root exit.
- The helper must handle Host control EOF autonomously, remain alive while cleaning, and report explicit unresolved
  status on resource/deadline/protocol failure. Host must not terminate the cleanup controller to satisfy an elapsed
  deadline. New worker admission remains fenced while unresolved. A helper crash is not a successful drain.
- The supported maintenance workflow also needs a durable incomplete-generation fence before launch, cleared only
  by proven completion. Otherwise a Host/helper crash could release their flocks while descendants survive and a
  later installer could falsely infer safety from exclusive acquisition. Recovery may remain manual/BLOCKED; it
  must not signal unknown PIDs or silently delete the fence. Exact crash/fence guarantees need separate design
  and fault evidence before lifetime capability approval.
- Any admitted shared/persistent exemption must exist before creation/publication, have public durable owner/
  generation/lifetime semantics, retain its own maintenance protection, and preserve external owners. The bounded
  policy avoids adding exemptions by refusing shared mutation; it cannot publish unqualified external cleanup.
