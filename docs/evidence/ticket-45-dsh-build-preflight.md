# Ticket 45 and 46 DSH build preflight

The combined [source candidate](../../compatibility/dsh/chat-and-tool-source-candidate.json)
at DSH tree `e011120c10c66dc067e2787054d21b52b2a15de1` failed persistence generation and
Client compilation. The [first inactive follow-up](../../compatibility/dsh/candidates/chat-and-tool-preflight/0008-dormant-cohort-preflight-fixes.patch)
removes a Cordis dispatch tag from the persisted event declaration and adds the missing
`FixtureSession.reconcilePromptError` method. Its default throws, matching the fixture's
existing convention. Tests can supply an override when they need to exercise the method.
The [second follow-up](../../compatibility/dsh/candidates/chat-and-tool-preflight/0009-dormant-client-fixture-types.patch)
updates existing Client test fixtures to implement the Session face and use the public raw
and parsed argument types.

| Source input | Identity |
| --- | --- |
| Host source descriptor commit | `45797ee830593435e58601e727617dcff8c7e2d7` |
| DSH tree after patches 1–7 | `e011120c10c66dc067e2787054d21b52b2a15de1` |
| Patch 8 SHA-256 | `3d3dd8512a7ae80a94e71ef5f0d0e73b9ef60818da8bb9048128a1f20d093ac2` |
| DSH source tree after patch 8 | `d9d6463ba9db6340fcf7202621b1591ceba34915` |
| Patch 9 SHA-256 | `afc955558426f461303cf17d06f745fe411af629999f3c00cedf8bcf40bdd88b` |
| DSH source tree after patch 9 | `1959e66066b7ddd6fc40c8f54c89afd48aa789d9` |
| Frozen DSH lockfile SHA-256 | `e32cb5d1bcf3c48c7570fc6b2014d3b2f0a65025031ee489b29173da8137cf6f` |

## Exact candidate results

Git verified the bytes of all seven patches and each declared tree in a complete scratch
checkout. Node 24.22.1 and pnpm 11.28.5 installed the frozen lock across 398 workspace
projects with 1,433 packages and zero downloads. Source files and the package store lived
in isolated writable copies. The original Git objects were read through an alternate.

| Check | Result |
| --- | --- |
| Upstream persistence catalog generator | Exit 1. `tool/parsed-call` at `packages/core/session/src/types.ts:378` carries an `@mode` tag, which the persisted-event catalog rejects. |
| Upstream bundle-free typecheck | Two passes, one failure, two skips. Host Typert and Host package compilation passed. Client package compilation failed. Serial scheduling skipped both aggregate checks. |
| Direct Client compiler diagnosis | TS2420 and two TS2322 errors at `packages/test-support/client-runtime/src/sessions.ts:39,632,797`. The public `ISession` interface requires `reconcilePromptError` on its implementing fixture. |

The usual `tsx` CLI launcher hit `EPERM` while opening its local IPC server. The Node
`tsx/esm` hook ran the same upstream script with the same locked loader and no listener.

## Corrected Client consumers

Patch 8 passed Typert generation, both package compilers and the Host aggregate check.
The Client aggregate exposed 26 strict errors across 16 existing fixtures. Some fixtures
assumed every Tool call had raw arguments. The Conversation registry fixture lacked the
new Session method. Patch 9 restricts raw fixture constructors to the raw variant, builds
the `PartialArguments` value from each settled record's actual representation, and adds a
fail-loud reconciliation stub. The source-only tree then passed all five upstream typecheck
steps with TypeScript 6.0.3. The 16 changed Client suites passed all 452 existing tests.
In a second scratch checkout, the previously generated persistence files stayed fresh after
applying patch 9 in order. Generating the catalog in the compiler checkout and running the
five typecheck steps again also passed. Its generated schema matched the reviewed inventory.

## Scoped Linux Client and Web artifacts

