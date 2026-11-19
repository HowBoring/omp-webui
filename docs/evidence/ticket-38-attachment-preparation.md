# Ticket 38 attachment preparation — executed evidence

Status: **implemented and verified on this tree.** Every row below was executed here; nothing is
projected. Scope limits are listed at the end.

## Tree identity

| Input | Identity |
| --- | --- |
| Native base | `7c49c11aa5bbaf3f418406583096168ad5b8c6dc` |
| Patch stack | `0001`–`0007`, `0009-attachment-preparation`, `0010-image-original-budget` |
| `sourceSha256` | `46bf7ddf2fb78c6499e8cc4e5c23ba68d57aeecae07d7e29ca5b213f2731b57c` |
| `patchSha256` | `6113e6be5a1156f891e2d697ca96a67ccec9b536a459ef6d182da5b6716545ea` |
| `schemaSha256` | `177282c33cc393c9ddbf9136eacffb6151b17dd6b349514061ae66b1ba9eb2ab` |

The three digests were recomputed independently with `sha256sum` over
`vendor/omp/packages/coding-agent/src/modes/rpc/wire/rpc-wire.schema.json` (pretty-printed form) and
the ordered patch files listed in `scripts/omp-source.ts`, and equal the values `compat:build` prints.

`0008-durable-navigation.patch` is **not** in this stack: durable navigation is #37's candidate. The
native difference between this branch and `origin/mvp/ticket-38-text-budget-source` is exactly the
navigation surface; `0007-durable-submission.patch` is carried byte-identically from that branch
(`sha256 0a939368406e34cc39b43945c777931157b30fdf05ab5eb51ae481ed55527957`), keeping #36 as the durable
submission authority.

## Commands and results

