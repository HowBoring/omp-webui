# Ticket 41 H/P/external source composition validation

**SOURCE candidate only; fresh full paired Spec/Standards review pending.**
Base: `fe8a24afcbff02edaa9988349c32e87ce081bd99`, tree `f4ad103dda4d25e7f97130505812993bd6161569`.
Branch: `source/ticket-41-external-composed`. External source: `bcbc30e9532e404fb27fc63ceb85c07de335c46f`,
tree `6884dcfa3567993898ef98001320a6b159752443`. No source ancestry was merged from the historical external branch.
The [selection manifest](ticket-41-external-composed-selection.json) is the exact 32-path allowlist: 26 selections
and six authored composition/evidence paths. It records source commit/blob/hash, selected hash and every base preimage.
Seven selected Markdown documents have an explicit historical/source notice; their original bytes remain the suffix.
All selected implementation, test, build, C/header, fixture and JSON bytes are exact external source bytes.

## Public seams and red/green evidence

Reuse the existing reviewed external controller and fixed launch suites and the six reviewed H/public-P fake suites.
No new test or test seam is introduced. Import/source inspection preceded execution. External controller/launch static
runtime reaches only `external.ts`, `external-launch.ts`, `control.ts`, `errors.ts` and standard inert helpers; its
private-controller socket dependency is type-only. Existing public P suites use injected descriptor/library/process
systems. Their production-constructor negative case rejects an absent approval inventory before pin/open/FFI loading.
The existing explicit loaders and dynamic FFI source remain present but uncalled on these controlled paths.

Before selecting production external sources, the unchanged controller/launch suites failed to import the missing
`external.ts` and `external-launch.ts`: **0 PASS, 2 FAIL, 2 import errors**. After selecting the exact latest external
sources: **40 PASS, 0 FAIL, 199 assertions**, two files. This red demonstrates the absent source component; it is not
a newly invented semantic regression. The already reviewed uncertain-close regression remains unchanged.

The final composed eight-suite command passed **82 tests, 0 failures, 363 assertions** on Bun **1.4.4**:

```sh
/workspace/work/rpc-public-module-probe/tooling/bun/package/bin/bun test \
  tests/supervision/external/controller.test.ts tests/supervision/external/launch.test.ts \
  tests/supervision/control-io-public.test.ts tests/supervision/control.test.ts \
  tests/supervision/session.test.ts tests/supervision/controller.test.ts \
  tests/supervision/owned-control-io.test.ts tests/supervision/approved-helper-owner.test.ts
```

Coverage includes withheld START during registration, sticky receipt failures, root-exit readiness versus terminal
completion, serialized clean EOF, close-only/truncated EOF refusal, original fake reap, exactly one uncertain raw close,
retained module/owner/selection on uncertain disposal and public P production-loader substitution refusal. This is
controlled adapter behavior, not real descriptors, external authentication, kernel adoption or service drainage.

The selected `external/build.test.ts` remains **NOT RUN**: importing its builder reaches maintenance's static FFI
dependency. Neither builder, historical static script nor opt-in C write-fault fixture was evaluated or invoked.

## Static verification

- **Full normal TypeScript PASS:** `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`, unchanged root
  configuration, TypeScript **6.0.3**, exit **0**, no diagnostics or emitted files. The worktree uses an ignored symlink
  to integration's unchanged installed dependencies. Unchanged apps/packages/tests and required OMP fixture source
  paths were materialized solely for full normal typechecking; no fixture was executed.
- **Additional explicit source typecheck PASS:** private builder plus the new AST audit, using the normal strict
  compiler options with `--ignoreConfig` and explicit input files. The initial invocation without `--ignoreConfig`
  was rejected by TypeScript 6 with TS5112 before checking; the corrected command completed successfully.
- **SHA/AST closure PASS:** the new `source-checks/ticket-41-external-composed-static.ts` parses source only.
  **37 TS sources, 123 edges, 24 pure static runtime modules**; selected and preserved hashes agree. The
  [graph](ticket-41-external-composed-static-closure.json) separates type-only/dynamic dependencies and explicitly
  identifies the excluded builder maintenance/FFI closure. Dynamic imports still require the source path inspection
  above; the graph is not an assertion that native loading is generally unreachable.
