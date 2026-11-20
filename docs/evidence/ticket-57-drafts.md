# Ticket 57 — tab-scoped draft and Host receipt recovery

Scope: issue #57, verified against the cached ticket ACs. The earlier performance
scope (#60) was retracted and is not implemented here. Product root admission
remains blocked.

## Implementation

- `apps/chat/src/client.tsx` acquires an exclusive `navigator.locks` owner per
  tab, keeps the owner and draft id in `sessionStorage`, and mints a new owner and
  draft id in a copied tab. It implements the public
  `ConversationDraftProvider` contract from `packages/drafts/provider.ts` and
  hydrates the stored record atomically through that provider's public
  `scope`/`read`/`prepare` seam into text, ordered originals, invalid-item
  reasons and the unresolved-submission guard. The provider is not registered
  through DSH's provider-mode `registerDraftProvider`; only the chat surface
  hydrates it (see Boundaries).
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
- No hydration path dispatches a prompt, submits, or creates a Session.
  Unresolved submissions stay frozen; a later preparation result cannot publish
  a stale receipt after authority changes.

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

## Retention clock

24-hour expiry, explicit-edit/active-recovery renewal, read non-renewal, restart
non-reset and protection holds are covered by
`tests/attachments/lifecycle.test.ts`, `tests/attachments/association.test.ts`
and the typed Remote test in `tests/attachments/remote.test.ts`
(`typed Host Remote renews only exact current staged Originals for an explicit
draft action`). No real wall-clock 24-hour wait is claimed; the store tests use
controlled clock injection plus a separate store reconstruction.

## Boundaries

- The DSH provider-mode composer runtime is not mounted, so the provider is not
  registered through `registerDraftProvider`. Its contract and the chat surface's
  atomic hydration follow the public DSH semantics; this is not a claim that
  DSH's own composer UI is active.
- Closing the page or browser is not a recovery promise; the record lives in
  sessionStorage and the Host lifetime is independent.
- Deleted/missing Originals stay as invalid items until the user removes them or
  recovery supersedes them; they are never silently dropped.
- Windows evidence is deferred with the existing repository boundary.
