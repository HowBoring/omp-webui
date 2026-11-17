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
admission synchronously, cancel UI and public native queues/work, then share one
absolute 30-second cooperative deadline plus five seconds for SIGTERM before
SIGKILL if needed. A final one-second reader-only deadline bounds EOF observation;
it does not delay either execution signal. Native settlement, queue acknowledgement,
EOFs, tail notification counts, exit code and force are separate facts. Only the
stored Bun child handle is signalled and awaited; arbitrary PIDs and external TUI
owners are never kill targets. General extension-created descendant containment
is not attested.

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