The corrected source tree, generated persistence inventory and frozen dependencies
produced Client and Web artifacts in an isolated Linux checkout. The bundlers used DSH's
repository-derived public values `DSH_CLIENT_COMMIT_HASH=38a6a5c`,
`DSH_CLIENT_GIT_DIRTY=true`, and `DSH_CLIENT_VERSION=0.2.2-rc.3` in the clean offline environment.

An initial Client-only bundle exited 0 with 114 unresolved-import warnings. Web exited 1
after six modules because `@deepseek-ai/cordis` exported `lib/index.js` before the Host pass
had emitted it. The initial 211 output files were hashed and retained in scratch. The
documented Host compile and bundle exited 0 and emitted the missing Cordis entry. The
subsequent Client compile, Client bundle, and Web build all exited 0. The Host and rebuilt
Client bundles reported zero unresolved-import warnings. Both upstream aggregate checks
passed against the resulting artifacts.

| Readback | Observed result |
| --- | --- |
| Host Cordis `vendor/cordis/lib/index.js` SHA-256 | `627409afa06a265f7253200d3bc4648e88805c39fd3768568eb9b9518a31fe8f` |
| Dynamic Client bundles, assets and Web dist | 371 files, including 160 Web files, totaling 79,545,767 bytes |
| Scoped artifact SHA-256 | `f1f03d3935a6d5265d4fd79250bbd2cfecddba2fb8dd2d1a4400ffe96dd135f9` |
| `apps/web/dist/index.html` SHA-256 | `88718bd0dee8057e959b2dbcf06a6b95267bb5277a252a1b8142906a689d2b2e` |
| `apps/web/dist/preview.html` SHA-256 | `d0d8a22d8b419c600bfd884f804263c391331310ee9138a33cc5890878f2901f` |

The scoped digest uses DSH's artifact path patterns and length-prefixed path and file bytes.
Both HTML entry points resolved their local module references. Static readback found
`reconcilePromptError` in the Session Controller bundle and `tool/parsed-call` in the Chat
and Trajectory bundles. The complete-build record reader rejected the scoped artifacts
because the record was absent. This run covered the Host, Client and Web build steps.
The complete release build and browser admission remain pending.

After the corrected source typecheck and catalog generation below, run the upstream
component commands from the DSH root with the observed `repositoryClientBuildEnvironment`
values and the same isolated offline environment.

```bash
export DSH_CLIENT_COMMIT_HASH=38a6a5c DSH_CLIENT_GIT_DIRTY=true
export DSH_CLIENT_VERSION=0.2.2-rc.3
node --import tsx/esm scripts/compile-referenced-projects.ts host
corepack pnpm exec tsdown --config-loader native --env.DSH_BUILD_FACE host
node --import tsx/esm scripts/compile-referenced-projects.ts client
corepack pnpm exec tsdown --config-loader native --env.DSH_BUILD_FACE client
corepack pnpm run build:web
node --import tsx/esm scripts/build.ts --scope check --serial
```

## Persistence review still required

With the invalid tag removed, the upstream generator wrote both language catalogs, their
pairing records, the schema inventory, and the runtime event vocabulary. Its freshness
check passed. The persistence checker then reported `unacknowledged-changes` for two roots.
The structural review found 635 unchanged type fingerprints and one added envelope variant.

| Root | Previous digest | Generated digest | Classification |
| --- | --- | --- | --- |
| `SessionEventEnvelope` | `5776e5553ff2dfe3f5bc202dbb1e7c9f93e35a531aebb7764c23b2b6153b2ccc` | `078337812ffcc2bbbb598955524742eafd935b3f99e58ec22e27e434835d0c36` | Union variants changed, compatibility review required |
| `event:tool/parsed-call` | New root | `da19de2a7701b28ddf2ff3e6088989b08b5b6b6e33dcf842e39951054ac0e281` | Root added, same-version allowed |

