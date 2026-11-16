# Ticket 31 — canonical native title-slot correction

The initial corpus missed an actual native layout: at pinned OMP base
`7c49c11aa5bbaf3f418406583096168ad5b8c6dc`, both `SessionManager.createEmptySessionFile` and normal serialization
write `serializeTitleSlot(...)` before the Session header. The catalog previously required the first line to be the
header. The new regression authored an empty and a titled Session through the actual pinned SessionManager;
public catalog discovery returned **partial** before the fix. That is a real discovery defect, not proof that the
old header-first synthetic corpus represented every native file.

The native reader now recognizes the optional leading slot with the authoritative `parseTitleSlotLine` helper and
reads the immediately following header. Current slot title overrides a stale legacy header title; an empty slot
removes the title, matching native loader semantics. Legacy header-first JSONL remains supported. The entire slot
and header share the existing **16384-byte cumulative prefix**, read from the already anchored file descriptor.
No second unbounded read, Session loader/manager import, migration, repair, title index or lease acquisition was
introduced into discovery. Source/reference identity, native/Host public interfaces and all budgets are unchanged.

The helper imports only runtime constants from `session-entries`; its other imports are type-only and erased.
Neither module imports a writable Session runtime at execution. The existing fd-root binding, `O_NOFOLLOW` walk,
regular-file check and before/after file identity/ctime checks still apply. Malformed slot/header records are explicit
partial failures; the reader never skips corruption or searches later records to salvage a Session.

The accepted public native RPC seam now covers:

- Two files authored by actual `SessionManager.createEmptySessionFile` and `SessionManager.create` / persistence /
  user-title update. Discovery and description verify them; whole synthetic HOME content, inode, mode, size,
  mtime and ctime remain unchanged during the readonly phase (atime excluded).
- Authoritative 256-byte Unicode/empty title slots, stale-header title precedence, legacy header-first files,
  an exact cumulative 16384-byte metadata prefix and one byte beyond it.
- Slot-only, malformed/version-invalid/oversized slots, a second slot instead of a header, malformed header and
  invalid UTF-8. Failures remain explicit and no later fake Session is accepted. Transcript tails are not parsed.

These focused tests pass **2 tests / 25 assertions**. Fixture authoring deliberately writes only isolated synthetic
HOME data before the readonly manifest/trace begins. The Host runtime never imports SessionManager or parses native
files. All 1000 synthetic Sessions in 1000 distinct default buckets now use OMP's authoritative title-slot serializer;
explicit legacy and corruption fixtures remain separate. The prior header-first results are preserved under
[before-native-layout](../../apps/catalog/evidence/before-native-layout/tuple.json), with the earlier pre-review
record separately retained under `before-review/`.

The current syscall trace discovers the two actual Manager-authored files with **229 lines**, one execve, two native
Unix ownership probes, zero unsafe writes/ordinary Session runtime imports, zero lease binds and zero non-Unix
connects. The fixture writes occur before tracing the readonly child. The repeated preflight trace has **69 lines**,
zero stderr, an empty synthetic profile and no unsafe file/ordinary runtime imports. Source-mutation rejection,
held/free/unknown ownership, stale/replaced references, bounded traversal/packing, source overlap, cancellation,
transport backpressure/expired-send and actual 60.5-second TTL checks remain green.

A clean fixed-base reset and exact ordered 0001+0002 application/build reproduces:

| Identity | SHA-256 |
| --- | --- |
| Source | `12c72dc14e30975ab0f90df49cfcf3fc1eb50f300366088dc04053ab1c6f437b` |
| Cumulative patch | `0c5a4fc201bc3b28b07a65158fbe26fb76668b926557380093e082e4c4634a39` |
| Schema (unchanged) | `f2066f6f64058b01e24640bda9e5a8625fe18d579c0fe3440f774b99fe9ea289` |
| Catalog Host bundle | `d1af18a9a1eeda93202d03838c0cf27e723b990e95188071d80f2164e3c939da` |
| Diagnostic Host bundle | `e72ceb85274b56cdabd48043e274be14f503ae3502d2235430f2b059a97f16a0` |
| Installation manifest | `bcd56a274b1b96d6148317d6078caece2e031f036670177087dc37635d8dc663` |

