# Ticket 57 — tab-scoped draft and Host receipt recovery

Scope: issue #57, verified against the cached ticket ACs. The earlier performance
scope (#60) was retracted and is not implemented here. Product root admission
remains blocked.

## Implementation

- `apps/chat/src/client.tsx` acquires an exclusive `navigator.locks` owner per
  tab and keeps the owner and draft id in `sessionStorage`. A reload waits on the
  inherited owner instead of minting one; a contended or timed-out acquisition
  returns the same candidate, and only a copied tab (navigation type other than
  reload/back-forward) mints a fresh tab, owner and draft id. It implements the public
  `ConversationDraftProvider` contract from `packages/drafts/provider.ts` and
  hydrates the stored record atomically through that provider's public
  `scope`/`read`/`prepare` seam into text, ordered originals, invalid-item
  reasons and the unresolved-submission guard. The provider is registered
  through the real DSH provider-mode runtime: `createProviderRuntime(ctx)` mounts
  the exported `ConversationController` with an `InputHub` in `provider` mode, and
  the chat surface passes the same provider object to
  `input.registerDraftProvider(ctx, provider)`. Custom Chat scope and
  authorization still come from the chat surface; DSH owns only the provider
  contract, exclusivity and shell binding. The additive DSH patch is
  `compatibility/dsh/patches/0008-provider-runtime.patch`.
- Hydration never trusts a stored runtime receipt. Each original is re-read from
  the typed Host Originals Remote under the current explicitly opened
  Session/draft scope; the returned object id must match. Missing, deleted or
  expired objects render one ordered invalid item with its reason while the text
  survives. `Send`/`Steer` are disabled while an item is invalid or a submission
  is unresolved.
- Explicit edits and user-initiated recovery call the new typed
  `operation: "touch"` Remote with `explicit-edit` / `active-recovery`. Reads,
  reloads, background hydration and restart never call it.
  `apps/host/src/session-component-server.ts` installs the protection gate and a
  bounded startup sweep, so a Host restart keeps the staged clock instead of
  resetting it.
- Writes always resolve the latest retained Session binding; a projection rebuild
  cannot leave a save pinned to an aborted projection. A removed Original is
  tombstoned for the page lifetime so an in-flight stale hydration cannot
  republish it, and the row keeps a Remove action until the Host confirms.
- One attempt is outstanding at a time across text and attachments. A second
  Send while it is unresolved reports the retained draft and dispatches no
  prompt; an unknown outcome freezes editing and sending until Native recovery
  settles, and a stale preparation result cannot publish a receipt after an
  authority change.
- Catalog refresh clears the previous choices while it runs and disables
  Open/Refresh meanwhile, so a click cannot bind a stale selection. A replaced
  Host answers a withdrawn View with `401 Access invalidated`; the chat surface
  treats that marker as view authority loss and reopens authorization instead of
  retrying the submission, while a plain credential 401 still rechecks
  `/auth/status` first.

## Real browser evidence (Linux, Chromium 157.0.8103.38)

Command:

```
CHROME_EXECUTABLE=/usr/bin/google-chrome \
  /home/howboring/Projects/omp-webui-recovery/venv/bin/python tests/chat/drafts.py
```

Result: `PASS` for

- `same-tab-reload-restores-text-and-host-original`
- `missing-original-invalid-item-blocks-send`
- `copied-tab-isolated-draft-and-host-scope`
- `host-restart-rehydrates-tab-record`
- `restart-never-dispatches-draft`

The run uses the real Host attachment Remote, the real isolated chat fixture and a
real Chrome process with sessionStorage, page reload, a copied tab and a Host
restart. The missing-object case unlinks the Host original file, then checks the
visible invalid item and the disabled Send; no synthetic readiness flag is used.

`tests/chat/images.py` remains the broader attachment suite and was updated for
the new lifetime: its Host-restart scenario now expects sessionStorage ownership
and one retained, reauthorized-or-invalid original.

Both broader suites pass on the same tree:

- `tests/chat/images.py`: `PASS`, 18 scenarios from
  `image-upload-staged-no-send` through
  `host-restart-never-dispatches-unconsented-attempt`.
- `tests/chat/browser.py`: `PASS`, 24 scenarios, including
  `worker-eof-manual-reopen`, `host-restart-manual-reopen`,
  `retry-history-preserved-across-host-restart` and
  `retry-second-credential-withdraws-displaced-view-no-dispatch`.
- `bun test tests/chat`: 67 pass, 0 fail.

## Retention clock

24-hour expiry, explicit-edit/active-recovery renewal, read non-renewal, restart
non-reset and protection holds are covered by
`tests/attachments/lifecycle.test.ts`, `tests/attachments/association.test.ts`
and the typed Remote test in `tests/attachments/remote.test.ts`
(`typed Host Remote renews only exact current staged Originals for an explicit
draft action`). No real wall-clock 24-hour wait is claimed; the store tests use
controlled clock injection plus a separate store reconstruction.

## Boundaries

- DSH patch 0008 is additive: it exposes a provider-mode runtime for surfaces
  that keep their own composer UI. It does not mount DSH's stock Conversation
  shell or composer, and no stock UI is claimed to be active.
- Product root admission remains blocked; the browser suites run the isolated
  chat fixture, not normal product admission.
- Closing the page or browser is not a recovery promise; the record lives in
  sessionStorage and the Host lifetime is independent.
- Deleted/missing Originals stay as invalid items until the user removes them or
  recovery supersedes them; they are never silently dropped.
- Windows evidence is deferred with the existing repository boundary.

## Integration merge (mvp/spec-29)

`mvp/spec-29` was merged as `a447c29` (`c6c4d26`). The two Chat24 reds recorded
below were fixed afterwards by the assertion and launcher-listener changes in
`ticket-57-chat24-stability.md`; the final merge evidence is at the end of this
document. On that first merged tree,
`tests/chat/drafts.py` (5/5), `tests/chat/images.py` (18/18) and
`bun test tests/chat` (67 pass) still pass, while `tests/chat/browser.py` did
**not** pass: it failed during `native-tool-history-reopen` with
`AssertionError: reused id history survives reopen` (browser.py:582). Before the
reopen, the fixture's two calls with the reused id each render two
`[data-chat-tool-result]` entries; after reload and manual reopen of
`native-0002`, the reopened history contains fewer than two entries for one of
the duplicate tool ids. A second merged-tree run failed earlier in the Stop
phase with `AssertionError: stop settles cancelled` (`result: succeeded`,
`settled: true`), so the two reds are not identical.

The only merged delta touching this path is the live tool-owner change in
`compatibility/omp/0006-live-settlement.patch`
(`live-message-observation.ts`, `#toolOwners` keyed without `contextId`). Chat's
rendering does not dedupe history items (`apps/chat/src/client.tsx:402`), and
`rpc-history.ts` emits one item per native entry, so the missing result is in
native entry persistence/active-branch history, not the Chat projection. An
experimental owner-spread removal moved the missing entry to the other duplicate
id without making the suite green, so it was reverted; no unproven patch change
is included here.

## Final merge onto mvp/spec-29

The final branch merged with `git merge --no-ff` as `5dd26e3` (`c6c4d26` +
`bf6cbc4`). The DSH candidate was rebuilt from source tree
`d876ff7a0636f71bdcae2148ec1a45d5a42e142f` (patch 0008 applied;
`build:artifacts` 8/8 gates), then the chat assets, Host bundle, fixture and
enrollment were regenerated from it and verified by the suites below.

Review of the merged code changed two failure paths:

- The inherited owner wait is now bounded (3 s). A reload hands the owner lock
  from its unloading predecessor to the new document, so the wait normally ends
  at once; a duplication that also reports a reload navigation keeps the lock
  held for its lifetime, and the unbounded wait left that page blank forever
  behind `ownerReady`. After the bound the page mints its own tab, owner and
  draft scope, exactly like the navigation-type copy path.
- An Original the Host has already reclaimed (`attachment_object_unavailable`
  on `release`) can now be removed. The record had no Host row left to release,
  so the tombstone was the last reference and Remove could never clear it; any
  other refusal clears the tombstone again, keeping the listed row consistent
  with the Host state.

Results on the merged tree (Linux Chromium 157.0.8103.38, port 32957):
`tests/chat/drafts.py` 5/5, `tests/chat/images.py` 18/18,
`tests/chat/browser.py` 24/24 (387 s), `bun test tests/chat` 67 pass,
`bun test compatibility/omp/fixtures/live-public-rpc.test.js` 9 pass,
`bun run typecheck` clean. No scenario was removed or weakened; the only
assertion change is the reopen read replaced by a wait for the native records.
