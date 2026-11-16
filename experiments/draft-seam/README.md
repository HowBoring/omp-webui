# Ticket 39 — public DSH semantic drafts

This is a **client/provider/Remote fixture**, using synthetic original bytes and actual built DSH Conversation,
editor, runtime uploads and Linux Chromium. It neither exposes product Sessions nor proves a durable Host
Attachment Original store. Ticket30 review/integration is a required handoff gate. Windows Chrome/WSL2 is deferred
by explicit user direction.

The additive patch follows fixed DSH `38a6a5c965aa99ab525161efb7cc5cf1fe62fced` plus the audited navigation/action
policy prerequisite. Unmodified DSH consumers retain stock persistence and TUI remains OMP.

Public APIs exported by `@deepseek-ai/dsh-client-ui-conversation/client`:

- Config `draftPersistence: 'provider'` disables the old shared SessionId draft read and the entire Conversation
  store's shared persistence write. The provider owns keys and persistence. Default remains `'stock'`.
- `conversation.input.registerDraftProvider(ctx, provider)` is an exclusive registration owned by `ctx.effect`.
- `input.draft(binding)` returns an observable semantic snapshot with `scope`, hydration `revision`, `phase`,
  semantic `draft`, ordered `originals`, and separate ephemeral `readiness`.
- `input.restoreDraft(binding, signal?)` reads through the provider; `input.hydrateDraft({binding, scope,
  expectedRevision, record, signal?})` restores a supplied record. Both prepare current original bytes and new
  DSH runtime uploads/receipts for editable records. Neither submits. `parseSemanticDraftRecord(unknown)` validates persisted records, including distinct branded original/submission identities. Public constructors validate the other opaque scope identities without imposing OMP-specific formats.
- A provider-mode attempt durably writes its `unresolved` semantic snapshot before command adjudication or Remote execution. Publication failures/cancellation block execution. Refresh restores quarantine without preparing receipts. Transport failure, acceptance and withdrawal never automatically clear it.
- Optional `provider.beforeDispatch(scope, {submissionId, requestId}, signal)` durably associates the local marker with the exact public DSH prompt request before dispatch. Neither ID is a Native receipt or proof of durable native entry commitment.
- `input.resolveDraftSubmission({binding, scope, expectedRevision, submissionId, outcome, signal?})` accepts an explicit authoritative `accepted`/`not-submitted` decision, persists it before unlocking, and never sends. Explicit editor ownership protects a newer draft without text matching.

`DraftScope` separates persisted Host/origin/data-directory identity, source identity, native Session identity,
page owner and provider storage key from transient projection generation. A storage key must survive Host restart;
including a process/run/projection generation in it would lose recovery. The live scope and exact retained
`SessionBinding` object are checked again after every asynchronous boundary and before publication.

The hydration revision advances with text/attachment edits and submission entry. It differs from
`InputState.draftRev`, the existing editor span CAS. A restore begun before a submission remains stale even when
that submission fails and the phase becomes editable again. Newer restore, cancellation, provider withdrawal and
final binding release fence late callbacks; created runtime uploads/previews are released on failure. Provider
withdrawal releases its committed runtime handles, invalidates readiness, preserves text/originals, and retains
the same observable source across replacement registrations. A failed
preparation retains the current complete draft. Explicit invalid originals preserve restored text and stable
references with visible reasons and block sending until retry/removal.

The provider returns freshly authorized bytes or an explicit invalid reason for each original, in order.
DSH owns upload handles and receipts. Stable original records reject extra receipt/URL/runtime fields. Original IDs
are logical references, never paths, hashes-as-authority, or receipts. This seam does not assert authorization or
retention guarantees that belong to the eventual Host provider.

The fixture provider uses sessionStorage for semantic records and a held Web Lock for its owner identity.
An actual `window.open` copies storage, then obtains an independent owner because the original owner remains
locked. Refresh reclaims its prior owner. Copied records begin as a snapshot; subsequent edits are independent.
No recovery after closing the page/browser is promised. Provider writes distinguish `edit` from `hydrate`;
automatic hydration/refresh never renews its recorded edit time. A production provider must use Host-confirmed
retention facts rather than treating this browser clock as authority.