`bun run check` passes **106 tests / 920 assertions**, strict Host TypeScript and product Host build. Authored native
strict typecheck passes with actual transitive upstream types; unrelated full-upstream diagnostics are excluded.
The fresh upstream schema/TypeScript/Python/Rust/Go artifact test passes **1 test / 5 assertions**. Generated artifact
`--check` and `git diff --check` pass. The branch includes current integration
`3643be43d6ed7d3b5c782ddb97d24398ecc64641`. Shared stdio core source/interface remains unchanged from `46647ee`;
its public-client tests run again as part of the full check.

Both Host bundles were rebuilt and **77417** assets enrolled. The real Chromium → DSH Connection/Remote/Gateway/
Peer/`$events` → Bun → public native catalog workflow passes on that exact tuple. It reaches **1005 scoped rows from
1004 physical Sessions**, including all 1000 distinct default buckets and both actual native files. It verifies all
three overlapping/copy source-scoped `native-0000` references plus both Manager-created references and renders the
actual slot title. Partial failures, unknown cwd, observations, labelled wrong-correlation carrier fault and blocked
private APIs pass. No page errors or component performance violations occur.

With two warmups and 30 scored samples, catalog P95 is **1820.87 ms** (max 2351.35), old-page P95 **311.18 ms**
(max 444.73), and cold screen after the Host listens **1627.30 ms**. Host sampled peak RSS is **124532 KiB** and OS
high-water **278096 KiB**, below 512 MiB. Machine facts remain Linux x64/glibc 2.41, Chromium 156.0.8078.79,
Bun 1.4.4, five exposed CPUs and 18440100 KiB machine memory. Startup/install verification and OMP/browser/tool
whole-machine peaks are excluded from these operation samples; this is not formal S5 reference hardware acceptance.
The earlier startup-memory failure and all preceding samples remain retained rather than replaced by this run.

The [current tuple](../../apps/catalog/evidence/tuple.json),
[browser samples](../../apps/catalog/evidence/linux-browser.json) and
[actual native trace](../../apps/catalog/evidence/trace-summary.json) identify the complete evidence. The unchanged
pinned DSH client artifacts were reused transparently; no cold DSH rebuild or shared source modification occurred.
The complete enrolled installation closure verified again after the browser with the unchanged manifest identity.
The owned Host was stopped after validation. No real profiles/history, provider/model execution, global installation,
GitHub mutation, push or private Session admission occurred. Windows/WSL2 remains owner-deferred; protected
continuation and complete product admission remain separate gates.

Reproduction follows the [catalog runbook](../../apps/catalog/README.md), with these updated relevant commands:

```sh
bun scripts/build-compatibility.ts
bun scripts/build-compatibility.ts --check
bun scripts/check-catalog-native.ts
bun test tests/catalog/native-layout.test.ts
bun run check
BUN_EXECUTABLE=/absolute/selected/bun python3 scripts/trace-catalog.py
BUN_EXECUTABLE=/absolute/selected/bun python3 scripts/trace-preflight.py
# From vendor/omp with isolated HOME and BUN_RUNTIME_TRANSPILER_CACHE_PATH=0:
bun test ./packages/coding-agent/test/rpc-wire/generated.test.ts
# From the repository root, using unchanged pinned DSH client artifacts:
bun scripts/build-diagnostics-host.ts
bun scripts/build-catalog-host.ts
bun scripts/create-catalog-fixture.ts
bun scripts/enroll-candidate.ts --catalog-fixture
bun --no-env-file vendor/host-catalog/catalog-fixture-main.js
python3 tests/browser/catalog-browser.py
```