- **Both C policies PASS**, independently, with `gcc -std=c11 -Wall -Wextra -Werror -Wconversion -Wsign-conversion
  -Wshadow -Wformat=2 -fsyntax-only -include docs/evidence/source-checks/ticket-41-private-helper-configuration.h`
  followed by either `compatibility/supervision/private-helper.c` or `external-protector.c`. The retained inert header
  names `/source-only` paths and synthetic inode values. No ELF, object, assembly, library or executable was emitted.

No full test/check/build command was run. These checks supply no compiled provenance, real loaded closure or runtime
proof. Historical compiler/assembly results are deliberately not rerun or represented as current tuple evidence.

## Composition and maintenance proof boundary

The manifest independently retains **47 H/P/root paths** against exact base blobs and SHA-256. Every current H
`packages/delivery` implementation remains byte-exact, as do P's public control-I/O and private controller/owner.
The authoritative `PrivateHelperSocket = ControlSocket` alias and P raw-close/clean-EOF/reap contracts are preserved.
Only shared `private-helper.c`, `candidates.h`, private builder and supervision README change existing base paths.

Current H `maintenance.ts` and the latest external dependency have the same Git blob and SHA-256. Source comparison
of the old private builder and the selected shared builder establishes the compatible call/lifetime contract:

| Boundary | Preserved shared-builder behavior |
| --- | --- |
| Before lease | Canonical root/dispatcher/control/fence inputs; reject enrolled release or existing fixed destination |
| Lease acquisition | `acquireMaintenanceLease(input.control, "use")`, finite policy-specific maintenance error |
| Protected work | Validate pinned fence directory, create canonical output directories, serialize same configuration, compile temporary output, exclusive publication |
| Success verification | Await `lease.verify()` after publication and before cleanup |
| All exits | Remove temporary directory, then await `lease.release()` in nested finally; preserve finite maintenance errors |
| Private entry | Original fixed private binary, source/header/configuration provenance names and error codes |
| External entry | Distinct fixed external binary and complete wrapper/shared C/header/configuration provenance names |

This is a source contract proof, not actual flock/FFI/file publication proof. The C diff was inspected against the
current private preimage: external-only policy branches and equivalent private constants/formatting preserve the
private EOF/escalation/finalization behavior. External COMPLETE retains its distinct ACK, queued full healthy flush,
fence removal/fsync and zero-exit ordering. No private assembly or actual C execution claim is made.

## Review and limits

Read AGENTS, local implement-spec/TDD/code-review guidance, CONTEXT/domain, ADR0026, cached #29/#41, the external source
frontier, H/P composed pair/merge report, external clean-EOF pair and latest raw-close pair. Their existing SOURCE GO
findings are scoped to their stated earlier deltas. New ADR0027 and this entire 32-path delta require **fresh full paired
review**. Old evidence JSON remains byte-exact with original identities; its companion Markdown carries a notice.

Shared C/build changes require later new provenance/build/approval, even where private code generation was historically
compared. Root entry/scripts/dependencies/lock/config, OMP pin/active patch set, DSH/schema and admission are untouched.
No Native/backend/Host registration, C/FFI/helper/library execution, actual kernel/proc/ports/socket/signals, browser,
seed, staging/keys/global installation, GitHub/push or integration write occurred. The separate historical source/fault
artifacts were read/copied only. Whole #41/#61 and product/private Session admission remain **OPEN/BLOCKED**.

Before handoff, checked the actual integration branch `mvp/spec-29`: its tip remains the exact base `fe8a24a` above.
`git merge mvp/spec-29` on this source branch reported **Already up to date**. The final diff contains exactly the
manifest's 32 paths; all selected and retained hashes pass, and `git diff --cached --check` reports no whitespace issue.
Integration was not changed. No fresh composed review result is claimed by this candidate.
