# Ticket 31 review fixes — isolated Linux catalog

The standards and spec findings on `5c26d6b643022c2ee46e8244cc0faa78a1bb176f` are corrected. This worktree
merged the current integration `3643be43d6ed7d3b5c782ddb97d24398ecc64641` before its final clean build/check.
The delivered surface is still the isolated readonly catalog. Product private Session admission remains blocked;
protected continuation, providers/models, real profiles/history and complete S5 acceptance are outside this proof.
Windows Chrome/WSL2 remains explicitly deferred by the owner.

The accepted test seams remain public native RPC/schema, actual Bun stdio clients, and Chromium through the real
DSH Connection/Remote/Gateway/Peer/`$events` path. No private transport/state tests or browser raw-RPC API were added.

| Review finding | Disposition and evidence |
| --- | --- |
| Inline type imports / `ReturnType` | Native `Directory.anchor` imports `FileHandle` at module scope; the expiry timer uses Bun's actual global `Timer` type. Authored native strict typecheck passes. |
| Native class privacy / Node imports | Snapshot state and seven methods use ES `#private`; the existing constructor parameter property remains the documented upstream exception. Authored native filesystem/path value imports use namespaces. |
| Duplicated containment | All three native callers use `relativePathWithinNormalizedRoot` from the specific public `@oh-my-pi/pi-utils/dirs` subpath. Existing canonicalization and fd-anchored `O_NOFOLLOW` walks remain in place. |
| Cross-source directory deduplication | Canonical directories deduplicate within `sourceId`. Nested authorized roots retain both scoped records for one physical instance; their references verify independently. |
| Duplicated schema hardening | Both preflight and catalog command selections use `makeCommandSchemas`, preserving strict generated whitelists and failure on unaudited schema markers. Schema identity is unchanged. |
| Duplicated stdio lifecycle | Both public clients use `BoundedStdioTransport` and `StdioWriteQueue`; mode wrappers retain generated command/result validation, ready capabilities, remote errors, chunk policy and byte limits. No deferred/raw-send API was added. |

The smallest common interface owns spawn/readiness/v2 negotiation, bounded pending/settled correlation, serialized
write/flush, expiry suppression, stderr counting, cancellation and drain. Duplicate IDs reject without replacing a
pending waiter. Its validated-notification hook also drains known notifications; callers fence retired generations.
The actual child exit promise is observable for that fence. The shared write queue also supports the separate native
UI fixture's protocol needs. The core interface and source were sent to tickets 32/33/34 before their migrations.

The overlap regression first failed through the actual built candidate: both complete and partial traversals
returned **41** descriptors instead of **81**. With the fix, page-size-one traversal reaches all 81: forty native
Sessions under both default/custom identities and one deeper record reachable only through the explicitly selected
custom root. A canonical directory alias does not duplicate either scoped record. Both references to the same
physical instance verify, and the whole synthetic HOME manifest remains unchanged. The extra custom depth does
not expand the default source's fixed native layout.

The isolated page now locally authorizes the existing `bucket-0000` as another custom root. Chromium reaches all
**1003 source-scoped rows from 1002 physical Sessions**, including all 1000 distinct default buckets. The three
`native-0000` rows have distinct source identities (default, nested source, separate custom copy); every scoped
reference is rechecked through the real DSH Remote and native descriptor command. Partial source/metadata failures,
unknown cwd, timestamped ownership, an intercepted wrong-correlation carrier fault and blocked private APIs pass.

A further public stdio regression reproduced the coalesced-negotiation bug: a valid correlated acknowledgement and
first v2 chunk in one sub-PIPE_BUF stdout write failed with `RPC_PROTOCOL` at 19.31 ms. `PhysicalFrames.push` now
supports synchronous per-line consumption, preserving its existing array-return interface. Only a successful,
correlated, schema-valid v2 acknowledgement changes decoder state before the next line. The complete later report
uses the actual request ID and drains cleanly. Before-ack/wrong-command-ack chunks fail; catalog chunks remain
forbidden, including immediately after a valid acknowledgement. A valid ack can settle before a following protocol
fault is observed, so the catalog negative test asserts the next request and terminal drain, not an opening-promise
rejection. The initially overstrong assertion failed once; the corrected test and final full check pass.

The unchanged startup, reverse-completion, late-response, real blocked-reader, expired-send, cancellation, strict
schema and partial-EOF cases now run through the shared core via the public clients. The actual blocked-flush and
resumed-reader probe evidence remains the [earlier transport record](ticket-31-transport-deadlines.md); its original
failures and skip-guard mutation proof were retained. No test reaches into the new core or queue internals.

## Import closure and readonly proof

The checkout and frozen installed `pi-utils/dirs.ts` bytes match. That specific module imports Node builtins,
`pi-natives/path`, package metadata, `fs-error` and `test-runtime`. The path submodule imports `loader-state`, which
in turn imports Node builtins, native package metadata, `embedded-addon` (null on disk) and `version-sentinel`.
Its extraction/loading logic is behind `loadNative`; the Windows long-path helper calls it only on Windows. The
reused containment primitive itself only calls `path.relative`/`path.isAbsolute`; it performs no normalization,
realpath or filesystem access. The existing Linux ownership probe remains the actual native file-lock observation.
No pi-utils root barrel, Session/config/UI import or write path was introduced by this reuse.

