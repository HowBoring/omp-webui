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

## Review correction: refresh ownership and shared builders

The review's refresh race is fixed by serializing native snapshot allocation/release and coalescing obsolete
refresh requests before opening. A successful open is owned before checking its browser revision. Superseded
responses, scope changes during opening, connection-generation loss and disposal close every known successful
snapshot; failed closes remain owned for retry before any further open. Established observations still reuse the
same cut across active/tree/running scope changes. The refresh control remains callable during an in-flight open.

The agreed test seams remain the real Linux browser → DSH typed Remote → Bun → public native RPC, plus public
same-source native/schema boundaries. The browser carrier delays actual native successful responses; it does not
replace successful native allocations or mutate private DSH/controller state. The original client fails the current
regression with two abandoned successful opens followed by `history_cache_full`. The corrected client immediately
rereads and pages the full tree. Additional controlled scope/generation/pagehide cases close 2/2, 2/2 and 1/1 native
snapshots respectively. Both native cache slots can then be opened and paged without waiting for TTL.

The actual browser proof now also runs against a separately bundled History Host. The report still includes the
original eight same-cut native pages, folded boundaries, native image preview and the explicitly intercepted stale
Remote error. Network/disposal faults use standard browser events while the page remains alive to deliver the
late response; they do not claim delivery of an HTTP result to a browser process that has already exited.

History build identities now reuse #33's `BuildIdentities`/`assetIdentities`; candidate admission remains the
history callsite's `verifyDshSource(actualResolvedRoot, "candidate")`. The full before/after manifest is byte
identical. An undeclared edit in an owned resolved DSH clone still blocks the actual history builder before output.
Strict command-envelope generation is shared by preflight, catalog, interactions and History while each keeps its
explicit whitelist and ID policy (History's maximum is 96). Parameterless commands and native wire parameters
remain supported. Canonical `--check` proves every generated artifact is byte-identical.

Current focused results and exact log/artifact/source digests are in
[review-fix.json](../../apps/history-fixture/evidence/review-fix.json): five Host/schema tests (31 assertions),
five DSH source/build tests (37 assertions), twenty native tests (281 assertions), strict authored TypeScript,
product scaffold Host build, bundled History Host build, generated checks and actual browser proof pass. Native
source `8960c74b…`, schema `8345aa42…` and native0004 are unchanged. Prior native 10k/100 MiB and retained-content
stress are hash-bound and reused; they are not presented as new runs. Original review-baseline artifacts remain
in `checkpoints/26aa8b4-review-baseline-*`. Initial command-environment and overlapping-port failures are retained
with their successful corrected runs in the review report.

The final branch includes accepted #33 `90d66826` and current integration `385b972d`. After the accepted merge,
the owned native checkout was reset through ordered0001–0004 and rebuilt; generated `--check`, strict TypeScript,
five affected tests (31 assertions), browser/product Host/History Host builds and the complete bundled Host browser
proof all pass again. The subsequent integration merge changes ancestry only. Native source/schema, DSH candidate
and consumed History assets retain the exact identities recorded in the refreshed tuple.

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
bun build apps/history-fixture/main.ts --target=bun --outdir=vendor/host-history
bun scripts/prove-history-browser.ts --built
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
