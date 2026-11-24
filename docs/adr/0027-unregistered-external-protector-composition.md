# ADR 0027: Unregistered external protector source composition

- Status: Source candidate; fresh full composed Spec and Standards review required
- Date: 2026-11-17
- Tracks: #29 Decision 26; #41 external source component only

Compose the narrow external controller, fixed broker launch, separately built C protector and shared builder from
`bcbc30e9532e404fb27fc63ceb85c07de335c46f` over integration
`fe8a24afcbff02edaa9988349c32e87ce081bd99` (tree `f4ad103dda4d25e7f97130505812993bd6161569`).
The earlier external-source frontier's missing H/P prerequisites are now present with paired SOURCE GO review.
That resolves the prerequisite source hold only. Historical external reviews cover their stated original deltas;
none reviews this new composition. The [selection manifest](../evidence/ticket-41-external-composed-selection.json)
records exact path allowlists, source blobs/hashes, integration preimages and retained dependencies.

Preserve current H delivery verification byte-for-byte: exhaustive immutable inventory, recursive ELF/platform alias
closure, serialized sticky verification and the original retained selection lifetime. Preserve public P's authoritative
`ControlSocket` alias, production loader/owner and private controller. Its untransferred raw-close callback is consumed
before one close attempt; completion requires clean EOF, serialized decoder finalization and successful original reap.
The latest external controller already has these raw-close and EOF corrections. No older private controller or Host
control-I/O shim is copied. Both controllers retain unknown startup/registration/close outcomes as unresolved.

Adopt the complete external-enabled shared C source and `candidates.h`, rather than the wrapper alone. Policy selection
is compile-time through the distinct external C entry. External builds exclude private signal delivery, candidate
enumeration, cleanup commands and escalation. Control EOF, dispatcher loss and protector signals never authorize
external child cleanup. The only root exec is the fixed ordinary entry with `__omp_worker_daemon_broker`; supplied
generation/scope hints are never authentication or publication authority. Native registration/publication is absent.

External completion requires original authoritative reaping and matching dispatcher ACK, then queues COMPLETE once,
fully flushes it while healthy, rechecks sticky health, removes/fsyncs the fence and exits zero. The controller treats
COMPLETE as provisional until clean control EOF and successful original protector reap. Private builds retain their
separate existing EOF mandatory policy and private finalization behavior; adding external safety conditions does not
silently rewrite private semantics. The base-to-selected C diff consists of compile-time external branches, fixed
private wire/fence constants behind macros and equivalent private statement formatting. Syntax checks are no runtime
or assembly-equivalence proof. Historical private assembly comparison is confined to its old configuration/artifacts.

The two explicit builders share validation, configuration, compilation/publication and maintenance cleanup. Current H
`maintenance.ts` is byte-identical to the external source dependency. The shared builder still acquires `use`, verifies
the lease after publication and releases in the nested finally after temporary cleanup, including failure paths.
It preserves private public error categories and gives external output/provenance distinct fixed names. Builders
retain maintenance's static FFI dependency and are never evaluated here. Their public refusal suite is selected but
NOT RUN; only controller/launch and existing reviewed public P fake suites are executed after import inspection.

Changing shared C/build source requires new builds, complete source/configuration provenance, independent approval and
later authorized runtime evidence. No old private or external build identity or signed approval is valid for this tuple.
Historical evidence, opt-in C fault fixture and historical static checker are retained for review only. The historical
checker emits ELF and is deliberately NOT RUN in this syntax-only window.

This component remains inert and unregistered. Root entry/scripts/dependencies, OMP pins/active patch set, DSH/schema
and admission are unchanged. No Native backend, Host integration, dispatcher registration, source-ancestry merge,
actual C/helper/library/FFI/kernel/socket/process/signal/browser/seed/staging/key/global-install or GitHub action is
included. Pure fakes, full TypeScript and strict C syntax-only checks establish only their stated source properties.
Whole #41/#61 and product/private Session admission remain OPEN/BLOCKED. Stop after the candidate commit for fresh
full paired review; actual runtime work needs its own authorization and exact matched artifact evidence.
