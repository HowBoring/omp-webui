# Ticket 52 — Branched Session from a historical user point

Status: component evidence PASS in the isolated Chat carrier. Ticket 52 and parent spec 29 stay
**open**; product Host admission is **blocked** (the read-only tree and the branch affordance are
mounted only in this evidence carrier, not in the product Host route table).

## What is proven

- The only branchable points are the user-message points native itself reports through
  `get_branch_messages`; non-user rows, stale rows, resets and compaction boundaries cannot be
  selected, and they still render with their real native identity (`tests/sessions/branch.test.ts`,
  `tests/browser/branch-browser.py`).
- Selecting a point previews it and requires an explicit confirmation showing the target entry, the
  retained-history point, that files and external effects are not rolled back, and that the returned
  text is an unsent draft before anything changes (`tests/browser/branch-browser.py`: cancel leaves
  generation, conversation and draft untouched and sends no `ompSessions/branch`).
- Confirming calls the public OMP `branch` RPC. The result is not trusted: the new identity comes
  from `get_state`, and the new Session is only accepted after the public catalog reports the
  previous session file as its `parentSession`, the cwd matches, and the destination tree's
  conversation ancestors are exactly the source ancestors of the selected parent. Otherwise the
  outcome is `SESSION_BRANCH_IDENTITY_UNCONFIRMED`, `SESSION_BRANCH_LINEAGE_UNCONFIRMED` or
  `SESSION_BRANCH_RETAINED_MISMATCH` and no view is shown
  (`tests/sessions/branch.test.ts`, `tests/sessions/branch-source.test.ts`).
- The destination keeps only the common history through the selected parent; the source and its
  siblings remain openable and unchanged; the source file bytes are unchanged
  (`tests/sessions/branch.test.ts`).
- Presentation replacement is atomic: the previous worker, rows, attempt, settlement, entry and tree
  key are dropped before the new view is presented, and a reload rebuilds the new Session from its
  native identity while keeping the returned draft
  (`tests/browser/branch-browser.py`: `reloadRebuildsNewSession`).
- Busy Sessions refuse with `SESSION_WORKER_BUSY_STOP_REQUIRED` without stopping or queueing
  anything; native refusal keeps the Session and input intact; a lost reply is reported as an
  unknown outcome and never replayed; the returned text is never sent automatically. The browser run
  records exactly one `ompSessions/branch` write and no `session/prompt`/`session/cancel`
  (`tests/sessions/branch-source.test.ts`, `tests/browser/branch-browser.py`).
- The HTTP/DSH surface is exercised end to end against the real native worker, and a second browser
  sees the Sessions in the catalog without being able to act on the first browser's worker
  (`tests/sessions/branch-remote.test.ts`).

## Mechanism

Public OMP v2 RPC only. `branch` and `get_branch_messages` are admitted by a generated command
validator (`scripts/build-branch-controls.ts` → `packages/contracts/generated/branch-controls`), so
the browser-facing interaction command surface is unchanged. The strict-start worker still forbids
every session-file switch, so
`compatibility/omp/0012-strict-branch-transition.patch` relaxes exactly the branch transition:
`SessionManager.createBranchedSession` may begin an explicit native transition from a strict storage
(reservation-backed `createExplicitNativeStorage` keeps the durable ownership guarantees), and the
empty-cut `newSession({ parentSession })` call passes the same allowance. `compatibility/omp/0002-readonly-catalog.patch`
raises the catalog's `parentSession`/`continuationOf` field cap from 128 to 4096 characters: a native
branch records the absolute source session path, which a real installation path exceeds, so the
relation was otherwise silently dropped and lineage could not be verified.

Decision record: `docs/adr/0033-branched-session-native-branch.md`.

## Evidence tuple

