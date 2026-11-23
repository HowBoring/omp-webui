# Ticket 61 — acceptance

Acceptance bullets of issue #61, each with what was actually executed. Status vocabulary as in
`docs/evidence/ticket-61-story-matrix.md`: PASS / PARTIAL / FAIL / BLOCKED / NOT RUN.

| # | Accepted criterion | Status | Evidence and limits |
|---|---|---|---|
| 1 | Lifted freeze/lease gates with immutable identities for one combination | **PASS** | Decision 4 asks for publicly auditable source deltas, immutable build/schema/asset identities and conformance evidence for one combination — not a public distribution channel: `docs/evidence/ticket-61-freeze.json` records the Host commit, OMP base/source/patch/schema digests, the seven DSH patches with tree hashes, every installation asset, the native closure and the manifest sha, and `tests/product/freeze.test.ts` fails on any drift from the rebuilt/enrolled bytes. Distribution is explicitly out of scope (spec *Out of Scope*: an automatic update/distribution framework), so `packages/delivery/gate.ts` stays an unused inventory module (`scripts/inspect-delivery.ts` is its only caller; `apps/host/src/main.ts` never imports it) that reports `blocked`/`GLOBAL_TARGET_NOT_SELECTED`; nothing here claims a released package or immutable public delivery. |
| 2 | Final tuple rebuilt, verified, enrolled, and its product scenarios rerun on Linux and the Windows-browser path | **PARTIAL** | `product:verify` and the enrolled identity match, and the Linux product flow PASSes end to end on the final tuple: new native Session, live attach = reopen, send, Stop to `cancelled`, confirmed retry, recovery send, four keymap chords, and the retained-image reopen check. The Windows Chrome Dev 160.0.8171.0 run in `ticket-61-platforms.json` (`windowsChrome`) was collected against the superseded custom shell, not this stock tuple; it is retained only as history and the Windows-browser path is **NOT RERUN**. A CDP file drop was not surfaced in that historical run and remains a recorded limitation. |
| 3 | Native TUI/history/new metadata/upgrade and current-data rollback proven on isolated synthetic data with an actually pinned previous build | **PASS** | 6/6 checks in `docs/evidence/ticket-61-native-data.json`; the previous build is the pinned review baseline `@oh-my-pi/pi-coding-agent@18.20.2` (`dist/cli.js` sha256 `648be0034d37318687525546dcbef0bd1596dda87d008cc14fecc801c821ac76`) installed from the registry, not a hand-built stand-in. Real user history was never opened, migrated or rewritten. |
| 4 | Final freeze/release/operations documentation and 84-story matrix with per-acceptance status | **PASS** | `docs/evidence/ticket-61-freeze.json`, `docs/release-final.md`, `docs/operations.md`, `docs/evidence/ticket-61-story-matrix.md` (84 rows, no N/A), this file. |
| 5 | All other mandatory acceptance, or a labeled genuine external blocker | **PARTIAL** | Every other story row is PASS or PARTIAL with named evidence; the delivery/lease gate and maintainer-operated acceptance remain open and are listed separately below. |

## Final-tuple product scenarios

| Scenario | Final combination | Source of truth |
|---|---|---|
| Host start, health, origin, installation identity | PASS | `ticket-61-platforms.json` `linux.hostStart` |
| Bootstrap admission, single use, unauth 401 | PASS | `linux.bootstrapAdmission` |
| Served assets equal manifest identities | PASS | `linux.assets` |
| Directory grant through the product UI | PASS | `linux.grant` |
| New native Session with verified identity | PASS | `linux.productFlow.newSession` (`01a20027-38bc-735c-ac36-7ac1ee487ee0`) |
| Live attach, send and streaming answer | PASS | `linux.productFlow.liveAttach` 11 nodes; `send` native journal sha256 `cabb69d7…f344a` |
| Stop to `cancelled`, recovery send | PASS | `linux.productFlow.stop` and `recovery` |
| Explicit confirmed retry | PASS | `linux.productFlow.retry` (`succeeded`) |
| Revoke-all | PASS | `linux.revokeAll` |
| Windows Chrome shell, admission, console clean | NOT RERUN | `windowsChrome` is superseded custom-shell evidence, not this tuple |
| Windows keyboard, menus and file input | NOT RERUN | `windowsChrome.inputInjection` is superseded custom-shell evidence; drop and OS clipboard remain limitations |

## Maintainer operational acceptance — NOT RUN

Not executed by an agent, and no substitute is offered. Suggested checklist for the maintainer on
their own machine, using `docs/operations.md`:

1. Prepare and enroll from a clean checkout (§1) and confirm `bun run product:verify` and
   `bun test tests/product/freeze.test.ts` both pass.
2. Start the Host (§2) and confirm the printed bootstrap link is the only way in.
3. Log in, grant a real working directory, create a New Session and send one prompt with your own
   provider configuration — this is the first real-provider check.
4. Exercise Stop during a streaming turn, then retry the failed turn; confirm the visible outcomes.
5. Open the same Session in a second tab and confirm one shared worker (no duplicate writer).
6. Run a history preview, an in-Session navigation and a branch on a scratch Session; confirm the
   confirmation text and the returned unsent text.
7. Attach an image and a UTF-8 file; confirm the draft survives a Stop and that original download
   works after a Host restart.
8. Revoke all with `kill -USR1`; confirm both the open tab and the bootstrap link fail.
9. Restart the Host and confirm authorization, grants, index and originals survive.
10. On Windows, open `http://localhost:<port>` in Chrome, log in, and drive keyboard shortcuts,
    clipboard paste and Explorer drag/drop.
11. Run an upgrade and a rollback on copies of real native Sessions, confirming data compatibility
    before relying on either build.

## Genuine external / maintainer blockers

* **Automatic update / public distribution framework** — explicitly out of scope for the MVP
  (spec *Out of Scope*). `packages/delivery/gate.ts` is an unused coordinated-selection inventory
  module with no product admission or launch path; it is not a blocker for this ticket and no
  immutable public delivery is claimed.
* **Maintainer operational acceptance** — requires the maintainer's own machine and provider
  configuration (checklist above).
* **Windows input on the final combination** — needs an interactive Windows desktop session; WSL2
  automation cannot inject real keyboard, menu, clipboard or Explorer-drop input.
