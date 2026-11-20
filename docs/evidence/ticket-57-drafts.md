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
