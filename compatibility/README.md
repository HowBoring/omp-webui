# S0 public compatibility candidate and Linux diagnostics

Ticket [#30](https://github.com/HowBoring/omp-webui/issues/30), parent [#29](https://github.com/HowBoring/omp-webui/issues/29).
This delivers diagnostics only. All private Session routes remain blocked. The normal `bun run dev` scaffold
is retained; `bun run diagnostics` runs the explicitly built diagnostic Host.

## Build from the fixed sources

Use Linux x64, Bun **1.4.4**, complete Node **24.22.1** (including development headers), Corepack with
pnpm **11.28.5**, git, and writable package caches. Browser evidence also requires Python Playwright,
`/usr/bin/chromium`, and `/usr/bin/strace`. Keep all upstream source and generated DSH assets under ignored vendor/.
The checked-in `upstreams.lock.json` pins are unchanged.

From the repository root, with these tools on PATH and `COREPACK_HOME` set to a writable task cache:

```sh
bun install --frozen-lockfile
bun run compat:prepare --reset
DSH_SOURCE=vendor/dsh bun run dsh:prepare
bun scripts/link-dsh.ts vendor/dsh
bun run compat:build
bun scripts/build-compatibility.ts --check
bun run diagnostics:build
bun run check
bun run diagnostics:enroll
```

`--reset` deliberately resets only the owned ignored OMP clone and known generated/new files. Do not use it
to preserve unexported upstream edits. Preparation fetches the exact source commits, applies the tracked public
patch, and installs an isolated frozen OMP dependency graph with lifecycle scripts disabled. DSH preparation
refuses a shared symlink checkout; use an owned clone. The source build runs from inside DSH so Corepack reads
its pnpm declaration, rather than this repository's Bun declaration. This run used `vendor/dsh-clean` and a
local Git object/dependency cache, then rebuilt all eight DSH artifact gates and both aggregate checks.

The actual candidate is a source-mode Bun installation: its compiled public launcher/preflight branch defers
normal CLI execution to the patched `vendor/omp/packages/coding-agent/src/cli-runtime.ts`. The complete source
and dependency/native asset tree remains in the enrolled closure. This is not a newly compiled standalone
native OMP binary. `--version` on the ordinary CLI still reports the baseline; **it is never an identity gate**.
The new public report labels the compatibility candidate `omp-webui-s0` and includes base, patch and schema IDs.

The build refuses unrecorded tracked changes and even ignored untracked source inputs before loading upstream
generators. It compares the Host's public decoder to the actual pinned source. Generated TypeScript, upstream
Python/Rust/Go outputs, schema and both sides' validators all come from that same patched wire DSL. The source
identity is SHA-256 of `base + newline + exact patch bytes`, not an invented upstream Git commit. Actual source
files and generated artifacts additionally have individual content identities in the installation manifest.
`--check` verifies the tracked Host generated outputs without refreshing trust or replacing the candidate.

The ordered stack now applies `0001-safe-preflight.patch` then `0002-readonly-catalog.patch`, directly after OMP base
`7c49c11aa5bbaf3f418406583096168ad5b8c6dc`. The catalog is an isolated synthetic acceptance slice; see
[its contract and fixed budgets](CATALOG.md) and [typed DSH fixture](../apps/catalog/README.md). Future tickets must add ordered public deltas and extend the
cumulative source gate/build schema deliberately; they must not overwrite this patch with an unrelated clone
or claim planned capability names are implemented. `scripts/export-omp-patch.ts` is an explicit authoring tool,
not something startup/build silently calls. Read upstream `vendor/omp/AGENTS.md` when changing its source.

## Enroll and run an isolated candidate

Enrollment is an explicit build-time trust decision. Never regenerate an expected manifest from a request or
as a way to make mismatched files pass. Keep the reviewed manifest and installation stable while the Host runs.
The manifest is operator-trusted metadata, not a cryptographic proof of publisher authenticity. Stop the Host
before rebuilding/updating its tuple; source/module/asset changes invalidate it.

```sh
OMP_WEB_MANIFEST="$PWD/vendor/omp-candidate/installation.json" \
OMP_WEB_LAUNCHER="$PWD/vendor/omp-candidate/omp" \
OMP_WEB_PORT=3180 bun run diagnostics
```

Only loopback binds. Neither an HTTP argument nor a Remote parameter can choose executable, argv, profile or
paths. The page uses actual DSH Cordis/Connection/TypertRegistry/ClientRemote, a strict public diagnostic
contribution, actual Host Gateway invocation/Peer, and the public `$events` mux path. It mounts no Chat,
Workspace or Session controller. Assets must match the startup manifest before their bytes are served.

The Host verifies launcher/target, file modes, direct symlinks, directory membership, all source/dependency/native
files, the absolute Bun executable, and Linux shared-library contents. It checks the **actual child** `/proc/PID/maps`
against enrolled runtime mappings after v2 negotiation. Indirect symlinks and symlinked ancestors are rejected;
this narrow support policy avoids incomplete dependency resolution chains. Verification repeats after drain.
Checks before/after spawn are not an atomic global-installation guarantee; that later gate stays blocked.

Preflight runs with `--no-env-file`, synthetic temporary cwd/HOME/profile/TMPDIR and no inherited credentials,
preloads, BUN_OPTIONS or project environment. Stdout has one bounded physical reader and the public OMP decoder.
The diagnostic client validates only two commands plus ready/response/command-result shapes. It rejects unknown
frames and refuses selected schema definitions with unimplemented OMP leniency markers. Full Session/UI/prompt
unions and their `x-open`/fallback policies are future work, not an S0 supported capability.

S0 has a three-second diagnostic request/drain budget followed by 500-ms termination and bounded reader cleanup.
These short readonly-probe budgets do not implement the future product 30+5-second Stop/revocation policy.
Stderr content is discarded, never returned. A successful report followed by a corrupt/partial EOF, nonzero exit,
forced termination or installation drift is blocked. No automatic RPC replay occurs.

## Verification and limits

```sh
bun test
BUN_EXECUTABLE="$(command -v bun)" python3 scripts/trace-preflight.py
python3 tests/browser/diagnostics-browser.py http://127.0.0.1:3180 \
  --evidence vendor/linux-browser --expected-code S0_DIAGNOSTICS_ONLY
```

Use network-enabled tool execution where the execution sandbox otherwise denies loopback listeners/process I/O.
Tests exercise genuine candidate startup/negotiation, source/build/install/asset faults and public process
fixtures. Fixture fault evidence is separately labelled; it does not replace the actual Linux browser/candidate
path. The trace records normal Bun/OS housekeeping in the synthetic cwd, no OMP configuration/history/lease
file creation and no ordinary CLI runtime import. Raw traces, bundles and the large manifest remain ignored;
sanitary summaries and final identities are tracked with the evidence.

No global OMP exists in this environment, so the user-global installation has not been enrolled or replaced.
No real profile/history, provider, model or unknown TUI is touched. The candidate never advertises catalog,
strict continuation, explicit-answer expiry, attachment receipts, coherent history or private Session security
as implemented. Linux is the current scope. The owner explicitly deferred Windows/WSL2 acceptance until
implementation completes and they switch environments; it is not recorded as a Linux blocker or a Windows pass.

## Ordered DSH client extensions (#39)

`compatibility/dsh/patches.json` declares the fixed DSH base, ordered public patches, each patch SHA256 and
resulting Git tree. `scripts/dsh-source.ts` reconstructs those trees in temporary indexes, compares the complete
effective authored source tree, rejects undeclared untracked/ignored source (including `.env`), and records the
source identity without changing the user's Git index. Only explicitly named dependency/build output roots are
excluded from authored-source comparison; served artifacts have separate digests.

`DSH_SOURCE=<owned checkout> DSH_STORE_DIR=<pnpm cache> bun run dsh:prepare` verifies and applies the complete
set to a verified fixed baseline, then runs frozen installation, all eight artifact gates and both aggregate
check gates. An already matching candidate is accepted; an unknown tree is refused rather than reset/repaired.
`apps/diagnostics/build.ts` accepts only the verified fixed baseline or this exact declared candidate. Its
manifest includes the base, effective source tree, ordered patch identities and actual input/asset digests;
acceptance does not mean an unmodified official release or grant product Session admission.

`experiments/draft-seam` validates the public provider-owned semantic draft and atomic hydration seam through
actual DSH Client/provider fixtures and Linux Chromium. Its records explicitly distinguish fixture-original
preparation from a durable Host original store. See its README and accepted seams for the public API, tab owner
policy, cancellation/frozen revision fences, and remaining product/platform boundaries.
