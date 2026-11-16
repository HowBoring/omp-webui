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
