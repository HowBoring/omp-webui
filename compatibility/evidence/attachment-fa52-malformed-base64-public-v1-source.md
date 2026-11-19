# Malformed base64 public refusal: Source only

This adds one agreed public-RPC negative case for #38 at parent
`251383b43050508dc43cd9b3a7b295090bdd2348`. Scope comes from
`/workspace/work/mvp-implementation/recovery/ticket38-post-image-budget-negative-frontier-20261117/PLAN.md`.
Whole #38, #53, #54 and #29 remain open.

The caller supplies one valid 28-byte UTF8 original and one schema-valid UTF8
object with raw data `%%%%` and an explicit all-zero SHA declaration. That
declaration is not a hash of decoded bytes: invalid base64 has no decoded original.
The test sends raw `worker.request(attachment_prepare)`, bypassing client-side
original-byte validation, and checks the response using `isAttachmentReceipt`,
the existing generated public receipt schema. The valid item must be ready with
its independently pinned prepared hash; the other must report stable
`attachment_invalid_base64`, an empty prepared hash, and a failed overall receipt.
Submission must return `ATTACHMENT_NOT_READY`; public query must show no
reservation/admission/relations. Entry snapshots and controlled-provider counters
must remain exactly unchanged both after preparation and after refused submit.
The complete caller draft, including malformed raw string and declaration, must
remain exact. This is caller retention, with browser persistence still unproved.

The case explicitly selects `image-original-budget-v2` for public preflight,
catalog and worker. Its existing public preflight gate pins additive build
`d8d12deee18a1b8a56c57785f8bf2f5a23fbb3a21389427cf9fc4eba6e5622d9` /
`069eaf6f90773d17d09bf4c3faf3f66ade3a3e362156e03650701ecad4e31b8c` /
`8f9c3a086dade38eee57fdb535f1d5b66e81a1f770a2f44e9bc077f41b0e5566`.
The physical generated Native identity remains distinct. No Native source/schema/index,
generator/build, Host runtime or candidate artifact changed.

Source checks: full normal Host `tsc --noEmit -p tsconfig.json` PASS; source AST
PASS with all prior 13 tests byte-exact and exactly one new case (12 direct expect
calls); retainer whole-source comparison and Python syntax PASS. An initial
AST-tool subprocess EPERM is preserved separately; the corrected source auditor
reads the parent Git blob from stdin and launches no subprocess. No Native test,
import, actor, preflight, codec, retainer pre/run/post, build or generator ran.
Red/green runtime evidence is pending Root's fresh reviewed Native window.

Fresh Source plan:
`/workspace/work/mvp-implementation/recovery/ticket38-malformed-base64-public-v1-source-20261117/`.
`final-inputs.json` composes the existing public-v3 978-record freeze with a small
Host delta and preserves the old hashes; no full source/inventory copy.
`public-retainer.py` retains the proven public-v3 lifecycle/capture logic with
new unique prefixes and one anchored case; thirteen other cases are filtered.
Fresh paired Source review is required before Root metadata pre, exactly one
actual run, and metadata post in a coordinated one-window/no-provider scope.
All previous actual/failed scopes stay consumed; first failure remains failure,
with no retry, expectation weakening or numeric recovery. Original lifecycle
uncertainty holds the original owner/readers to EOF. No Windows, global OMP,
product/private admission, descendant extinction or browser claim is made.