The current native trace has **210 lines**, one execve and one native Unix ownership connect, with zero unsafe
writes/ordinary Session imports, lease binds or non-Unix connects. The current preflight trace has 70 lines, zero
stderr bytes, an unchanged empty synthetic profile and no unsafe file/ordinary runtime imports. Full native tests
retain stream hashing, source/path/lease safeguards, all 1000 distinct buckets, actual 60.5-second TTL, file/root
replacement, unknown lease faults, partial permission failures and stable bounded response packing.

## Exact build and verification

Clean reset of the owned ignored OMP clone to `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`, removal of only declared
untracked authored/generated files, and ordered application of 0001 then 0002 reproduced:

- Source SHA-256: `1746107abbd6ec0678075b967665bc5c8cf56eea51e2b9f5be2a4e78d5a95dcf`
- Cumulative patch SHA-256: `fff12945f224f4b3500133e20d21eea82bb17c083be5c636abd7eb5fe732e53f`
- Schema SHA-256: `f2066f6f64058b01e24640bda9e5a8625fe18d579c0fe3440f774b99fe9ea289`

`bun run check` passes **104 tests / 899 assertions**, including the real TTL, plus strict Host TypeScript and the
product Host build. The authored native module typecheck passes using actual upstream types; unrelated full-upstream
diagnostics are excluded. The upstream fresh schema/TypeScript/Python/Rust/Go artifact test passes **1 test /
5 assertions**. `build-compatibility.ts --check` passes after the clean build and again after browser validation.
`git diff --check` passes. Network-enabled execution is used for native sockets and loopback; default-sandbox
socket/listen restrictions are not treated as product failures.

Both Host bundles were rebuilt and enrolled with **77417** assets. The catalog Host bundle is
`1eb3beae1512b8283438fd6f1d13882025a758d328ee617a861d4749578e0ac6`; the diagnostic bundle is
`b0cc068258ff2318526f881615ccd7855cf634fbf73149c64ca8f9212d96553f`. The exact enrollment identity is
`976f5ed5658d5112c18f57f1bc1d9392ba2767472b42a9e4300866594a8fdf42`.
The [current tuple](../../apps/catalog/evidence/tuple.json) records every individual patch/client/Host identity.
Unmodified pinned DSH browser artifacts were copied from the previous worktree and verified by their retained
source/contract/asset hashes; no redundant cold DSH build or shared source modification occurred. Dependencies are
immutable read-only hard-link reuse in owned ignored directories. The native source clone is writable and owned.

The final same-tuple browser run uses Chromium 156.0.8078.79 on Linux x64/glibc 2.41, Bun 1.4.4, five exposed CPUs
and 18440100 KiB machine memory. Two unscored warmups precede 30 scored samples per operation. Catalog nearest-rank
P95 is **1441.98 ms** (max 1450.79); old-page P95 is **201.16 ms** (max 232.96). First cold browser screen after the
Host listens is **1688.22 ms**. Host sampled peak RSS is **122944 KiB**, OS high-water **268956 KiB**, below 512 MiB.
All component thresholds pass. Startup/install verification and OMP/browser/tool whole-machine peaks are not timed
or attributed to these operation samples; this machine is not formal S5 reference hardware.

The [browser samples](../../apps/catalog/evidence/linux-browser.json) and
[native trace](../../apps/catalog/evidence/trace-summary.json) are current. The preceding tuple, full browser samples
and trace remain under [before-review](../../apps/catalog/evidence/before-review/tuple.json). The earlier 686796 KiB
startup HWM failure and streaming-hash correction remain in the [original acceptance record](ticket-31-catalog.md).
The entire enrolled installation closure verified again after browser validation with the exact unchanged manifest
identity. The owned fixture Host was stopped after validation. No global install, real profile/history/provider/model,
GitHub/push or private admission was used.

Commands actually run, with the selected Bun on PATH and loopback/native network permission where required:

```sh
# Clean fixed-base checkout + exact ordered patch application, then:
bun scripts/build-compatibility.ts
bun scripts/build-compatibility.ts --check
bun scripts/check-catalog-native.ts
bun run check
BUN_EXECUTABLE=/absolute/selected/bun python3 scripts/trace-catalog.py
BUN_EXECUTABLE=/absolute/selected/bun python3 scripts/trace-preflight.py
# From vendor/omp, isolated HOME and BUN_RUNTIME_TRANSPILER_CACHE_PATH=0:
bun test ./packages/coding-agent/test/rpc-wire/generated.test.ts
# From repository root, using the unchanged copied DSH assets:
bun scripts/build-diagnostics-host.ts
bun scripts/build-catalog-host.ts
bun scripts/create-catalog-fixture.ts
bun scripts/enroll-candidate.ts --catalog-fixture
bun --no-env-file vendor/host-catalog/catalog-fixture-main.js
python3 tests/browser/catalog-browser.py
```
