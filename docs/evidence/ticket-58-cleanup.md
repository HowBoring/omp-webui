# Ticket 58 — cleanup, quota exhaustion, and confirmed deletion

Scope: issue #58, based on decisions 22–24 and stories 71–79. Product root admission
stays blocked; no real user data is used.

## Implementation

- The Host now installs the real submission gate as the `OriginalStore` deletion
  protection, late-bound so startup recovery cannot observe a permissive stub.
  The gate reports `occupied`, `executing` or `unresolved-submission` for the exact
  Session/draft/original binding and advances a monotonic revision on every
  transition. A cancel before native dispatch releases only its own reference; a
  newer live attempt for the same Original keeps it occupied until that attempt is
  resolved. An absent gate yields `unknown`, which never authorizes deletion.
- Startup and a repeating one-minute sweep call `collectExpiredPages`; each pass is
  bounded to 128 ids (32 passes at startup, four per sweep), and `next` is persisted
  only as the in-memory cursor for the next pass. Expiry is measured from the persisted
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

## Verification (ticket worktree `mvp/ticket-58-cleanup`; attachment and browser suites rerun on final `main`)

- Candidate rebuilt in the ticket worktree with `bun scripts/build-compatibility.ts`
  (OMP `57771ae5`, authored source `b245d8ec…`, patch `b91a8571…`) and Chat
  Host re-enrolled against the local candidate. The previous public-RPC failures
  came from running the shared `vendor/omp-candidate` symlink while it was being
  rebuilt elsewhere; after the standalone build, `bun test
  tests/attachments/public-rpc.test.ts` is 15/15. The cohort's pinned authored
  tuple was updated from the pre-#54 tuple (`e9e00d47…`/`99b33a85…`) to the
  current patches; the worker-exit diagnostic now records exit code and stderr
  if that process fails again.
- Final integration on `main` (`ab8a386` plus the pre-dispatch-cancel protection
  fix) rebuilt the browser bundle first (`bun apps/chat/build.ts`, then
  `scripts/build-chat-host.ts`, then `scripts/enroll-chat-fixture.ts`); a stale
  `vendor/dsh-chat` bundle serves the pre-#58 UI and never requests usage, which
  looks like a usage failure. Candidate preflight on this tree returned the tuple
  above with `safePreflight: true` and `sessionAdmission: blocked`.
- `bun run typecheck` — PASS.
- `bun test tests/attachments` — PASS, 111 tests / 16 files (store, lifecycle,
  association, remote, public RPC, submission gate; includes bounded 130-row
  expiry, same-hash independence, lost-publication refusal, pre-dispatch cancel
  coexistence, revocation, branch inheritance and worker-exit capture).
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
