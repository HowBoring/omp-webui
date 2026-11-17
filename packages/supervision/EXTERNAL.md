> Historical/source selection from external `bcbc30e9532e404fb27fc63ceb85c07de335c46f`. Results and review claims below apply only to their original artifacts. This new H/P/external composition is unregistered and requires fresh paired review; see [ADR 0027](../../docs/adr/0027-unregistered-external-protector-composition.md). No actual runtime or admission proof is supplied.

# External broker-tree protector (#41 / #61)

Status: source preparation only. No external/Native/kernel/global acceptance or product admission is granted.
The actual Native dispatcher, independent approval/authentication, publication, spawn and integration are owned by
Native patch0010; this module supplies the separately built protector and its mechanical process/socket contract.

The selected actual dispatcher may create one `omp-external-protector` per prepared `broker-tree` generation.
It is a distinct executable, binary approval and compile-time policy. `external-protector.c` shares mechanics with
`private-helper.c`; the build excludes all private cleanup commands, signal delivery, escalation and candidate
enumeration. No argv/environment flag selects policy in `omp-private-helper`. The private launch/control API and
policy remain unchanged. Changed shared source still requires new final approval/rebuild; the frozen old candidate
has not been mutated. Static optimized private assembly comparison is a limited code-generation check, not runtime proof.

## Dispatcher-only construction

The fixed protector invocation is `[<release>/bin/omp-external-protector, generation]`, with trusted connected
stream socket fd3 and dispatcher-validated cwd/environment. The helper itself forks exactly once and execs exactly
`[<release>/bin/omp, '__omp_worker_daemon_broker']`. The selector was verified against the actual selected Native
`src/cli/worker-selectors.ts` and `cli-runtime.ts`. No browser/ordinary-client executable or argv interface exists.
The ordinary approved global launcher adds its pinned runtime/config/worker entry as usual.

`externalBrokerLaunch` only constructs this fixed tuple and canonical environment hints:

- `OMP_EXECUTION_BROKER_GENERATION`:64 lowercase hexadecimal characters.
- `OMP_EXECUTION_BROKER_SCOPE`:canonical JSON `{kind:'project',directory}` or
  `{kind:'global',service:'browser-relay'|'text-predict'}`.

Hints grant no authority. Dispatcher INTERNAL `prepare_external {generation,kind:'broker-tree',scope}` must bind the
actual pending launch, independent external binary approval and validated/pinned cwd/runtime directory before spawn.
It must never become an ordinary client operation. Native must ignore inherited legacy runtime/token hints and
require authenticated dispatcher publication against the actual held broker peer/protector/generation/scope BEFORE
mkdir/token/listen. Scope validation and service-consumer restrictions remain Native0010 obligations.

The controller receives an OS process/socket adapter, retains ownership immediately after spawn, and exposes ready,
direct protector reap and combined completion promises. `registerHeldProtector` must verify the actual authenticated
server-held registration before START. Claimed HELLO PID/starttime values are identity hints; neither callback typing
nor a pure test proves real pidfd/parent/executable/installation authentication. Disconnect never sends cleanup.
Transport construction/registration/EOF/protocol errors keep a retained unresolved handle; late registration cannot
release START. If construction leaves the raw control fd with the controller, its close callback is invalidated
before one attempt. A throwing close remains unresolved and is never retried, including by later disconnect or
completion failure. An incomplete report is sticky even if subsequent frames claim success. There is no stop/force API.
COMPLETE received before verification finishes is rejected at receipt time, including while the verification promise
is held. EOF/close before verification finishes and any incomplete report also fail at receipt time, so deferred
frame processing cannot release a late START or successful readiness. After startup, clean EOF stays ordered behind
previously received frames so a valid ROOT_EXIT and COMPLETE can finish processing before successful completion.
Only an `end` event supplies clean EOF; decoder finalization must accept every received byte, including trailing
partial frames. A `close` without prior `end` is unresolved even after exact COMPLETE and successful direct reap.
Duplicate `end`/`close` notifications after clean EOF do not repeat terminal processing. Error or explicit disconnect
before direct reap remains a sticky failure, including after a provisional COMPLETE and clean EOF.
All decoded external protocol validation runs synchronously at receipt, before the registration promise can resume.
This includes forbidden private phases (`ordinary`, `cooperative`, `term`, `kill`), duplicate HELLO/ROOT_EXIT,
HELLO identity mismatch, events before HELLO, events after COMPLETE and premature COMPLETE. The receipt validator
tracks wire order separately from asynchronous registration and provisional completion; valid waiting/running states
and ordered ROOT_EXIT/COMPLETE retain their existing semantics.

A single valid ROOT_EXIT closes startup without being a malformed frame or sticky control failure. Receipt rejects
pending readiness with `EXTERNAL_UNRESOLVED`; successful later verification cannot release START for that dead root.
If START has already been written but its local write callback is pending, root exit still rejects readiness before
the callback can report startup success. The local callback is not evidence of peer delivery or execution.
Healthy control remains held: once independent verification has completed, ordered COMPLETE, clean EOF and successful
direct reap can still resolve `completed` even though `ready` rejected. Startup and terminal completion are separate
outcomes. COMPLETE received before verification finishes retains the existing sticky `EXTERNAL_PROTOCOL` rule;
neither root exit alone nor late verification retroactively authenticates that premature terminal receipt.