- OMP base `57771ae562b9345e0579bceb2d68d585e3e6927e`
- candidate source `e9e00d47306d8885563fc271f5a79ea3330f18a5ec52de4f54688c64101b0530`
- candidate patch set `99b33a85b209f7f3e29beb97ee531a8399eb5e9069f2eb4abc7f1e3e146bd5cb`
- candidate CLI `f23d51e71478642dd5b9768737033fbe68a7d289a560a8ddd394ddb1f585ed8f`
- Chat host bundle `ee3034a43c9d7c77789e8f718017f73d52de8929c29a684f41937fdc8a69c0f7`
- enrolled chat assets `849d65c44fc3b94eb4181e822f43840d8719dc650d1eb22fb5683c3f62232855`
- Bun `1.4.4`, Linux Chromium `157.0.8103.38`, Playwright `1.65.2` (Python 3.14.4)

## Reproduction

```
env -u ALL_PROXY -u HTTPS_PROXY -u HTTP_PROXY bun --no-env-file scripts/prepare-compatibility.ts --reset
bun --no-env-file scripts/build-compatibility.ts
bun --no-env-file scripts/build-branch-controls.ts --check
bun --no-env-file apps/chat/build.ts
bun --no-env-file scripts/build-chat-host.ts
mkdir -p vendor/chat && bun --no-env-file scripts/enroll-chat-fixture.ts
bun test tests/sessions/branch.test.ts tests/sessions/branch-source.test.ts tests/sessions/branch-remote.test.ts
/home/howboring/Projects/omp-webui-recovery/venv/bin/python tests/browser/branch-browser.py
```

The browser run writes `vendor/branch-browser.json` (`status: PASS`, `productAdmission: blocked`).

## Not claimed

- Product Host admission of the tree or the branch action (evidence carrier only).
- Attachment originals of the branched Session: native `branch` returns text only, so the returned
  draft is text-only. The durable native source relation is recorded for the later attachment
  association work (ticket 56) but is not used here.
- Branching while a turn is running: the request refuses and asks the operator to Stop and re-initiate.
- Same-Session historical navigation (ticket 51) and historical-original access (ticket 56).

## After the integration merge

The evidence was rerun on the merged branch (mvp/spec-29 at af276c1, authored stack
with `0008-durable-navigation` before `0012-strict-branch-transition`). All eleven
cases pass again: native user points only, tool/special/compaction/reset rendering,
preview before branch, cancel keeps the input, native identity verified, atomic
presentation replacement, unsent returned draft, common history only, source and
destination known, reload rebuilds the new Session, and no replay prompt or model
call. `docs/evidence/ticket-52-browser.json` is that run.

The ticket was then merged into the integration branch that also carries ticket 48
(`mvp/spec-29` at 59f89d6). The merged worktree was prepared from scratch
(`prepare-compatibility.ts --reset`), rebuilt, and the whole browser suite rerun:
eleven of eleven cases pass again and `docs/evidence/ticket-52-browser.json` holds
that run. The generated `branch-controls` validator was regenerated there because
the committed copy had been generated from a stale 301-definition wire schema; it now
derives from the merged 386-definition schema and admits only `branch` and
`get_branch_messages` with the 96-character id policy
(`tests/compatibility/command-contracts.test.ts`).

Merged digests: candidate source `e9e00d47306d8885563fc271f5a79ea3330f18a5ec52de4f54688c64101b0530`,
patch `99b33a85b209f7f3e29beb97ee531a8399eb5e9069f2eb4abc7f1e3e146bd5cb`,
schema `b13a75ebfb36a0c48edb5d796e8335d6ab0a6a6b6fad7eda06be40c7f7c5a1ff`.

Known failures outside this ticket after the merge: the continuation fault-shim suite
still fails eleven native syscall cases under the system-fixture prefix. In the merged
worktree `tests/navigation/validators.test.ts` runs against the staged ticket 51 worker
tree (`vendor/omp-strict`) and `bun --no-env-file scripts/build-navigation-contracts.ts
--check` passes; `tests/sessions`, `tests/tree`, `tests/attachments/public-rpc.test.ts`,
`tests/compatibility` and `bun run typecheck` pass. The native branch tests spawn
`--mode rpc-ui` workers, so they must not run concurrently with a browser suite that
force-kills leftover workers on the same machine.
