# #34 coherent history: isolated Linux evidence

This is an S0 synthetic fixture candidate. Private product Session admission stays blocked. The native API,
source hooks, fixed budgets, readable mapping and cursor semantics are specified in
[HISTORY.md](../../compatibility/HISTORY.md). The final identities and measured results are in
[tuple.json](../../apps/history-fixture/evidence/tuple.json); the actual browser report is
[linux-browser.json](../../apps/history-fixture/evidence/linux-browser.json). Earlier records remain under
`apps/history-fixture/evidence/checkpoints/` and do not attest the current source.

## Acceptance coverage

| Criterion | Delivered behavior and proof |
| --- | --- |
| AC1: coherent cut/version/scope/expiry | Real native `captureHistoryObservation` serializes and hashes one synchronous observation after installing an independent native change listener. Entries, runtime context/messages/prefix, source binding, actual leaf and observation watermark share that cut. Pages retain immutable serialized DTOs. Reentrant mutation, runtime-only context changes, source rebinding, expiry and old workers have negative proofs. Every cut says `durability: not_attested`. |
| AC2: bounded and complete pagination | Explicit entry/item/page/response/scan/time/cache/TTL limits; rejection rather than truncation. Lossless text continuations and bounded retained-image content handles. All 10,000 entries in a native corpus over 100 MiB are reachable, as are eight retained 4 MiB image representations plus 5 MiB text. Single-item/cache/deadline failures are tested. |
| AC3: distinct native views | Full tree uses append order, active scope follows actual parents, running scope uses current Agent messages/prefix. Retained compaction/reset boundaries remain readable and expandable. Background/abandoned branches are visible only in the appropriate view. No exact provider-input membership claim. |
| AC4: observable changes/faults | Same leaf/count payload rewrite, delete/reparent/leaf round trip, compaction/reset, corrupt/partial loader, oversized items, gaps and stale/released/foreign cursors explicitly reject or expose the native fact. Public native rename and stop/reopen of the same persisted synthetic Session reject old cuts. |
| AC5: actual public path | Authored native wire/schema/server, handwritten/public/generated clients and generated validators; real public RPC mutation fixture; genuine Bun bounded stdio transport; Linux Chromium through DSH typed Remote to the real native worker. Browser uses one cut across active/tree/running scopes and previews native retained image bytes. |

Native content mapping exposes only meaningful readable facts or structural markers. Hidden extension/configuration/
credential/provider state participates in versioning but is absent from browser DTOs. Host imports no private native
runtime and parses no Session files. Retained native image availability is distinct from exact Attachment Original
association, which remains unproven. Memory observation is distinct from durable commit and #35 settlement.

## Reproduction and provenance

Use Bun 1.4.4 and the fixed source pins. The workspace reuses the verified #30 native dependency cache and reviewed #39 DSH candidate read-only
and a matching-lock #33 Host dependency cache; owned checkout/assets stay under ignored `vendor/`.
The final integration merge also includes #39's DSH provenance tests. Those mutation tests use a separate owned
source-only DSH candidate clone at `vendor/dsh` (no dependency copy); they never modify the shared build cache.
Provide such an owned baseline/candidate clone, or set `DSH_SOURCE` to an owned clone, before running the complete
repository suite.

```sh
bun scripts/prepare-compatibility.ts --reset --source-only
bun scripts/build-compatibility.ts
bun scripts/build-compatibility.ts --check
bun run check
bun apps/history-fixture/build.ts
bun scripts/prove-history-browser.ts
# Optional full native diagnostic gate (known upstream errors, not a green gate):
bun --no-env-file check --no-script -p vendor/omp/packages/coding-agent/tsconfig.json
```

The 141-test full suite (1,370 assertions) passed on integration `e65f0a8b`. The final current-integration
`9d5e5eb1` merge adds #39's DSH source gate. Its three new tests (five assertions), strict authored typecheck,
Host build, and another clean ordered native reset/build/schema check pass after that merge. Native source/schema and consumed history browser asset identities remain unchanged.

A subsequent source-gate audit found the history builder still required clean HEAD, which rejected the exact declared
DSH candidate. It now requires canonical `verifyDshSource(actualResolvedRoot, "candidate")` and persists its full
identity. Current reader proof uses candidate tree `c0b09e15c170a82894608c397a363a7a96e5d05c`, canonical identity
`d4790e8b7740b1541b9254a3e0802e959b49964ed58f08e4bf5a7d26f0000538`. The actual eight-page browser proof,
three provenance tests on an owned candidate reconstruction, strict typecheck and Host build pass again. An
undeclared consumed-source edit in that reconstruction makes the actual builder fail; the edit and own temporary
package link were restored. Shared runtime source was never mutated. Per-package links are owned by this worktree.
Native10k/stress/full-suite runs were not repeated for this gate-only change. The prior baseline reports are retained
as `checkpoints/b5d7ed7-baseline-*`; they do not attest the current candidate source. Current full per-input build
manifest is [dsh-build-manifest.json](../../apps/history-fixture/evidence/dsh-build-manifest.json).

Actual browser/native commands require this environment's local network allowance for loopback, Bun stdio
socketpairs and native Unix lock sockets. Fresh synthetic HOME/profile and allowlisted environment are established
before native imports. The no-provider preload blocks network dispatch including preconnect; fixture model hooks
hard-fail. The wrapper drains/reaps the owned worker and deletes the synthetic profile in `finally`.

The real browser report covers same-cut paging, folded retained boundaries, native image preview and hidden-state
exclusion. Its stale-cursor case is explicitly an intercepted public Remote fault. Separate native tests prove
actual stale/foreign/old-worker and mutable-payload failures. Browser screenshots and full logs remain in ignored
`vendor/`; their SHA-256 values are recorded in the tuple.

The first final full-suite run had 140 passes and one catalog fault-test failure: under syscall tracing the first
bounded catalog window returned `scanning` before reaching its row. The test now follows explicit continuation
cursors before asserting the injected ownership error. This is a test-only correction; native API/source behavior
was unchanged. A second run exposed a different catalog proof assumption: a queue can move directly from all timeouts to
all queue refusals, without a mixed wave. The public fault peer now has a pre-ready SIGUSR1 release latch. The
test collects only timed-out references, proves independent write-capacity exhaustion, explicitly releases its own
peer, then probes real receipts and requires at least one suppressed expired queued write. Removing only the
actual expiry guard makes the test fail with zero suppressed writes; the production guard was restored. No native,
wire or transport implementation changed. Both initial failure log hashes, this negative proof and the final rerun
are retained in the tuple.

## Limits and external acceptance

The full upstream native check is **not green**: this pinned source/cache combination reports existing upstream
errors; the final audit has no diagnostics in history, SessionManager or shared RPC files. Root strict authored
TypeScript, same-source generated checks and actual runtime proofs are separate gates and must not be confused
with that full upstream check.

Windows Chrome/WSL2 is deferred by the owner. The 10,000-entry run proves bounded reachability, not the formal
30-sample latency/RSS matrix (#60). Catalog-authorized private open (#32), exact live/durable settlement (#35),
persistent navigation, DSH generation rebuild and Attachment Original association remain their own acceptance
slices. No full-MVP, TUI/provider or private-product admission claim is made by this fixture.
