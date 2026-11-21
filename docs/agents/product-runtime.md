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
