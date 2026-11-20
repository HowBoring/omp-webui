# Ticket 58 — cleanup, quota exhaustion, and confirmed deletion

Scope: issue #58, based on decisions 22–24 and stories 71–79. Product root admission
stays blocked; no real user data is used.

## Implementation

- The Host now installs the real submission gate as the `OriginalStore` deletion
  protection, late-bound so startup recovery cannot observe a permissive stub.
  The gate reports `occupied`, `executing` or `unresolved-submission` for the exact
  Session/draft/original binding and advances a monotonic revision on every
  transition. An absent gate yields `unknown`, which never authorizes deletion.
- Startup and a repeating one-minute sweep call `collectExpiredPages`; each pass is
  bounded to 128 ids and at most four passes, and `next` is persisted only as the
  in-memory cursor for the next pass. Expiry is measured from the persisted
  `activityAt`, which only `explicit-edit` or `active-recovery` can renew.
- The typed Originals Remote adds `usage`, `preview-delete` and `delete`.
  Preview returns the Host-known impact (the exact draft that loses access,
  later reads possibly failing) and a single-use five-minute confirmation.
  Confirm re-resolves the live Scope and gate revision before reclaiming the whole
  logical Original; no deletion is queued. A stale preview, revocation, expiry,
  in-flight attempt or unresolved submission requires a new review.
- The Chat surface shows charged physical bytes against the 10 GiB limit, opens a
  Host-impact preview before deleting, refreshes usage after staging, release and
  deletion, and explains `attachment_store_full` without ever auto-evicting sent
  Originals. Native history and saved model input are not rewritten; deletion only
  removes the selected staged original and its payload. Independent same-hash
  Originals remain.
- `OriginalStore.read` still refuses a staged original once it is native-associated
  or held, but allows reads while its own attempt is occupied/executing so
  preparation can read the exact bytes it is about to send.

## Verification (ticket worktree `mvp/ticket-58-cleanup`)

- `bun run typecheck` — PASS.
- `bun test tests/attachments` — PASS (store, lifecycle, association, remote,
  submission gate; includes bounded 130-row expiry, same-hash independence,
  lost-publication refusal, revocation and branch inheritance).
- `tests/chat/images.py` on the rebuilt ticket Host — PASS, 18 scenarios,
  Chromium 157.0.8103.38. Covers staging, Send consent/native entry, paste/drop,
  Base64, spoofing, cancellation retaining the draft original, degradation and
  truncation consent, document conversion failures, stale grant, object limit and
  restart-without-dispatch.
- `tests/chat/cleanup.py` on the same Host — PASS, Chromium 157.0.8103.38:
  usage reports 22 charged bytes of 10 GiB and two Originals; the impact preview
  names the losing draft and preservation of native history/model input; confirm
  deletes one logical Original and its 11 bytes while the same-hash sibling
  survives; a real in-flight Send (`awaiting-consent`) invalidates the open
  preview, refuses confirmation with "start a new deletion review", retains the
  Original and reclaims nothing; cancelling and starting a fresh review deletes it.
- Known boundary: the #55 restart reattach projection still reports
  `projection-unavailable` after a Host restart in the image test; that path is
  unchanged by this ticket and is not claimed fixed.

No push, issue closure, cleanup of user data, or product admission is claimed.
