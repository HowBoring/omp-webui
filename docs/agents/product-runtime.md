# Product runtime navigation

Use this when changing or debugging the real browser product. Component fixtures do not exercise the
product admission path.

## Build and enrollment chain

`apps/chat/src/product-entry.tsx` and `apps/chat/src/client.tsx`
→ `bun run product:build` (`scripts/build-product.ts`)
→ `vendor/dsh-product/client.js` and `index.html`
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

Useful commands:

```bash
bun run product:build
bun run product:verify
bun run product:enroll
OMP_PERF_DEBUG=1 python -u tests/product/performance.py --class product --samples 0
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

Host environment: `OMP_WEB_MANIFEST`, `OMP_WEB_LAUNCHER`, `OMP_WEB_MANIFEST_SHA256` (all required),
`OMP_WEB_PORT` (3180), `OMP_WEB_ORIGIN`, `OMP_WEB_DATA_DIR` (`~/.local/share/omp-webui`),
`OMP_WEB_ASSETS` (`vendor/dsh-product`). `--print-bootstrap` exits 1 with
`{"code":"PRODUCT_BOOTSTRAP_BLOCKED","reason":…}` when admission is blocked — never bypass it.
`sigUSR1` revokes all browser authorizations.

Product-flow harness: `tests/product/product-flow.py` (real Chromium, controlled provider). Operator
runbook: `docs/operations.md`. Platform and native-data evidence: `docs/evidence/ticket-61-*.json`.
