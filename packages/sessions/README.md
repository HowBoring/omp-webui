# Supervised native Sessions (#44)

This is an isolated, unregistered S1 source component. The normal Host does not import its server or
open private Sessions. #41, accepted #43, the final matched DSH/native tuple and
independent component acceptance remain integration gates.

`SessionIndex` persists only explicit native references, source/physical-instance/
native identities, cwd/title metadata, verification time and the last attempt.
It does not store native history, prompts, tool outputs, trees, credentials or
Agent state. FULL SQLite transactions commit first registration before native
revalidation/startup. Different physical copies remain different registrations.
Failed references survive. An interrupted open restores as `outcome_unknown` and
requires manual Open; construction and catalog enumeration launch no workers.

`SessionSupervisor` reserves one top-level worker slot before asynchronous work.
Concurrent Opens of the same native identity await that same worker. Warm Views
share it. Switch, explicit New, View and manual outcome observation are separate
operations. New is registered only after public native startup confirms its new
identity; an unconfirmed New result remains unknown and is never repeated.

The combined `SessionWorker` validates strict, Interaction, supervision and history
public commands against generated schemas. It has no prompt sender. The root
`InteractionBridge` exists before `strict_start`; Session scope begins only after
the actual binding, canonical cwd and native held ownership are verified. Native
Session files and Agent SDK/runtime APIs are absent from Host imports.

Every protected action checks the current authenticated browser, directory grant,
actual directory object and worker generation, including after awaits. Browser
logout/expiry withdraws that browser's view/answer rights. Overlapping grants are
recomputed. Effective root revocation, trusted revoke-all and Host shutdown deny
admission synchronously. The direct path cancels UI and public native queues/work
using one absolute 30-second cooperative deadline plus five seconds for SIGTERM
before SIGKILL if needed. A final one-second reader-only deadline bounds EOF observation;
it does not delay either execution signal. Native settlement, queue acknowledgement,
EOFs, tail notification counts, exit code and force are separate facts. Only the
stored Bun child handle is signalled and awaited; arbitrary PIDs and external TUI
owners are never kill targets. General extension-created descendant containment
is not attested.

A direct launch still negotiating at shutdown keeps its reserved slot across the
same absolute deadlines. Once the cooperative deadline passes, only the same
returned worker can be drained using the remaining termination grace. An unconfirmed
launcher rejection retains the reservation. If the handle is still unavailable at
the force deadline, the supervisor reports unresolved ownership and keeps the
original completion available for cleanup. The direct shutdown report marks the
notification count as a lower bound when Stop precedes handle delivery. The isolated CLI reports
unsuccessful shutdown when ownership is unresolved and lets pending cleanup continue
after server teardown.

The isolated Supervisor also accepts an owned RPC connection before v2 readiness.
It fences the original connection at retirement with the first Host-local cutoff,
including when the launcher delivers the connection after the cutoff. A late ready
result cannot start the retired generation. Exit diagnostics expose the original
root status, private domain status and pipe observations as each becomes available.
Confirmed domain completion and natural EOF on both pipes release the slot. A
missing published count, unobserved stdout EOF or protocol failure marks the
reported notification count as a lower bound. The published count includes startup
notifications, and the transport separately counts validated tail frames after
its admission fence.

An authenticated v2 cleanup lane can cancel an unconfirmed StrictStart or send
the summary, retry, bash and queue aborts for an already verified Session. A
validated queue reply records withdrawal, and a separate decoded state for that
Session can establish Native settlement. These operations do not wait for the UI
reply. The Bridge confirms cancellation when every tracked request is cancelled
or expired, or when a confirmed lane has no tracked requests.

Ownership proof permits slot reuse while the durable Session attempt records an
unknown outcome. The helper's physical shutdown deadline, owned idle Switch and
New, and production registration remain pending.

The read-only DSH SessionController adapts the public native `LiveJournal` cut.
It reports `not_attested` recoverability and explicit unsupported native content.
There is no native history mutation, prompt replay, or claimed same-holder rebuild.
The pre-#40 client releases its full view before a manual replacement; #40's final
multi-holder rebuild remains an integration obligation.

Budgets: 10,000 registrations and 16 MiB total stored metadata; index page size
1–32, eight disposable snapshots, 30-second cursors; 1,024 opaque catalog choices
with a 60-second opening window; 32 concurrent unary calls, eight peers/four
logical streams per peer, 16 KiB HTTP/WS envelopes; 32 native pending commands,
256 KiB queued stdin, 16 KiB commands, 64 KiB stderr (byte count only); 32/256 KiB
pre-Bridge notifications, 64 subscribers, and each follow queue 256 frames/1 MiB.
Native framing/history budgets remain the matched public native contract. Invalid,
stale, overflowed or unknown non-ignorable input fails explicitly. These budgets
are safety bounds, not the umbrella MVP's unmeasured performance targets.

The accepted test seams are the actual authorized DSH browser/Bun/public-native
workflow, complemented by public native RPC/TUI and deterministic boundary faults,
plus controlled clocks for long expiry boundaries. Test fixtures are synthetic,
use an egress guard before native imports, and never use a real provider.

## Retained helper RPC attachment

