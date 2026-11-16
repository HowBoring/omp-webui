# Ticket 31 — bounded readonly native catalog, Linux fixture

This is the retained pre-review acceptance record. The [review-fix evidence](ticket-31-review-fixes.md)
records the corrected overlapping-source behavior, shared stdio core and current tuple/measurements.

Status: **PASS for AC1–5 on the isolated Linux component**. Product private Session admission remains blocked.
This is not protected continuation, authorization integration, complete MVP or formal S5 acceptance.
The latest integration branch, including accepted ticket 42 and transport fix
`3643be43d6ed7d3b5c782ddb97d24398ecc64641`, was merged before final combined validation.
The [catalog transport follow-up](ticket-31-transport-deadlines.md) records independent queue/inflight bounds,
startup deadlines and direct public-stdio late-publication proof. Both Host bundles/enrollment and the actual
browser workflow were regenerated after that merge; unchanged native and pinned DSH client inputs are explicit
in the tuple reuse record.

The [versioned native contract](../../compatibility/CATALOG.md) defines the actual wire, identity, source layout,
partial failures and fixed limits. The [runbook](../../apps/catalog/README.md) reproduces native/Host/DSH/browser use.
Exact hashes and platform facts are in [tuple.json](../../apps/catalog/evidence/before-review/tuple.json),
[browser results](../../apps/catalog/evidence/before-review/linux-browser.json) and
[native trace summary](../../apps/catalog/evidence/before-review/trace-summary.json).

| Acceptance | Actual evidence |
| --- | --- |
| AC1: matched public wire/schema/client/server + Bun/DSH | Authored 0002 native patch; generated TS/schema/Python/Rust/Go artifacts; narrow public client and generated strict validators; genuine DSH Connection/ClientRemote/Gateway/Peer/`$events` path in actual Chromium. |
| AC2: selected native source scope and identity | Actual OMP profile/XDG resolver; selected-profile test excludes another profile; explicit custom roots only; source aliases merge; native instance aliases merge; same-ID copies remain distinct; source/file replacement and stale reference fail. No browser cwd grant expands sources. |
| AC3: fixed scan/page/response/TTL budgets and honest failures | Native opendir windows at 256 entries; 8192-entry/2048-directory/4096-Session caps; 16 KiB header, 32-item/256 KiB response, 16 MiB descriptor storage, four snapshots and absolute 60-second TTL. Every one of 1000 Sessions in 1000 distinct buckets is reached. Actual large-descriptor byte packing preserves all rows. Scan/header/corrupt metadata/permission/source/cursor failures are explicit. Real-clock TTL, foreign-child/page-scope tokens and root/file replacement fail. |
| AC4: readonly, no hidden Session execution | Entire isolated HOME content + inode/mode/size/mtime/ctime manifest unchanged (access-time is intentionally excluded). Malformed primary and valid backup remain unchanged; legacy bucket is not migrated. Actual native trace: zero writes/create/rename/unlink, lease binds, ordinary Session runtime imports or non-Unix connects. Native held/free observed via separate real lock holder; injected actual socket EMFILE produces unknown. No Session opening/registration or model/tool process is used. |
| AC5: real UI results and observation times | Chromium reaches all 1002 fixture rows, shows selected/default/custom sources, real header cwd or unknown, partial failures, instance/copy identity and ownership observation timestamps; native description rechecks identity. Public native scanner performs the work; Host never parses native Session files. |

Final browser measurements use Linux x64/glibc 2.41, Bun 1.4.4 and actual Chromium **156.0.8078.79**.
This environment exposes 5 CPUs and 18,440,100 KiB memory; it is not the formal 4-vCPU/8-GiB/SSD reference.
Two warmups are unscored, followed by 30 scored samples for each operation. Nearest-rank P95 is retained with
all samples and maxima: catalog **1402.50 ms** (max 1436.59), old page **213.55 ms** (max 258.05).
The first browser cold screen is **1665.17 ms** after the Host is listening. Startup/install verification is excluded
from those stable-operation measurements and is not timed here; formal first-start/whole-machine costs remain S5.
Host RSS sampling is every 25 ms: sampled peak **124000 KiB**, OS high-water **270684 KiB**. OMP/browser/tool
peaks are not measured here and are not misreported as Host memory. All recorded component thresholds pass.

Measurement caught a predecessor's startup high-water of 686796 KiB despite stable RSS of 86524 KiB. The final
Host hashes runtime/native installation files in 4–64 KiB buffers with unchanged SHA-256 identities, avoiding
whole-file reads of the 103 MiB Bun and large native assets. Provenance/mutation tests pass afterward. Native
snapshot eviction also clears its owned expiry timer, so evicted descriptors cannot remain retained until TTL.

Reproduction actually run from the worktree, with the exact tool directories on PATH:

```sh
bun run compat:prepare --reset
bun run compat:build
bun scripts/build-compatibility.ts --check
bun scripts/check-catalog-native.ts
bun run check
bun test tests/catalog/catalog.test.ts tests/catalog/protocol.test.ts \
  tests/compatibility/preflight.test.ts tests/compatibility/source.test.ts
BUN_EXECUTABLE=/absolute/selected/bun python3 scripts/trace-catalog.py
BUN_EXECUTABLE=/absolute/selected/bun python3 scripts/trace-preflight.py
# From vendor/omp, with isolated HOME and BUN_RUNTIME_TRANSPILER_CACHE_PATH=0:
bun test ./packages/coding-agent/test/rpc-wire/generated.test.ts
# From repository root:
bun run diagnostics:build
bun run catalog:build
bun run diagnostics:enroll --catalog-fixture
bun run catalog:fixture
python3 tests/browser/catalog-browser.py
```

The clean ordered patch reset/build reproduces source `907148c7554ce20af8f32902e3de57fe08c4be67ccbc612a50d9e089070d70fb`,
cumulative patch `aebc1697a7f3321b5c0c06a7a0cc49925f500fde6be83261a25679e7516970c2` and schema
`f2066f6f64058b01e24640bda9e5a8625fe18d579c0fe3440f774b99fe9ea289`.
The final native trace records 204 lines, one execve, one native ownership connect, zero lease binds, zero non-Unix
connects and zero unsafe writes/ordinary Session imports. The safe preflight trace remains Session-readfree.
The upstream fresh-artifact test passes 1 test / 5 assertions. The final full merged check passes **90 tests / 509 assertions**; individual assertion
counts vary with the number of bounded scan windows, with exact command results retained in the handoff.
Authored native modules pass a strict TypeScript check with actual upstream types. Unrelated full-upstream
configuration/type diagnostics are outside that narrow check and are not called a passing upstream-wide check.

Native format remains v3 with no extra durable metadata. Physical instance references deliberately become stale
on replacement/atomic rewrite; logical native Session ID remains distinct. Strict resume/first-write protection,
registration/index persistence, directory grants, history/projection, attachments, provider execution and global
installation immutability are later gates. No global installation is changed and no real profile/history/provider,
model, external TUI or Windows/WSL2 environment is used. Windows Chrome/WSL2 is **DEFERRED by the owner**.
Raw traces, bundles, screenshot and large installation manifest remain ignored under vendor. The fixture Host is
stopped after evidence; its generated synthetic data and owned worktree remain for review.
