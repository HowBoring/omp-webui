# Ticket 41 execution ownership source preparation

Status: **INCOMPLETE / NO RUNTIME OR GLOBAL CAPABILITY**. This checkpoint implements the first public contract
slice of [ADR 0018](../adr/0018-native-execution-ownership.md). It does not complete #41, #48, #61 or any private admission gate.

The reproducible source identity is [execution-ownership.preparation.json](../../compatibility/omp/execution-ownership.preparation.json).
The patch applies after the exact stable six Native patches listed there. Patches 7–9 are deliberately absent from
this preparation; `scripts/omp-source.ts` and the active/final compatibility tuple are unchanged. Do not call this
a composed final 1–10 build. The canonical Native cache was read only; changes use an owned lightweight sparse clone.

Authored Native public source comprises strict request/response/schema validation, bounded UTF-8/LF framing,
immutable-registration client, dispatcher decisions and helper durable-fence/publication permits. The experimental
`--execution-dispatcher` selector explicitly refuses with `ownership_backend_unavailable` before the normal runtime
graph. The selected OS/storage/server transport does not yet exist. The same-source C/FFI bridge prepares direct
socket ownership, actual SO_PEERPIDFD/credentials, retained/revalidated ancestry, generational opaque handles and
aggregate descriptor limits. Strict compilation and one bounded actual socket/pidfd fixture passed. It grants no
signal/wait authority or backend capability; [the scoped primitive report](ticket-41-ownership-kernel-primitive.json)
records the exact library/compiler/source/trace identities and remaining gaps.

The accepted seams remain public Native module/schema behavior, then actual public CLI/RPC/TUI and real browser
acceptance. Current tests use synthetic disk/kernel facts at the system seam and pure wire exchange; those fixtures
prove decision behavior only. They do not establish actual ancestry, env-i classification, service preservation,
maintenance protection, worker cleanup, actual provider/tool behavior or a production dispatcher. The separate small
OS fixture establishes only its recorded socket/pidfd primitives, including a self-peer direct-parent negative.

| Check | Actual result | Scope |
| --- | --- | --- |
| Pure ownership module and owned filesystem tests | PASS: 34 tests, 120 assertions, 10 source files / 1 wrapper, 130 ms; 1 OS case skipped | Guard + synthetic environment before imports; no CLI/Agent/provider/kernel calls |
| Public request/response/helper/authentication schema corpus | PASS: 11 request + 8 response + 5 helper + 9 authentication cases | AJV 8.17.1, strict request/helper/challenge decoders; reply signature evidence separately in pure tests |
| Focused source type check | PASS: `bun check --no-script`, 22 files, 0 errors, 116.76 ms | New ownership TS/test files only; C and CLI graph excluded |
| CLI/runtime/main syntax parse | PASS: 3 owned TS sources | Bun transpiler only; no entry import/execution or full graph type claim |
| Host repository type check | PASS: `bun run typecheck`, exit 0 | Host source compile only |
| Ordered patch application | PASS: private index, base + 1–6 + 0010 | Prepared tree recorded in identity JSON |
| Whitespace check | PASS: owned Native diff and repository diff | Source only |
| C bridge strict compilation | PASS: zero diagnostics; 21,608-byte ABI 1 library | Independent compiler/source/artifact identities recorded |
| One actual Unix socket/pidfd primitive fixture | PASS: 1 test, 10 assertions, 50.25 ms; runner 140 ms, wrapper 155 ms | Three actual SO_PEERPIDFD successes, 0 traced INET socket/endpoint calls; no child/CLI/Agent |
| Positive helper parentage, dead/foreign peer/resource faults, lifecycle | NOT RUN | No broader OS clearance or backend capability |
| Corrected actual dispatcher CLI | NOT RUN | Requires pre-import guard + isolated environment before any Native import |
| All-mode broker client no-auto-spawn and broker publication entry | NOT IMPLEMENTED | Baseline still auto-spawns; no claim from new module alone |
| Consumer policy, private LSP/blob and mandatory attachment paths | NOT IMPLEMENTED / NOT RUN | Mandatory stories retained |
| External broker/service lifetime protectors | NOT IMPLEMENTED / NOT RUN | Private helper EOF policy cannot preserve external services |
| Final actual-global tuple, TUI/data/rollback and private admission | BLOCKED | Operator entry missing; final Native/DSH composition unfinished |

## Reproduction

Apply exactly the manifest's six base patches and `0010-execution-ownership.patch` to an owned checkout at the
recorded Native base. Do not modify a running/canonical build. From the Host repository with the pinned Bun, run:

```sh
bun --no-env-file scripts/check-ownership-preparation.ts <owned-native-checkout>
bun --no-env-file scripts/validate-ownership-preparation.ts <owned-native-checkout>
```

Despite its filename, `execution-ownership-cli.test.ts` imports only `launch/ownership/entry.ts`, which refuses
before any runtime import; it is not actual CLI acceptance. The source checker creates a fresh synthetic HOME,
profile, XDG and cwd, passes an allowlisted environment, preloads the guard before any Native module, imports the
ten test sources through one temporary wrapper and deliberately omits the kernel fixture input. It also type-checks
only `src/launch/ownership/*.ts` and `test/execution-ownership*.ts`, with strict
mode, Bun types, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noEmit` and bundler resolution.

## Recovered process context checkpoint

The second-reattach checkpoint preserves the previously uncommitted process context/bootstrap and durable filesystem
adapter. The five public functions and their effect ordering are documented in the Native patch's
`docs/execution-ownership.md`. They are fixed for downstream consumer integration: pure `getExecutionOwnership`,
single-flight asynchronous `initializeExecutionOwnership`, synchronous `requireExecutionOwnership` and
`requireSharedExecution`, and asynchronous matched `acquireExecutionBroker(scope)`. The bootstrap remains an explicit
`ownership_backend_unavailable` refusal. No normal/strict CLI graph, SDK factory, worker entry, broker client or
consumer has been switched to it in this checkpoint. SDK eager import purity is not established.

The source suite proves immutable private registration/single-flight, shared denial before another wire request,
unavailable bootstrap without fallback, matched-grant failure revoking the context, and an actual synthetic-directory
incomplete fence surviving dispatcher state loss. The filesystem test uses synthetic OS facts at the public dispatcher
seam; it does not prove a real helper, lease, process extinction or completion acknowledgement. This recovered source
was already authored before reattachment; its initial RED history is unavailable, so no new RED→GREEN claim is made.
The recorded 17/58 source result and scoped socket primitive remain historical evidence for their original inputs.
The recovered 21/76 and 18-file check apply to checkpoint `df21a34`, with the OS test deliberately skipped.

## Signed replies and bounded consumers, source only

The subsequent source checkpoint implements the coordinator-approved asymmetric authentication direction in
ADR 0018. The server still requires actual client/helper SO_PEERPIDFD; a Bun worker client instead verifies a fresh
nonce/request-bound Ed25519 reply against independent operator public-key approval. A signature is not a global
provenance/lifecycle/admission receipt. The operator record, selected-installation transport/backend, actual server,
worker early-message proof and external protectors remain absent/unproven. `bootstrap` and dispatcher entry still
refuse before normal runtime effects.

Public pure wire tests cover a valid known RFC 8032 fixture key, reply replay, all signed-field alterations, a wrong
operator pin, changed server generation, concurrent challenge refusal and close during asynchronous verification.
Public schema cases check authenticated envelope shapes; dummy schema signatures are not cryptographic proof.
The process context serializes up to 64 broker acquisitions with a total 10-second queue/dispatch deadline, snapshotting
the requested scope before an await. Queue overflow refuses only excess unstarted requests. Wire failure/active timeout
revokes context and drains the queue without retry; the wire client enforces abort and prevents dispatch after close.

Recorded vertical source RED→GREEN: storage retirement method absent→owned generation retirement; awaited broker
scope mutation returned `/work/replacement-project`→retained `/work/requested-project`; absent authentication module→
signed fresh request; close during verification resolved an authentic reply→typed refusal; parallel consumers failed
`ownership_limit`→their independent matched grants; close before queued transport dispatch recorded one request→zero.
The final current 31/114 result includes the 64-admitted/65th-refused queue case and synthetic filesystem reopening after
storage-only retirement. These results make no actual socket, helper extinction, CLI, Native Agent or global claim.

## Early worker and CLI source gate

Normal and strict CLI source now await ownership initialization before importing their normal runtime graph; the
public `main` function does so before inference registration. Catalog and safe preflight skip initialization. Because
the selected-installation bootstrap is still unavailable, normal entry remains blocked rather than loading a fallback
graph. These entrypoints are only syntax parsed here: actual CLI/provider/network behavior is NOT RUN.

The pure entry installs a worker delivery buffer synchronously, before registration's first await. Its parent-port
adapter hands pending events to the upstream central WorkerInbox exactly once, and stats global events replay into
the runtime's synchronous early handler. Source tests create synthetic delivery ports and exercise before/after
handoff, stats replay, cancellation and budget refusal. The limits are per channel (parent-port/global, two channels):
64 messages and 64 MiB logical payload, plus 65,536 visited values/depth 64 per payload. Backing buffers, SharedArrayBuffer
and public transferred MessagePorts have explicit accounting; this is not a claim to bound Bun's internal transferred-port
queues or total worker heap. No Worker/MessageChannel/subprocess/socket is constructed in these tests.

The updated current result is 34 PASS / 1 OS SKIP / 120 assertions, 22 focused type-checked files and 3 syntax-parsed
entrypoints. Actual Bun early-message delivery, shared-buffer/MessagePort transfer, parent-owned subagents, source/bundle
behavior and no-provider proof remain required in the later supervised runtime window.

Compile only with `bun --no-env-file scripts/build-ownership-bridge-preparation.ts <owned-native-checkout>
<absolute-owned-output-parent>`. It uses a unique output directory, fixed strict compiler/linker flags and an
allowlisted compiler environment, records compiler/source/ABI/artifact/NEEDED identities, and does not load/probe
the result. The dynamic `libc.so.6` dependency is not a complete platform-library stability proof.

## Scoped actual socket/pidfd proof

The coordinator cleared one bounded harmless OS fixture. It used synthetic HOME/profile/XDG/cwd and an allowlisted
environment before imports, the pre-import egress guard, the exact independently identified library and strace network
capture. The successful actual invocation ran `bun test` first, then `--no-env-file`, `--config=<reviewed bunfig>`,
`--preload=<no-provider guard>`, and `./bridge.test.ts` in the synthetic cwd. That wrapper contains only a static import
of the owned `execution-ownership-linux.test.ts`. An explicit build-manifest fixture input enables this normally skipped test.

The test loaded ABI 1, ran the actual socketpair probe and local listener/connect/accept, retained actual peer pidfds,
checked same/live self identity, refused a self-as-direct-child relationship, traversed verified external ancestry,
transferred exact bounded bytes, released peer/socket handles, observed the bridge's owned descriptor counter return
to zero, closed the library and removed its unique socket directory. The process exited 0 with no child process.
Trace records three successful SO_PEERPIDFD calls and no AF_INET socket/endpoint activity. This proves neither
positive Host/helper parentage nor private cleanup. Broader FD/fault/foreign-death evidence and independent OS FD
census are still needed. The separate private-helper candidate backend/containment result is owned by its supporting
component; this socket result supplies no `/proc/.../children` availability or helper lifecycle proof.

Two earlier harness invocations never reached the fixture: preload-before-`test` made Bun treat `test` as a script
(exit 1, 23 ms), then an absolute vendor test filter matched no files (exit 1, 114 ms). Both used the synthetic
environment and are retained as harness failures, not Native/kernel failures or passes. The successful synthetic-cwd
wrapper corrects both issues. No actual CLI was restarted in this kernel window.

## Failed pre-guard entry attempt, retained separately

An initial RED test imported public `runCli(["--execution-dispatcher"])` before that selector existed. It fell through
the ordinary runtime import under inherited HOME, without the required pre-import egress guard or synthetic profile.
The observed result was **FAIL: 0 pass / 1 fail / 1 assertion, 1.460 s**, error
`EROFS: read-only file system, mkdir '/home/agent/.omp'`. That test was removed and no actual CLI restart occurred.

The denied mkdir is not evidence of no earlier reads/dispatch. No filesystem/network trace was captured. A read-only
source audit found the reachable ordinary bootstrap imports proxy/AI/utils code and may eagerly parse home/config/
agent/cwd `.env` paths before later initialization. Exact prior config/credential reads and network/provider dispatch
are **UNKNOWN**. No private contents were inspected during the audit. No global installation or unknown process
was changed/killed. Future entrypoint negatives must launch with the pre-import guard, explicit synthetic HOME/
profile/cwd and an allowlisted environment **before any Native import**, even when testing a missing selector.

## Next bounded slices

Implement authenticated fixed-rendezvous transport and durable dispatcher storage, finish helper registration with
actual helper peer pidfd before START, then remove every compatible client-side broker spawn/reconnect fallback.
Add broker generation publication checks and guard every shared consumer before effects. External protectors need
an explicit preservation policy and independent lifetime protection. The supporting private helper/Host adapter is
owned separately and must be combined/reviewed with this Native contract; a standalone helper result is no private capability.

After source/build preparation, first run bounded harmless OS proofs in a coordinator-cleared window. Actual Native
bash/background/subagents, nested env-i denial, independent external TUI/service preservation, private LSP/blob and
all attachment scenarios precede compatibility admission. Keep actual Windows/WSL2 owner-deferred and unclaimed.