## Wire and lifecycle

The protector connects its compiled installation endpoint. ASCII canonical JSON+LF is bounded to512 bytes inclusive,
version `omp-execution-external/1`, separate from private-helper wire. Independent random request IDs are64 lowercase
hex, differ from generation and each other. Exact request property order:

```json
{"version":"omp-execution-external/1","id":"<64hex>","installation":"<64hex>","operation":{"op":"register_external","generation":"<64hex>"}}
```

`complete_external` uses the same held socket and a distinct ID. Exact successful ACK property order:

```json
{"version":"omp-execution-external/1","id":"<matching64hex>","ok":true,"operation":"register_external","generation":"<matching64hex>"}
```

Registration is acknowledged only after server SO_PEERPIDFD verification, actual direct dispatcher parent,
independently approved external executable/installation, prepared scope and server durable fence. A fake ACK alone
cannot authorize Native publication. The trusted fd3 control uses the bounded existing HELLO actual identities,
START/STATUS and STATE waiting/running/incomplete, ROOT_EXIT, COMPLETE grammar; private cleanup commands are rejected.
HELLO follows subreaper setup, shared maintenance lock, fsynced `omp-external-incomplete/1` fence, actual root pidfd,
active registration ACK and the held pre-exec barrier. START also requires a healthy registered state.

The entire broker-created tree remains in the protector's exclusive normal-parentage wait domain, including services
surviving broker-root exit. Root exit closes helper spawn admission; it neither releases protection nor kills children.
No external TERM/KILL path exists. Control EOF, dispatcher loss, parent loss and signals delivered to the protector
never authorize child signals. Uncertainty is sticky and retains protector/fence/lease. No reconnect/recovery or
intentional external shutdown contract is invented. A future intentional shutdown needs a separate authorized contract.

Completion requires actual root reap, closed helper spawn admission, authoritative `waitid(P_ALL, WEXITED|WNOHANG|__WALL)`
ECHILD, matching dispatcher `complete_external` ACK, healthy observers/control, and successful fence removal/fsync.
The external finalization path queues COMPLETE once and retains the protector, fence and shared maintenance lease
through pending/partial writes and EAGAIN. A write failure is sticky and never releases protection. After the full
queue flush, finalization rechecks sticky health/control before removing and fsyncing the fence and exiting zero.
The received COMPLETE frame remains provisional until successful direct protector reap; the controller cannot infer
fence finalization from the frame alone. Private EOF cleanup has a separate intentional policy and remains unchanged.
Zero siginfo, root exit, scans, elapsed deadlines or protector reap alone cannot replace these facts. One protector
is sufficient only when ALL external mutable-release lifetimes are provably in this tree. Services/delegation outside
it remain unavailable. The Host owns/signals no external root. Same-UID hostility, ptrace and PID namespace/reparent
manipulation are outside the supported policy, which is not an OS sandbox.

## Separate build and approval

`buildExternalProtector` is an explicit operator source builder. It refuses enrolled releases or an existing external
binary before acquiring controls, compiles to temporary output, and exclusively publishes these separate records:

| Approval member | Release member |
| --- | --- |
| `binaryDigest` | `bin/omp-external-protector` |
| `sourceDigest` | `provenance/external-protector.c` |
| `sharedSourceDigest` | `provenance/external-protector-core.c` (audited `private-helper.c`) |
| `candidateSourceDigest` | `provenance/external-protector-candidates.h` |
| `controlSourceDigest` | `provenance/external-protector-control.h` |
| `configurationDigest` | `provenance/external-protector-configuration.h` |

Distinct external provenance names allow both protectors in the same fresh release. The C entry/configuration pins
installation, fixed ordinary global entry, dispatcher endpoint, maintenance inode and outside-release fence inode.
The builder never enrolls approval, installs globally or launches a protector. No selected global release or operator
approval exists for this increment. Source provenance member names are audit records; compile from the repository's
original include layout with the recorded configuration, rather than treating the flattened audit records as a checkout.
The private and external builders share release/path/inode validation, configuration serialization, compiler/publish
mechanics and temporary/maintenance cleanup in `scripts/supervisor-build.ts`. Their entry points keep explicit separate
binary/source/provenance names and error categories; independent approval records remain outside the build mechanics.

## Evidence scope

Pure tests exercise the already approved public supervision process/socket seam using controlled OS adapters, fixed
launch construction and pre-build refusal paths. They establish ordering, bounded failures and unknown-state handling;
they do not establish kernel wait/adoption, real ancestry/authentication, lease durability or Native service behavior.
`python3 scripts/check-external-protector-static.py` compiles both static C policies with strict warnings, verifies
excluded external private definitions and compares private optimized assembly to5608 under one synthetic configuration.
It never executes either built target. Full current TypeScript checking is separate. See the evidence report for results.

`tests/supervision/fixtures/external-write-fault.py` stages two opt-in actual C/fd3 scenarios, **NOT RUN** in this
source-only increment. `backpressure` fills the real stream send queue before the synthetic complete ACK, checks
retained process/fence/lease, then drains and expects successful finalization. `write-error` makes the actual peer
refuse reads and checks sticky retained protection; the independent existing retaining parent performs fixture-only
cleanup afterward and leaves fence records intact. Both require fresh coordinator runtime clearance. The fake
dispatcher ACK is an external-system fixture and supplies no Native ancestry, binary approval or publication proof.