| Command | Result |
| --- | --- |
| `bun run compat:prepare --reset` | `Fixed OMP source patch and isolated frozen dependency installation prepared.` (from a clean `vendor/omp` at `7c49c11`) |
| `bun run compat:build` | both candidate outdirs `candidate-built`, digests above, `files: 2` |
| `bun --no-env-file scripts/check-attachment-native.ts` | `Authored native attachment modules: strict TypeScript PASS (unrelated upstream diagnostics excluded)` |
| `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | exit 0 |
| `./node_modules/.bin/tsc --noEmit -p tsconfig.scripts.json` | exit 0 |
| `bun test --no-env-file --preload "$PWD/compatibility/omp/fixtures/no-provider.ts" tests/attachments --timeout 300000` | **95 pass / 0 fail**, 65 s |
| `python3 scripts/test-attachments-native.py <14 fixtures>` | **49 pass / 0 fail**, 3.4 s, `actualNetworkDispatches == 0` |
| `tests/browser/attachment-browser.py` (Chromium → DSH Remote → Host → OMP) | PASS, evidence in [ticket-38-browser.json](ticket-38-browser.json) |

The Bun suite must run with `--no-env-file --preload compatibility/omp/fixtures/no-provider.ts`:
`tests/attachments/public-rpc.test.ts` requires the egress guard symbol and `os.tmpdir() === "/tmp"`,
otherwise it aborts with `ATTACHMENT_PUBLIC_FIXTURE_PREIMPORT_GUARD_AND_TOP_TMP_REQUIRED`.

## Native fixes carried by `0009`/`0010` in this port

1. **Isolated converter budget.** `ATTACHMENT_LIMITS.conversionDataBytes` was 512 MiB, but a Bun child
   needs more than that just to parse the converter module graph (peak 0.42 GB observed before the
   allocation failure), and `--fsize=0` makes Bun's own crash report unwritable, so the child exited
   silently and every conversion surfaced as `attachment_converter_resource_failure`. The ceiling is
   now 2 GiB; `--fsize=0` stays (no disk writes is part of the isolation contract).
2. **Staged provenance for derived messages.** `agent-session.ts` captured the custom message before
   `copySubmission(message, customMessage)`. `copySubmission` refuses a target that already owns
   provenance, so genuine `/skill:`, file-command and prompt-template expansions dropped every staged
   `PreparedAttachmentLink` (`tests/attachments/expansions.test.ts`). Swapping the two statements fixes
   every expansion path, not just the asserted one.
3. **Workspace `pi-utils` link.** The frozen runtime ships a published `@oh-my-pi/pi-utils` that lacks
   `readStreamBounded`/`image-animation`; `prepare-compatibility.ts` now replaces that package with a
   symlink to `vendor/omp/packages/utils` (in this worktree only, so the main worktree is untouched).

## Behaviour matrix (real native candidate)

`tests/attachments/public-rpc.test.ts` drives the public candidate worker (`vendor/omp-candidate/cli.js
--mode rpc-ui --strict-start`) over real stdio for every row:

| Case | Test |
| --- | --- |
| PNG + UTF-8 text commit exact indexed parts, query and history links | `actual public PNG and text commit exact indexed parts with matching query and history links` |
| JPEG | `actual public JPEG preserves prepared bytes through indexed saved image and provider delivery` |
| WebP (transformation consent) | `actual public WebP requires transformation consent before indexed saved image and provider delivery` |
| Animated GIF (loss consent) | `actual public animated GIF requires exact loss consent before indexed saved image and provider delivery` |
| PDF / PPTX / XLSX / EPUB (structure consent) | four `actual public … requires structure consent before indexed saved text and provider witness` cases |
| DOCX | `actual public DOCX requires exact degradation consent before indexed saved text and provider delivery` |
| Atomic failure (mixed valid + invalid) | `actual public failed mixed preparation refuses all input before reservation or effects` |
| Malformed base64 with valid UTF-8 | `actual public malformed base64 with valid UTF8 refuses all input before reservation or effects` |
| Cancel then late consent | `actual public cancelled ready UTF8 receipt refuses late consent before reservation or effects` |
| Text budget +1 byte | `actual public 5MiB UTF8 requires truncation consent and refuses one byte over before effects` |
| Count/total budget | `actual public eight UTF8 objects at 32MiB require consent and refuse count and total excess before effects` |
| Image original budget +1 byte | `actual public 10MiB PNG requires transformation consent and reports original budget for one byte over` |
| Draft/target/object/permission changes | `bridge.test.ts` (`all actual degradations require explicit consent…`, `revocation after consent refuses consumption before native submission effects`, `draft edit after preparation refuses old consent and preserves the whole input`, `an authorized draft cannot cancel an unowned native preparation by guessing an ID`) |
| Encoding budgets | `input-policy.test.ts` (bounded native stdin policy) plus `compatibility/omp/fixtures/attachment-rpc-budget.test.js` and `attachment-budgets.test.js` in the native matrix |
| Degradation review surface | `preparation-remote.test.ts`, `controller.test.ts`, `client.test.ts`, `remote.test.ts` |

The native fixture matrix (`attachment-formats`, `attachment-budgets`, `attachment-rpc-budget`,
`attachment-isolated`, `attachment-receipt`, `attachment-records`, `attachment-dispatch`,
`attachment-entry-parts`, `attachment-image-facts`, `attachment-input`, `attachment-input-policy`,
`attachment-package`, `attachment-provider-guard`, `attachment-native`) covers the same conversion
and receipt rules without a Host, with zero egress attempts.

## Browser acceptance (real DSH page, real Host, real OMP)

`apps/attachment-fixture` + `apps/host/src/attachment-fixture-main.ts` host an isolated page: the page
mounts the real client `Context` (connection/registry/gateway), calls `ompAttachments/begin|status|consent|cancel|finish`
over the typed DSH Remote, and the Host drives `AttachmentSubmissionGate` into the real candidate
worker. The page never sees a file path; it selects controlled projections and renders the receipt.

Reproduce:

```sh
bun run compat:prepare --reset && bun run compat:build
bun --no-env-file apps/attachment-fixture/build.ts
bun --no-env-file apps/host/src/attachment-fixture-main.ts   # 127.0.0.1:3187
ATTACHMENT_URL=http://127.0.0.1:3187/ uv run --quiet --with playwright python3 tests/browser/attachment-browser.py
```

Recorded run (`docs/evidence/ticket-38-browser.json`, 2026-11-19T11:11:06Z): select UTF-8 + PNG →
`awaiting-consent` with two prepared cards → explicit consent → `submission_submit` admitted
(`reservation: committed`, `admission: local`) → `submission_query` returns
`inputOutcome: generated` with three relations, `prepared` (text, `entryPart` present) and `input`
(image, `entryPart` present) both `observed`/`committed`, and both `PreparedAttachmentLink`s carrying
`preparedId` + `preparedSha256`. Receipt `84ea8713-…`, submission `09eacb44-…`.

The Host refuses nothing here but stays at `sessionAdmission: "blocked"` for every other route; the
page serves only digest-matching assets and a strict CSP.

## Limits (explicit)

- The isolated page proves **UTF-8 + PNG**. The other eight native formats are proven at the native
  fixture and public RPC suites, not through the browser, because this repository does not host the
  product DSH app shell; `apps/*` are isolated fixtures by design.
- The gate allows two Send attempts per Host lifetime; a second full browser run needs a fresh Host.
- Evidence is Linux/Chromium only. Windows Chrome and WSL2 acceptance remain open (owner-deferred).
- Product/global Session admission, history/restart/copy/branch/restore over prepared attachments,
  and independent review remain open.
