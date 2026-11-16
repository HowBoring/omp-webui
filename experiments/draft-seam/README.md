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
  DSH runtime uploads/receipts. Neither submits. `parseSemanticDraftRecord(unknown)` validates persisted records.

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
DSH_SOURCE=vendor/dsh-final bun run dsh:prepare
bun scripts/link-dsh.ts vendor/dsh-final
bun run diagnostics:build
DSH_SOURCE=vendor/dsh-final experiments/draft-seam/run.sh
bun experiments/draft-seam/record-evidence.mjs vendor/dsh-final experiments/draft-seam/evidence
```

The fixture adds the official attachment presentation plugin and its declared dependencies to the earlier
Conversation baseline; the resolved graph is retained and is not a final product roster.

The fixture Host binds loopback and serves controlled synthetic Remote responses/raw original/upload bytes only.
It uses actual `ClientModuleRegistry`, boot injections, public WebServer export, Connection Remote mux parsers and
DSH client manifests; it starts no DSH Agent/runtime or OMP worker. `session/create` and prompt requests are
recorded and the browser test requires none. Public provider/component tests live inside the source patch and
run through the actual Conversation plugin's public `conversation.input`, with DSH's controlled public Session/
upload test boundary. The generated plugin bundle and all cloned/built DSH assets stay in ignored `vendor/`.

See `SEAMS.md` for accepted testing boundaries and `evidence/validation.json` for exact checks and limits.

The browser scenario defaults to Linux `/usr/bin/chromium`. `BROWSER_EXECUTABLE` can select actual Chrome in
another supported test environment; it never emulates a Windows navigator. Run the same Python scenario from
Windows against the WSL2 Bun fixture with its `server.json` available on the shared checkout when that explicit
acceptance resumes. This option has not been executed on Windows; current evidence remains Linux-only.