Reproduction (tool paths in `IMPLEMENTER.md`; invoke from this repository):

```sh
# Prepare/build the fixed DSH tree with ordered policy + semantic-draft patches using compatibility build tooling.
DSH_SOURCE=vendor/dsh-review bun run dsh:prepare
bun scripts/link-dsh.ts vendor/dsh-review
bun run diagnostics:build
DSH_SOURCE=vendor/dsh-review experiments/draft-seam/run.sh
bun experiments/draft-seam/record-evidence.mjs vendor/dsh-review experiments/draft-seam/evidence
```

The fixture adds the official attachment presentation plugin and its declared dependencies to the earlier
Conversation baseline; the resolved graph is retained and is not a final product roster.

The fixture Host binds loopback and serves controlled synthetic Remote responses/raw original/upload bytes only.
It uses actual `ClientModuleRegistry`, boot injections, public WebServer export, Connection Remote mux parsers and
DSH client manifests; it starts no DSH Agent/runtime or OMP worker. `session/create` and prompt requests are
recorded. The browser scenario first verifies no implicit prompt/create calls, then makes exactly two explicit logical prompt calls for delayed acceptance and lost-response refresh recovery; Session creation stays absent. Public provider/component tests live inside the source patch and
run through the actual Conversation plugin's public `conversation.input`, with DSH's controlled public Session/
upload test boundary. The generated plugin bundle and all cloned/built DSH assets stay in ignored `vendor/`.

See `SEAMS.md` for accepted testing boundaries and `evidence/validation.json` for exact checks and limits.

The browser scenario defaults to Linux `/usr/bin/chromium`. `BROWSER_EXECUTABLE` can select actual Chrome in
another supported test environment; it never emulates a Windows navigator. Run the same Python scenario from
Windows against the WSL2 Bun fixture with its `server.json` available on the shared checkout when that explicit
acceptance resumes. This option has not been executed on Windows; current evidence remains Linux-only.

The upstream package README/JSDoc changes are included in the reproducible draft patch. The navigation prerequisite remains byte-identical. `patches.json` supersedes the reviewed initial draft source tree with the corrected authored tree; the diagnostic build requires this exact candidate. Source, build record, actual served assets, fixture graph and Host diagnostic inputs form the final evidence tuple.

The provider must check its storage CAS authority and the supplied signal at publication, including delayed writes after withdrawal. Client cancellation bounds waiting and rejects late effects; it cannot undo a noncompliant external provider's write. The fixture stores semantic records and request correlations in tab-owned sessionStorage and demonstrates the interface, not production Host durability, authorization or native outcome lookup. Native reconciliation for #36 and durable Host draft/original handling for #57 remain separate integration work. An explicit not-submitted decision refuses to replace a separate newer local draft, preserving both snapshots for an owner-selected recovery choice.

The dropped-response browser case records physical HTTP attempts, distinct outer RPC IDs, DSH SessionRequestIds and local DraftSubmissionIds separately. A browser/carrier may retransmit the identical POST after socket loss; the public Connection unary source calls fetch once. Quarantine survives that loss and same-tab reload without creating a new logical attempt. Identical retransmission is neither evidence of duplicate native execution nor an exactly-once guarantee. Native durable idempotency/reconciliation remains the #36 gate.

Targeted upstream lint covers `src/client/{contract/semantic-draft.ts,semantic-draft.ts,input/semantic-drafts.ts,input/facade.ts,input/hub.ts,service.ts}` and `tests/semantic-drafts.client.spec.ts` under `packages/client/ui-conversation`. The global export-JSDoc checker still reports one pre-existing navigation-prerequisite declaration (`sessionActionAvailable`); every changed draft declaration passes. The navigation patch is preserved exactly, and this optional global check is recorded as failed rather than hidden.