Trusted Host code can attach the fixed Session RPC client to an existing
`PrivateHelperHandle` with `SessionWorker.attachOwned`. The caller keeps the original
handle and its cleanup authority. The attachment gives immediate access to the
original root exit and domain completion promises and to a separate output observation.
The ready promise resolves after authenticated helper HELLO and public v2 negotiation
on the retained Native pipes. A failed HELLO, negotiation or pipe attachment preserves
the caller's access to those original lifecycle promises.

Root exit and control loss fence RPC requests and queued writes. The readers still
check post-exit frames and report actual EOF on each pipe. A dispatched request can
consume one correlated late response. A malformed stdout frame records a protocol
failure while subsequent bytes drain without publication. Stderr overflow caps the
diagnostic count and continues draining. A reader failure can leave its EOF
unobserved. Domain completion comes from the helper's validated COMPLETE, control
EOF and reap.

The opt-in `launchOwned(cwd, retirement)` port supplies the generation's Host-owned
`AbortSignal` before launch preparation. A trusted adapter can forward it to
`PrivateHelperOwner.launch(input, retirement)`. Once a helper exists, the adapter
attaches and returns the original connection before awaiting RPC readiness, even if
retirement has already aborted the signal. The first retirement fences any attached
connection with the original Host-local cutoff and aborts launch preparation in the
same call. The reservation survives an unconfirmed launch rejection. The helper still
needs an acknowledged handoff of the absolute deadline for physical shutdown.
Controlled streams cover attachment and retention. Product admission remains blocked.

## S1-CHILD-OWNERSHIP-FOLLOWUP (#48 / #61)

**BLOCKED / not attested:** exercise a genuine native tool and a native subagent
that create child processes, then force this Host's owned worker out. Establish the
native-owned cleanup boundary from matched source plus actual runtime evidence.
If a legitimate supervised child survives, add a public ownership/containment
contract before claiming complete cleanup. Do not infer ownership from a PID tree,
kill arbitrary descendants, target an external TUI, or turn this component's direct
Bun-child reap result into a blanket descendant-cleanup PASS. Final integration
admission remains closed until the applicable gate is resolved.

## Source reconciliation (2026-11-17)

The component composes integration `42769489183eedb20b371083c49f915fda2bb8cf`
(#43 grants, #47/#48 Broker/Stop, #49 preferences, #50 Tree and #54 originals).
The retained SessionSupervisor uses its existing InteractionBridge/SessionWorker
boundary; the separate Broker/Stop, preferences, Tree and OriginalStore source
components are not newly registered here. Strict Host TypeScript and the selected
FS/SQLite/in-memory DSH tests pass; this does not attest actual Native execution,
Session cleanup, a current browser/native tuple or whole-ticket acceptance.
See [source evidence](../../docs/implementation/ticket-44-source-evidence.json)
and [ADR 0022](../../docs/adr/0022-supervised-session-index.md).

The old browser/busy Native/TUI results and unfrozen broad-check FAIL remain
historical. The original Native/DSH authoring, indexes, diffs and recorded bundles
were hash-checked unchanged. #41 helper ownership binding remains required before
attesting forced cleanup or any automatic fallback. No new global or private
Session admission is enabled; #44 and umbrella #29 remain OPEN.

## Source-review corrections (2026-11-17)

Explicit Open keeps a stable failed attempt for a missing/replaced cwd or an
owned worker still draining, after the native reference is durably registered.
Each persisted attempt has a monotonic revision. Worker lifecycle observations
commit atomically only against the revision they own, so an older idle drain,
shutdown, lost-worker or startup completion cannot replace a newer explicit Open
reason, including operations at the same clock value. Worker exit diagnostics
and slot release remain independent of that latest registration attempt; an idle
exit also retains its drain diagnostic when saving the attempt is unavailable.
The revision is internal metadata and does not change the browser contract.
Native/adapter error codes come from an explicit bounded vocabulary. Unknown and
oversized failures remain bounded unknown outcomes. If saving a failure itself
fails, definite refusals still release the owned worker; unknown outcomes retain
that worker for manual observation. Shutdown diagnostics separately expose an
unavailable attempt write. A protocol-failed tail prevents a `closed` index
outcome even when the child exits zero without force.

The isolated carrier returns recognized typed DSH errors with constant recovery
instructions and the original request ID. Busy New/Switch explains the required
Stop/quiescence/fresh action; an unconfirmed New explains manual observation even
before it has any registration. Native exception text, paths, arbitrary details
and stacks are withheld. Malformed envelopes remain HTTP rejections. New uses
the declared service method, so the real Gateway reaches the same supervisor
policy as Switch.

The [review-fix evidence delta](../../docs/implementation/ticket-44-review-fix-evidence.json)
preserves the previous source evidence by immutable pointer. The added tests use
FS/SQLite and public native ports plus the actual shared carrier and DSH
Gateway/Connection in memory. The root UI, browser-only logout and one shared
worker/generation remain covered. All historical Native/browser results and
#41 cleanup/admission limits above remain unchanged.

The subsequent [attempt-order evidence delta](../../docs/implementation/ticket-44-attempt-order-evidence.json)
covers completed idle retirement, stale startup completion, same-clock revision
ownership and independent exit diagnostics. The selected pure checks pass;
fresh independent source/spec and Standards review remain required before Root merge.
