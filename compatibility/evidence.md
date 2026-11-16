# Ticket #30 vertical evidence

2026-11-16, Linux x64. Integration base verified `0a0e443636d46d20a21a02de028edae4ac6ba59f`.

1. Installation seam RED: `bun test tests/compatibility/preflight.test.ts` → missing installation module (0 pass, 1 fail).
   GREEN after public `inspectInstallation` implementation → 1 pass. Unknown manifest/launcher fails before spawn.

2. Public framing RED: missing PhysicalFrames module; GREEN: matched public RpcFrameDecoder reassembles
   an actual RpcFrameEncoder v2 1.2-MiB UTF-8 response across 1337-byte reads.
3. Candidate startup RED: candidate output absent (process write failed); GREEN after actual source patch/build:
   `bun test tests/compatibility/candidate.test.ts` → 1 pass / 5 assertions, real v2 negotiation/report,
   empty isolated HOME/profile, empty stderr. Ordinary deferred CLI `--version` returned `omp/18.20.2`.
4. Public transport RED: missing PreflightTransport module; GREEN after process implementation:
   actual candidate report and observed exit0/EOF drain. Contract fixtures separately cover out-of-order,
   wrong IDs/commands, malformed results, duplicate/UTF-8/partial EOF tails, timeout/late frames,
   bounded cancellation, reap and stderr redaction. 16 compatibility tests / 29 assertions pass.
   Early tail-fixture failure was its parsing of an empty console EOF line; corrected fixture exercises real tail bytes.

Foundation checkpoint, not ticket completion: genuine typed DSH browser integration, complete clean-source
reproduction/install enrollment, expanded mutation/framing faults, and final matched evidence remain in progress.
The candidate is diagnostic-only and never grants product Session admission.

5. Source/build gate: actual public decoder modification and ignored extra environment file both reject before
   generator import. Clean reset → tracked patch apply → same-source generation/build succeeded. `--check` agrees
   with all tracked generated Host artifacts. Public decoder source equality is enforced before compilation.
6. Expanded faults: physical limit including newline, malformed physical/reassembled UTF-8, pre-negotiation chunks,
   chunk count/metadata/base64/interleaving/order/length/EOF; same-version launcher, symlink, dependency, native/runtime
   and directory membership drift; indirect dependency chains reject enrollment. A real pipe which stops reading
   cannot suppress shutdown deadlines. A valid response delayed until stdin EOF still settles before exit/reap.
7. Full fresh DSH source checkout at the locked commit, using existing Git objects and the frozen pnpm store:
   398 workspaces, 1433 dependencies; `build:artifacts --serial` 8 passed / 0 failed / 0 skipped in154.62s;
   `build:check --serial` 2 passed / 0 failed / 0 skipped in130.86s. No generated client bundle was copied into this
   new checkout. Native gate uses upstream's own build/cache policy; this is not a claim of an uncached native toolchain.
   Initial Corepack attempts from the Bun root and without writable COREPACK_HOME failed before build; corrected cwd/cache.
8. Actual public candidate strace: ready + negotiation/report responses, exit0, stderr0, one execve, no profile
   entries or O_CREAT/ordinary CLI runtime/Session-manager reads. Bun did inspect the empty synthetic cwd and its
   absent bunfig.toml, plus ordinary OS/runtime/project module metadata. Raw generated trace is kept ignored.

9. Final actual Linux browser on the compiled/enrolled Host: 8 PASS, Chromium156.0.8078.79. Real native report
   source033536e5… / patch6e7f1e14… / schemafde59ea5… / installation68494ac2…; actual child runtime mappings
   matched Bun plus5 Linux shared libraries. Two real browser contexts yielded one verified-blocked and one
   PREFLIGHT_BUSY. The final tuple/screenshot and complete compressed installation manifest are tracked under
   compatibility/evidence/. No Windows blocker is included in the final actual report.

10. Final validation: `PATH=<selected Bun dir>:$PATH bun run check` PASS (strict Host/client/contracts types,
    59 tests / 113 assertions / 11 files, scaffold build). `bun node_modules/typescript/bin/tsc --noEmit
    -p tsconfig.scripts.json` PASS for all build/enrollment scripts. `bun scripts/build-compatibility.ts --check`
    PASS. Final DSH diagnostic rebuild retains the exact same232-input manifest and client digest after
    replacing build metadata casts with strict runtime parsing. Genuine Host bundle build PASS (239 inputs).
    An actual copied candidate with omitted approved native mappings is explicitly blocked despite matching
    public ready/source/schema identity. `git diff --check` PASS. Current integration branch is merged/up-to-date.
