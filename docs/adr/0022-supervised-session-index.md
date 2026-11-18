# ADR 0022: Persist references and supervise one explicitly opened native worker

- Status: Isolated S1 component; normal private Session admission remains closed
- Ticket: #44
- Date: 2026-11-16

The Host persists a bounded metadata-only Session Index and reserves one worker
slot before asynchronous open work. The first explicit Open registers the selected
native source/instance/ID before revalidation; refusal retains that reference and
reason. Discovery, construction, browser refresh and Host restart do not create or
open native Sessions. A lost result stays unknown until a manual public state
observation or manual Open establishes a fact. There is no automatic replay.

Strict native startup owns exact-instance reservation and final ownership. The
Host checks the public returned binding and actual cwd; it does not reproduce
native storage interpretation or parse Session files. The combined RPC adapter
uses the same authored strict/Interaction/history schemas. Root Interactions can
therefore precede final Session binding without fabricating a DSH Session.

One active native Session has one RPC worker and any number of authorized views.
Different Session switches and explicit New are separate actions. A busy worker
or pending UI refuses New/Switch until Stop, proven quiescence and a fresh action.
Same-Session warm views remain available while busy. Confirmed-idle retirement uses
graceful EOF without background signal timers; an unconfirmed exit retains the
owned handle/generation and blocks replacement pending explicit #48 force policy. New exposes its
identity only after genuine native confirmation. Actual DSH controller/Conversation
presentation is a disposable read-only public native cut with `not_attested`
recoverability, independent of registration persistence.

Current login, effective directory grants, target directory object and generation
are checked at each entry and after asynchronous work. Logout withdraws only that
credential. Trusted revoke-all, lost effective root authorization and Host shutdown
close worker admission immediately and use one absolute 30+5-second execution
shutdown budget. Queue/UI cancellation acknowledgements, native settlement,
protocol EOF tail and child exit are recorded separately. The carrier's optional
drain policy leaves existing preflight/catalog/default shutdown behavior unchanged.
Only stored owned process handles are signalled; external lease owners and
arbitrary browser PIDs never enter process control.

General extension-descendant containment, ordinary Stop/force UI, prompt submission,
full projection rebuilding and the final production compatibility gate remain
separate component obligations. The isolated fixture cannot unlock those gates.

Source reconciliation renumbers this authored decision from 0015 to 0022 because
0015 is already assigned to retained execution/projection replacement. Historical
checkpoint manifests retain their original input path and hash; they are not current
source manifests. The supervised Session component remains unregistered and cannot
authorize production admission or an automatic direct-child cleanup fallback.

Source-review correction (2026-11-17): the durable-first Open records a bounded
prelaunch refusal even when its cwd disappeared or the previous owned worker is
still draining. Native/adapter failures are admitted through explicit code sets;
unknown or oversized codes cannot enter the 96-character attempt field. A failed
attempt write cannot bypass release of a definitely refused owned worker or
retention of a worker with an unknown outcome. Exit diagnostics retain a separate
`SESSION_ATTEMPT_UNAVAILABLE` observation when shutdown cannot save its attempt.
Both idle retirement and shutdown require zero exit, no force and no protocol
failure before persisting `closed`.

Attempt-order correction (2026-11-17): the metadata record carries a monotonic
attempt revision, defaulting legacy records to zero. An immediate SQLite
transaction compares the worker's last owned revision before replacing an
attempt. Explicit refusals advance the revision; stale startup, worker-loss,
idle-retirement and shutdown observations cannot erase a newer attempt even if
states or timestamps coincide. Actual worker cleanup, slot release and bounded
exit diagnostics proceed independently, including an unavailable idle-exit write.
Only the latest metadata attempt is stored; no transcript or attempt history is
introduced. Internal revisions are omitted from the unchanged DSH contract.

A fresh explicit same-Session Open can confirm its captured attempt revision while
sharing the surviving worker. Only a validated successful binding reacquires that
revision; an older in-flight Open cannot acquire a refusal recorded after it began.
Manual rechecks and background lifecycle observations retain their worker-owned
revision and cannot clear an intervening expired-selection failure.

