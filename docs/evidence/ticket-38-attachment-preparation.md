# Ticket 38 attachment preparation — partial runtime evidence

Status: **incomplete**. This record covers only what was actually executed. It does not
claim #38 acceptance.

## Tree

| Input | Identity |
| --- | --- |
| Base (integration tip with #36) | `cfb5451ca1d22c89247130789914d243049bad73` |
| Merge of `origin/mvp/ticket-38-text-budget-source` | `66f6b1e` |
| Native base commit | `7c49c11aa5bbaf3f418406583096168ad5b8c6dc` |
| Candidate `sourceSha256` | `d8d12deee18a1b8a56c57785f8bf2f5a23fbb3a21389427cf9fc4eba6e5622d9` |
| Candidate `patchSha256` | `069eaf6f90773d17d09bf4c3faf3f66ade3a3e362156e03650701ecad4e31b8c` |
| Candidate `schemaSha256` | `8f9c3a086dade38eee57fdb535f1d5b66e81a1f770a2f44e9bc077f41b0e5566` |

The three digests equal the pinned expectation in
`tests/attachments/image-original-budget-cohort.ts:7-12`.

## Host staging required to run anything native

`scripts/prepare-compatibility.ts` links `vendor/omp/node_modules` to the frozen published
`vendor/omp-runtime/node_modules`. Patch 0009 adds `readStreamBounded` to
`packages/utils/src/stream.ts` and the new attachment modules import
`@oh-my-pi/pi-utils/stream`, so the frozen copy is unusable:

```
SyntaxError: Export named 'readStreamBounded' not found in module
  'vendor/omp-runtime/node_modules/@oh-my-pi/pi-utils/src/stream.ts'
```

That error surfaced as a bare `STRICT_STARTUP_FAILED` because
`compatibility/omp/0005-strict-continuation.patch` maps unknown startup errors to that code.
The working staging (gitignored `vendor/`, matching the historical `dependencyLinks.native =
../omp-deps` record) is:

```
cp -al <integration>/vendor/omp-runtime/node_modules vendor/omp-deps/node_modules
ln -s ../../../omp/packages/utils vendor/omp-deps/node_modules/@oh-my-pi/pi-utils
ln -s ../omp-deps/node_modules vendor/omp/node_modules
```

The directory must be named `node_modules`; the `@oh-my-pi/pi-natives` loader rejects other
names and reports `Failed to load pi_natives native addon for linux-x64 (modern)`. Only
`pi-utils` may be workspace-linked — `pi-natives`, `pi-tui` and `pi-ai` must stay the published
installs. `bun run compat:prepare --reset` restores the broken link, so re-apply afterwards.

## Results actually observed

| Command | Result |
| --- | --- |
| `bun run compat:build` | above digests, `files: 2` |
| `bun scripts/build-compatibility.ts --check` | exit 0 |
| `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | exit 0 |
| `bun test --no-env-file --preload $PWD/compatibility/omp/fixtures/no-provider.ts tests/continuation/continuation.test.ts` | 2 pass / 0 fail / 14 expects / 4.68 s |
| `python3 scripts/test-attachments-native.py` | 6 pass / 0 fail / 15 expects (UTF-8 invalid rejection, PNG unchanged, UTF-8 inline truncation, raw document ceiling, DOCX structure disclosure, GIF first-frame disclosure) |
| `python3 scripts/test-attachments-native.py` ×13 fixtures | 38 pass / 5 fail / 105 expects |

The suites only run with `--no-env-file --preload
compatibility/omp/fixtures/no-provider.ts`; otherwise they abort with
`ATTACHMENT_PUBLIC_FIXTURE_PREIMPORT_GUARD_AND_TOP_TMP_REQUIRED` (`os.tmpdir()` must be
`/tmp`, the guard symbol must be installed).

## Unresolved at this commit

1. `compatibility/omp/fixtures/attachment-receipt.test.js` fails 4 of 5 cases here through
   `prepareAttachmentIsolated` → `attachment_converter_resource_failure`. The isolated worker
   is flaky under `bun test`: `compatibility/omp/fixtures/attachment-isolated.test.js` failed 2
   of 4 observed runs while the same spawn works when replayed by hand from the repo root. The
   child exits non-zero; its stderr is consumed before it can be read back, so the cause is not
   yet identified. Candidate causes are the `prlimit --fsize=0` limit and per-test-runner
   process limits.
2. `tests/submissions/format.test.ts:28` spawns `tests/continuation/tui-probe.py` with only
   `PATH`, while the probe asserts `OMP_BASELINE_CLI` and `OMP_CANDIDATE_CLI`
   (`tests/continuation/tui-probe.py:14-16`), so it fails with `AssertionError: OMP_BASELINE_CLI
   and OMP_CANDIDATE_CLI must name real native entries`. `tests/continuation/native-tui.test.ts:9`
   supplies them but pins `/workspace/work/rpc-public-module-probe/tarball/package/dist/cli.js`,
   which does not exist on this machine. The published baseline CLI is available at
   `vendor/omp-runtime/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js`.
3. No public-worker / Bun / DSH isolated-page acceptance run has been executed on this merged
   tip, and no fresh per-format receipt, consent, cancel or stale-version evidence exists for
   this commit. The format matrix in `compatibility/ATTACHMENTS.md` still refers to the
   historical candidate tuple.
4. `git merge mvp/spec-29` has not been re-run after the merge commit.

## Full suite run on `66f6b1e` (after the staging above)

`bun test --no-env-file --preload "$PWD/compatibility/omp/fixtures/no-provider.ts" tests/attachments tests/submissions`
→ **134 pass / 21 fail / 155 tests, 937 expects, 461 s**.

Failures cluster on one cause. Error tally from the run:

| Code | Count | Where |
| --- | --- | --- |
| `attachment_converter_resource_failure` | 14 | every "actual public PNG/JPEG/WebP/GIF/PDF/DOCX/PPTX/XLSX/EPUB …" case and the 5 MiB / 10 MiB / 32 MiB budget cases |
| `attachment_converter_error` | 5 | mixed-refusal and provider-context cases |
| `STRICT_FIXTURE_EXIT_` / `TIMEOUT` | 3 / 3 | `tests/submissions` fixture crashes (separate, #36-owned) |
| `RPC_UNEXPECTED_EOF` | 3 | fixture process exit |
| `ATTACHMENT_NOT_READY` | 1 | consequence of the converter failures |

So the format matrix, consent, cancel and budget assertions are all wired and reach the native
prepare boundary; they fail because the isolated conversion helper exits non-zero
intermittently. Fixing `prepareAttachmentIsolated` (see unresolved item 1) is the single change
that should turn most of these green, and it must be fixed before any #38 acceptance claim.

## Rebuild attempt on integration tip `68557ab`

Main required a single-parent rebuild (no merge parent, no wholesale inheritance of the
79-commit reference branch). The branch is now `68557ab` plus a 164-file attachment-only
selection (every path matching `attachment`, plus `compatibility/ATTACHMENTS.md` and
`compatibility/omp/0010-image-original-budget.patch`), with the helper extensions in
`tests/continuation/worker.ts`, `tests/catalog/fixture.ts`, `scripts/omp-source.ts`,
`scripts/build-compatibility.ts` and `packages/attachments/README.md`. All 60+ old-branch
submission/navigation files, `compatibility/SUBMISSIONS.md`, `0007-durable-submission.patch`
and `0008-durable-navigation.patch` were dropped: #36 already ships that capability on
`68557ab` through patches 0001–0006.

Blocking finding: `compatibility/omp/0009-attachment-preparation.patch` was authored on top of
the reference branch's own 0007/0008 implementation. Applying it to `68557ab`'s 0001–0006 stack
fails at the first `git apply --check`, because the patch rewrites `src/modes/rpc/rpc-submissions.ts`,
`src/modes/rpc/strict-mode.ts`, `src/modes/rpc/wire/submissions.ts` and
`src/modes/rpc/wire/commands.ts` — files whose #36 content differs. Porting 0009 (56 hunks) and
0010 (3 hunks) onto the #36 stack is therefore the remaining #38 implementation work, and must
precede any format/consent/budget verification.

## Port attempt onto the #36 stack (9b21295)

Chosen path (Main, option a): keep `68557ab`/`0d22549` + patches 0001-0006 as the durable
submission authority; port only 0009/0010's attachment surfaces, adapting receipt/entry-parts
calls to #36 provenance instead of importing the reference branch's 0007/0008 persistence.

Method that works (3-way `git apply` cannot, it reports "cleanly" but silently skips adds):
```
git -C vendor/omp reset --hard 7c49c11 && bun run compat:prepare --reset   # 0001-0006 only
patch -p1 -d vendor/omp --forward --fuzz=5 < compatibility/omp/0009-attachment-preparation.patch
patch -p0 -d vendor/omp --forward --fuzz=5 < <rejects-from-previous-step>
patch -p1 -d vendor/omp --forward --fuzz=5 < compatibility/omp/0010-image-original-budget.patch
```
That lands all 14 `src/attachments/*` modules, the converters (pdf/docx/pptx/xlsx/epub),
`rpc-input.ts`, and the attachment command dispatch (`attachment_prepare`/`attachment_cancel`,
`rpcInputPolicy`/`attachmentInputPolicy` in the ready frame, `AttachmentCommand`/`AttachmentReceipt`
in `RpcCommand`/`RpcResponse`).

Still missing after that pass (30 files) — the remaining port, all cross-cutting plumbing:
```
  packages/coding-agent/README.md
  packages/coding-agent/scripts/gen-rpc/model.ts
  packages/coding-agent/scripts/gen-rpc/python.ts
  packages/coding-agent/src/cli.ts
  packages/coding-agent/src/extensibility/extensions/runner.ts
  packages/coding-agent/src/markit/converters/docx.ts
  packages/coding-agent/src/markit/converters/epub.ts
  packages/coding-agent/src/markit/converters/pdf/index.ts
  packages/coding-agent/src/markit/converters/pptx.ts
  packages/coding-agent/src/markit/converters/xlsx.ts
  packages/coding-agent/src/markit/types.ts
  packages/coding-agent/src/modes/rpc/rpc-input.ts
  packages/coding-agent/src/modes/rpc/rpc-submissions.ts
  packages/coding-agent/src/modes/rpc/strict-mode.ts
  packages/coding-agent/src/modes/rpc/wire/commands.ts
  packages/coding-agent/src/modes/rpc/wire/index.ts
  packages/coding-agent/src/modes/rpc/wire/submissions.ts
  packages/coding-agent/src/sdk.ts
  packages/coding-agent/src/session/messages.ts
  packages/coding-agent/src/session/session-required-features.ts
  packages/coding-agent/src/session/submission-policy.ts
  packages/coding-agent/src/session/submission-provenance.ts
  packages/coding-agent/src/session/submission-records.ts
  packages/coding-agent/src/slash-commands/acp-builtins.ts
  packages/tui/CHANGELOG.md
  packages/tui/README.md
  packages/tui/package.json
  packages/utils/CHANGELOG.md
  packages/utils/README.md
  packages/utils/src/stream.ts
```
The load-bearing ones: `packages/utils/src/stream.ts` (`readStreamBounded`, which every
attachment module imports), `session/submission-provenance.ts`
(`stageInputAttachmentMessage`, `takePreparedAttachmentMessages`),
`session/messages.ts`, `session/session-required-features.ts`, `modes/rpc/wire/{commands,index,submissions}.ts`,
`modes/rpc/rpc-submissions.ts`, `modes/rpc/strict-mode.ts`, `src/cli.ts` and `scripts/gen-rpc/*`.
Until those land, the candidate does not build and no attachment behaviour can be verified.

Regenerated patches from the partial tree must not be committed: `git diff HEAD` after a
fuzzy apply omits untracked adds unless staged first, which silently produces a 30-file
patch that looks complete and applies cleanly while dropping every new module.
