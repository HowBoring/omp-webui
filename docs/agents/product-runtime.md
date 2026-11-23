# Product runtime navigation

Use this when changing or debugging the real browser product. Component fixtures do not exercise the
product admission path.

## Build and enrollment chain

`apps/chat/src/product-enrollment.js` (the one authored OMP client plugin)
→ `bun run product:build` (`scripts/build-product.ts` / `scripts/build-product-client.ts`)
→ the pinned stock DSH shell plus the audited roster in `baselineRoster`, including
`dsh-client-ui-model-selection`
→ `vendor/dsh-product/index.html` and its hashed assets
→ `bun run product:enroll` (`scripts/enroll-product.ts`)
→ `vendor/product/installation.json`
→ `apps/host/src/main.ts` product admission.

The manifest hashes the client assets, candidate runtime closure, and runtime dependencies. Every product
bundle change requires a new enrollment. `OMP_WEB_MANIFEST_SHA256` must match the resulting manifest.
A stale bundle/manifest pair intentionally blocks product admission.

Do not edit `vendor/dsh-product` directly. It is a compressed build artifact. Change authored source, then
run `bun run product:build && bun run product:verify && bun run product:enroll`. `product:verify` rebuilds
into a temporary directory and rejects a bundle that differs from the authored-source build.

DSH package exports used by the Host resolve to built `lib` output, not necessarily a same-named `src`
file. After changing the guarded DSH input, follow `scripts/prepare-dsh.sh` and the active patch manifest
to rebuild it; do not infer the executed implementation from source paths alone.

## Product execution and diagnostics

The real product Host is `apps/host/src/main.ts`; its startup log is
`vendor/performance-evidence/product-host.log` when launched by `tests/product/performance.py`.
The harness opens the enrolled installation and a real browser. Set `OMP_PERF_DEBUG=1` to collect browser
console diagnostics. It also enables `OMP_CHAT` Session lifecycle records and projection-generation records.
The product-flow counterpart, `tests/product/product-flow.py`, writes its browser/native checks to
`vendor/product-flow/evidence.json` (override with `OMP_PRODUCT_FLOW_EVIDENCE`).
The legacy `apps/chat/src/client.tsx` isolated component fixture is not the product shell; it remains
only for the attachment/original/draft evidence the stock product does not yet expose.

Useful commands:

```bash
bun run product:build
bun run product:verify
bun run product:enroll
OMP_PERF_DEBUG=1 python -u tests/product/performance.py --class product --samples 0

# Final 4 CPU / 8 GiB gate (memory.max is read from the cgroup, so the cap is recorded, not asserted)
systemd-run --user --scope -p MemoryMax=8G --quiet \
  taskset -c 0-3 uv run --with playwright python -u tests/product/performance.py --class product --samples 30
```

`--samples 0` exercises cold open and older-page reachability without producing an accepted performance
sample. Admission failures are blocked preconditions, not performance results. `apps/host/src/main.ts
--print-bootstrap` exits nonzero with `PRODUCT_BOOTSTRAP_BLOCKED` instead of waiting on a blocked server.

## Final combination (ticket 61)

The validated combination is frozen in `docs/evidence/ticket-61-freeze.json` and summarised in
`docs/release-final.md`. Rebuild and enroll before touching runtime code:

```bash
bun run compat:build && bun run dsh:link && bun run product:build
bun run product:verify && bun run product:enroll
bun test tests/product/freeze.test.ts      # fails when the enrolled installation drifts
```

The freeze gate hashes the enrolled manifest with checkout-relative asset paths and a tokenized runtime
path. System dependency paths are reduced to their basename, but each dependency keeps its content
identity and size, so a foreign glibc with the same library names cannot pass. The canonical digest is
`9b02a0297f62fd2d2ebb953a0a218411e5481ded18282eabca4c5606696e402a`; every checkout that enrolls the
same closure produces it, while source/patch/schema and each asset identity stay pinned individually.
The raw `vendor/product/installation.json` bytes still contain the concrete checkout paths that
admission executes.

The performance corpus is authoring-only: `bun scripts/create-performance-corpus.ts` writes
`vendor/performance-fixture` with pinned ids and timestamps and one session cwd — the corpus `project`
directory the gate grants, since the product lists only granted directories. Two runs of the same generator
in different directories therefore differ in raw bytes; the recorded identity replaces that path with
`<corpus>/project` (`canonicalFilesSha256`, `canonicalBytes`, `canonicalSha256`) and `bytes`/`sha256` stay
the actual serialised payload (`tests/product/evidence/performance-corpus-2026-11-22.json` records the
frozen one, generator `33626c5d…20dcd3`). A seed only compares against the same `generator.sha256`, and a
reproducibility claim applies to the canonical fields, never to `bytes`/`sha256`.

Host environment: `OMP_WEB_MANIFEST`, `OMP_WEB_LAUNCHER`, `OMP_WEB_MANIFEST_SHA256` (all required),
`OMP_WEB_PORT` (3180), `OMP_WEB_ORIGIN`, `OMP_WEB_DATA_DIR` (`~/.local/share/omp-webui`),
`OMP_WEB_ASSETS` (`vendor/dsh-product`). `--print-bootstrap` exits 1 with
`{"code":"PRODUCT_BOOTSTRAP_BLOCKED","reason":…}` when admission is blocked — never bypass it.
`sigUSR1` revokes all browser authorizations.

Product-flow harness: `tests/product/product-flow.py` (real Chromium, controlled provider). Operator
runbook: `docs/operations.md`. Platform and native-data evidence: `docs/evidence/ticket-61-*.json`.