The isolated Session carrier now preserves recognized typed lifecycle failures,
request correlation and constant recovery instructions through the public DSH
Remote contract. It rebuilds errors without native exception text, paths, details
or stacks; malformed envelopes remain HTTP rejections before invocation. The
public New endpoint resolves the service's `new` method. These changes are covered
only by FS/SQLite, public native-port and in-memory DSH regressions; they create no
new Native execution, descendant-cleanup or production-admission attestation.

The isolated Session carrier serves the registered Workspace page from the same
SQLite index and directory grants used for supervised Open. The public catalog
description supplies current metadata, ownership and directory access only when
its source, instance and native Session ID all match the stored registration.
Replaced references retain cached metadata with unknown ownership and access.
The registered page performs no worker action and keeps the other Workspace
endpoints on the standalone fixture carrier.

The retained helper path in `SessionWorker.attachOwned` reads the helper's actual public
RPC pipes and gates v2 negotiation on authenticated HELLO. It exposes readiness, Native
root exit, private domain completion and actual output observations through distinct
promises, including after setup or startup failure. Root exit or control loss closes
RPC admission and fences pending writes. The retained pipes continue reporting validated
tail framing and observed EOF independently of domain completion.

The Host caller retains the original helper control and cleanup authority.
Mandatory cleanup needs explicit handoff to the helper's absolute deadline and
Native input fence.

The retained connection can synchronously retire regular RPCs and stop live publication.
If a subscriber retires the connection during delivery, the frame counts as published and
delivery stops before the next subscriber.
After authenticated HELLO and v2 negotiation, its Host caller can obtain fixed strict-start
cancellation, abort and state operations on those same pipes. The first retirement fixes
the local monotonic cutoff, with a valid cutoff granting at most 30 seconds. Requests check
it before enqueue, at dispatch and when a correlated reply arrives. Pending regular replies retain bounded
correlation while validated notifications remain visible in the tail count. Abort receipt,
native settlement, helper completion and pipe EOF are separate observations.

The cutoff bounds the Host RPC capability. The helper still owns process control and requires
its own absolute-deadline handoff. Retirement during startup fences RPC and Native stdin.
The retained connection creates one InteractionBridge after authenticated v2
negotiation. Its first cleanup fence withdraws existing answer rights and timers,
then attempts a fixed public `respond_ui` cancellation for tracked extension UI on
the same connection. Root startup UI uses the same tracking before a Session
binding exists. The Bridge observes live notifications while the Session retains
replay before its first subscriber. An ACK already correlated before the fence
stays authoritative. A stale reply withdraws answer rights while other in-flight
commands can still supply a decisive ACK for the same Interaction.
The result distinguishes Native status from an unavailable lane, a failed request,
an invalid or missing reply, and the cutoff. Only `cancelled` and `expired` affirm
cancellation for a tracked request. Tail notifications, Native settlement, pipe
EOF and domain completion remain separate observations.

The isolated SessionSupervisor can reserve a generation and retain its original
owned RPC connection before awaiting readiness. Retirement calls that connection's
cleanup fence once with the original Host-local cutoff, including when the launcher
hands it over after that cutoff. Late readiness cannot start or bind the retired
generation. The bounded shutdown observation can return with ownership still
unresolved. Only the same connection's confirmed domain completion and natural
EOF on both readers release the slot. Root status, domain status and validated output
tails are reported as they are observed. Counts remain lower bounds when a published
counter or observed stdout EOF is unavailable or the transport records a protocol
failure. Late completion can release the slot
after the Session Index closes. The retirement records an unknown Session outcome
because proof of ownership release does not establish Native settlement or the
physical shutdown policy.

Owned idle Switch and New remain unavailable while an owned generation occupies
the slot. Production registration, the helper's absolute deadline handoff and
the separate S2 Broker integration remain pending.