In a diagnostic copy, reverting only the event-specific `ignorable` restriction reproduced
the previous envelope digest. The restriction removes the optional marker from the parsed
event's generated envelope arm. The new event root remained and its digest changed to
`f6d3c37650e3fdfb10701c4fd6545598676fe31200797987ccba24ceabb28875`.
Restoring the required-event type and running the generator again reproduced the inventory
byte for byte with SHA-256 `1d78dc44704be9d768e427bb74c64e814d6917d432166ad9e6940879d0bb021a`.

A public `sessionFormatCatalog.createRestore` probe read an ordinary V4 turn-start event
with both vocabularies. The older vocabulary refused the required `tool/parsed-call` event.
The generated vocabulary retained the exact nested JSON object. It also accepted a synthetic
stored parsed event marked `ignorable: true` at runtime, even though the TypeScript event
type forbids that marker. The probe used a display event and exercised no Native tool
lifecycle. The existing V4 lifecycle rules still require a matching raw tool-call lifecycle
for ordinary `tool/result` records.

Bilingual verification reported five stale package README pairs after catalog generation.
The named pairs are `ui-chat`, `ui-conversation`, `ui-tool`, `ui-trajectory`, and `core/session`.
Refreshing those five records in scratch made the repository-wide check pass for all
1,255 pairs. The README content was already paired.
The next persistence step is the upstream compatibility review for the envelope change,
including the full reader behavior and the policy for an invalid stored marker. The tool
requires an explicit decision if the change keeps the existing writer version. Generated
persistence files and refreshed pairing records stayed in scratch.

## Required parsed-call reader follow-up

Dormant patch 10 rejects `tool/parsed-call` with `ignorable: true` once the V4
reader recognizes the event type. It reports `SessionFormatError` with the type
and sequence number. The existing unknown-event gate still controls admission
and opaque retention for events outside the reader's vocabulary.
[Patch 10](../../compatibility/dsh/candidates/chat-and-tool-preflight/0010-required-parsed-call-restore.patch)

| Source input or result | Identity |
| --- | --- |
| Patch 10 SHA-256 | `e635170e56d5c6b54a4644fce70f8ec5c799e24d87d9f4dc05a2756584a3d1b4` |
| DSH tree after patch 10 | `ab953b9e2c3a9f5e1ede44d6b583a9f54a4945ad` |
| Retained generated vocabulary SHA-256 | `ed28bfd0a7f2f43cb371aa99a7ba9ec4789f6b8b69acb527f0f0ca8e48d683ed` |
| Staged legacy vocabulary SHA-256 | `6583955525dd8b6869be2c476821f66c837519b7001ba134ab2fb2ecb57ecba9` |

Git verified patches 1–10 in order in a private index with a read-only object
alternate. Reversing patch 10 returned the exact tree after patch 9. Its sole
DSH source change is in `session-format-v3-to-v4/src/validation.ts`.

The [reader fixture](../../compatibility/dsh/candidates/chat-and-tool-preflight/required-parsed-call.fixture.ts)
feeds stored JSON rows through `sessionFormatCatalog.createRestore` with strict
recovery and current validation. Bun 1.4.4 reproduced one failure and three
passes with the generated vocabulary and patch 9. With patch 10 all four
passed. The fixture verifies that the same standalone parsed row retains nested
JSON without the marker and fails with it. An unknown ignorable row remains
opaque, and the original raw argument string survives restore. With the staged
legacy vocabulary, all three checks passed both before and after patch 10. The
same unmarked parsed row fails as unknown, its externally marked form remains
opaque, and the raw spelling survives restore.

To replay the fixture, resolve the DSH workspace paths from `tsconfig.base.json`
to absolute source paths in an owned preparation. For each run, direct the
`@deepseek-ai/dsh-session` and `@deepseek-ai/dsh-session-format-v3-to-v4` aliases
to the corresponding source copies with the vocabulary and validator selected
above. Set `DSH_READER_TSCONFIG` to that config and `DSH_READER_TEST_VOCABULARY`
to `dormant` or `legacy`, matching the selected vocabulary.

