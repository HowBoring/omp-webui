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
The product shell is the pinned stock DSH Web Client distribution served from `vendor/dsh-product`
(built by `scripts/build-product.ts`; boot graph + routes). It is not `apps/chat/src/client.tsx`:
that file is the isolated component fixture used by the component browser tests through
`vendor/host-chat`, and it is not served as the product. The only authored OMP client plugin is
`apps/chat/src/product-enrollment.js`, mounted in the stock graph as `@omp-webui/product-enrollment`.
`tests/product/product-flow.py` walks stock model/thinking and preferences, attachment upload, draft
reload, unsupported-file refusal, native attachment submission, history reopen and Original byte
checks against the enrolled stock product.

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

## Final combination (ticket 63)

The validated stock-shell combination is frozen in `docs/evidence/ticket-63-freeze.json` and summarised in
`docs/release-final.md`. Rebuild and enroll before touching runtime code:

```bash
bun run compat:build && bun run dsh:link && bun run product:build
bun run product:verify && bun run product:enroll
bun test tests/product/freeze.test.ts      # fails when the enrolled installation drifts
```

The freeze gate hashes the enrolled manifest with checkout-relative asset paths and a tokenized runtime
path. System dependency paths are reduced to their basename, but each dependency keeps its content
identity and size, so a foreign glibc with the same library names cannot pass. The canonical digest is
`ae2661298b48d2193c4356e07dcb12df200cf77f10b8ce5b26333039752f40c0`; every checkout that enrolls the
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
runbook: `docs/operations.md`. Stock product-flow and performance evidence:
`docs/evidence/ticket-63-product-flow.json` and `tests/product/evidence/performance-2026-11-24-product.json`.
Platform and native-data evidence from the superseded custom-shell tuple remains under
`docs/evidence/ticket-61-*.json`. The #63 Windows stock-shell rerun against the final head is
recorded in `docs/evidence/ticket-63-windows-input.json`: real Win32 Ctrl+C copy, external
clipboard paste, real Enter send and Explorer drops of `drop.txt` plus the visible
`C:\t63-drop\pixel.png` were observed, while the attachment send failed with a lost worker
(`SESSION_WORKER_LOST_MANUAL_OPEN_REQUIRED`) and left the Host refusing further explicit session
actions (`SESSION_WORKER_DRAINING`); maintainer manual acceptance is still NOT RUN.
