# Explicit per-image original budget — SOURCE only

The public 10MiB positive case passed at `94436ed8`; its immutable actual proof
is retained at `7cc3bf1`. The extra-byte path then returned generic
`attachment_converter_error`, followed by submit `ATTACHMENT_NOT_READY`. That
actual result remains diagnostic-gap evidence; this source change does not
retroactively turn it into a clear-budget PASS.

The existing Native `prepareAttachment` boundary already reports
`attachment_original_budget` for format-specific raw originals. Reuse that
reason in receipt item preparation after strict base64 decoding and original
SHA verification: image formats with decoded byte length **greater than**
`ATTACHMENT_LIMITS.imageBytes` fail before image capability checking or isolated
helper creation. The public failed-item schema already carries `code: string`.
No new wire fields, schema, protocol/budget version or API semantics are needed.
No exception-message matching or converter-error remapping is introduced.

Exactly 10,485,760 bytes still proceed through ordinary image preparation;
10,485,761 bytes return a failed receipt item with empty prepared digest and
`attachment_original_budget`. Receipt binding, all-item reporting, whole-input
`ATTACHMENT_NOT_READY` admission refusal, cancellation and caller draft retention
remain unchanged. The raw 8-object/32MiB, full encoded 48MiB, decoded/model and
prepared limits remain separate and unchanged. No target shrinks and no item is
silently omitted or converted to text-only admission.

The existing public RPC boundary case was updated before Native source editing:
its extra-byte expectation now requires the stable original-budget reason and
its title identifies the new contract. The full old 94,592B source is retained
outside the worktree; the first twelve cases retain their exact 85,975B prefix.
The last case's positive/consent/commit/history/provider/query body is exact AST;
only its title and the negative helper's expected code/comment change. The
independent valid-PNG generation, hashes, pixel oracle and literal expectations
remain unchanged. Historical literal/Ready files retain immutable pre-run labels
and their generic-error expectation; they are not readiness for this source.

**No actual RED/GREEN ran.** The updated public assertion was preserved as a RED
expectation while Native receipts still matched the old preimage. Native-bearing
tests are forbidden in this SOURCE assignment. The historical generic result is
the regression baseline, not an executed new red test. TypeScript parse/transpile
and AST scope checks passed, as did in-memory application of the small source
patch against exact preimages. These checks prove syntax/scope/correspondence,
not semantic typechecking or runtime behavior. An initial external checker
selected the old capability guard by the wrong statement index; that failure
and checker preimage are retained, and corrected checker PASS is separate.

Before editing, 883 enrolled inputs, Native166/build290 references, the Native
index, patch/schema/generated identities and nine selected small text preimages
were preserved and verified outside the worktree. Native changes are exactly
receipts.ts, its public documentation and its unreleased changelog. Native163,
old matched-input286 and inherited878 records remain byte-exact; the other five
inherited overrides have exact retained preimages. No binary/build/tree/profile,
Native Session/history or key was copied. Patches1–9 remain unchanged; the new
ordered `0010-image-original-budget.patch` contains only those three Native
changes, and `scripts/omp-source.ts` appends it. Native source remains explicitly
dirty; no Native index change, commit, reset, checkout, rebase or silent rollback.

**New combination: NOT BUILT / NOT RUN.** Existing candidate, generated validators,
wire schema and build identity remain historical artifacts and cannot earn
admission for changed receipts or the new ordered source fingerprint. The schema
is expected unchanged because no schema source changes; this has not been
regenerated. A future approved build must enroll the new source/patch tuple and
regenerate source-bearing build identities without mixing old artifacts.

Build/generator execution is held for Root scope agreement. Existing export and
verify/build helpers call `git add -N`; prepare can reset a checkout and build
can replace outputs. None ran. A future reviewed plan must preserve the exact
dirty delta, use separately approved non-destructive index/output handling, and
install the no-provider guard before every Native import with a fresh synthetic
HOME/environment. Review expected generated/schema differences and produce a
new matched-artifact manifest before any public test. No generated file should
be hand-edited to claim a match.

A later public retest needs a new source/build freeze, fresh output/profile/scope,
reviewed retainer and Root's coordinated single actual window. The old 10MiB
retainer and Ready are consumed and must not be reused or rechecked as pristine.
This source slice grants no runtime permission. Paired SOURCE review is next;
negative-format matrices remain outside this slice. Full Q6, final cohort,
DSH/browser/original storage/draft recovery, global/private/product admission and
whole29/38/53/54 remain open.