```bash
BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 bun test --no-env-file \
  --tsconfig-override "$DSH_READER_TSCONFIG" \
  --test-name-pattern "$DSH_READER_TEST_VOCABULARY vocabulary|both vocabularies" \
  ./compatibility/dsh/candidates/chat-and-tool-preflight/required-parsed-call.fixture.ts
```

Scoped strict TypeScript 6.0.3 checked the validator and fixture against the
prepared dependency declarations. Oxlint 1.81.0 produced zero diagnostics on
both files. Patch 10 remains outside the active and dormant manifests. Upstream
persistence acknowledgement, generated catalog and pairing review, durable
parsed tool and result ordering, matched build and browser proof, and Native
ownership after reopen remain pending.

## Reproduce

Reconstruct patches 1–7 in an owned, complete DSH checkout by following the
[source composition replay](ticket-45-dsh-source-composition.md#reproduce-the-source-check).
Use the checked-out source from the reconstructed index. Use isolated copies of the package
store, pnpm cache and Corepack cache with the existing locked dependency bytes. Run the
following from the DSH root in an `env -i` shell with scratch `HOME`, `TMPDIR` and XDG paths,
Node 24.22.1 and Corepack on `PATH`, pnpm 11.28.5 in `COREPACK_HOME`, and
`PNPM_CONFIG_STORE_DIR` pointing to the scratch store.

```bash
export COREPACK_ENABLE_NETWORK=0 PNPM_CONFIG_OFFLINE=true
export BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 NODE_DISABLE_COMPILE_CACHE=1
corepack pnpm install --offline --frozen-lockfile --ignore-scripts
test "$(git write-tree)" = e011120c10c66dc067e2787054d21b52b2a15de1
git diff --exit-code
node --import tsx/esm scripts/gen-persistence-catalog.ts
node --import tsx/esm scripts/build.ts --scope typecheck --serial
node --import tsx/esm scripts/compile-referenced-projects.ts client
```

Run the checks separately to collect both failures. Set `DSH_PREFLIGHT_PATCH` and
`DSH_FIXTURE_PATCH` to the absolute paths of patches 8 and 9 and verify both SHA-256 values.
Apply the patches in order. The generator writes checkout-local files. The subsequent
preview and pairing checks are
expected to fail with the findings above.

```bash
git apply --index --whitespace=error "$DSH_PREFLIGHT_PATCH"
test "$(git write-tree)" = d9d6463ba9db6340fcf7202621b1591ceba34915
git apply --index --whitespace=error "$DSH_FIXTURE_PATCH"
test "$(git write-tree)" = 1959e66066b7ddd6fc40c8f54c89afd48aa789d9
node --import tsx/esm scripts/build.ts --scope typecheck --serial
node --import tsx/esm scripts/gen-persistence-catalog.ts
node --import tsx/esm scripts/gen-persistence-catalog.ts --check
node --import tsx/esm scripts/build.ts --scope typecheck --serial
node --import tsx/esm scripts/persistence-changes.ts --check --json
node --import tsx/esm scripts/verify-translation-pairing.ts
```

Run the existing Client suites affected by patch 9 against the corrected source.

```bash
mapfile -t tests < <(git diff --name-only d9d6463ba9db6340fcf7202621b1591ceba34915 \
  1959e66066b7ddd6fc40c8f54c89afd48aa789d9)
node node_modules/vitest/vitest.mjs run --project thread-safe --maxWorkers 1 "${tests[@]}"
```

In the scratch checkout, refresh the five paired READMEs and repeat the pairing check.

```bash
node --import tsx/esm scripts/verify-translation-pairing.ts --write \
  packages/client/ui-chat/README.md packages/client/ui-conversation/README.md \
  packages/client/ui-tool/README.md packages/client/ui-trajectory/README.md \
  packages/core/session/README.md
node --import tsx/esm scripts/verify-translation-pairing.ts
```
