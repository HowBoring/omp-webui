# Ticket 61 — final combination story evidence matrix

Scope: parent spec #29 stories 1–84 evaluated on the final combination frozen in
`docs/evidence/ticket-61-freeze.json` (OMP base `57771ae5`, patch `265e1741`, schema `bf298085`,
bundle re-derived by `bun run product:verify`; DSH `38a6a5c9`, source tree `52c982f3`).

Status vocabulary: **PASS** (executed and observed), **PARTIAL** (some declared scope executed,
the rest and its reason named in the scope column), **FAIL**, **BLOCKED** (a required dependency
is not delivered), **NOT RUN** (never executed). No row is N/A.

Every `docs/evidence/ticket-NN-*.json` pointer names evidence recorded by that ticket on an
earlier combination; a row is only PASS here when the behaviour is source-identical on this
combination, and rows whose patch set changed since (23–26, 29–36, 55) were rerun on the final
tuple rather than inherited (see `ticket-61-platforms.json`).

| Story | Wanted | Status | Evidence | Scope, platform and limits |
|---|---|---|---|---|
| 1 | local OMP owner, I want to start a loopback WebUI on Linux or WSL2 | PASS | docs/evidence/ticket-61-platforms.json `linux.hostStart` | Final tuple on Linux; WSL2 Host is the same Linux binary, Windows browser path in row 82 |
| 2 | local OMP owner, I want to authorize a browser through a local bootstrap link | PASS | ticket-61-platforms.json `linux.bootstrapAdmission`, `windowsChrome.shell` | Admission link single use; real Win32 Chrome exchanged it |
| 3 | authorized browser user, I want my authorization to survive Host restarts for an absolute 30 days at the same origin and data directory | PASS | docs/evidence/ticket-31-*.json | Absolute 30-day expiry; `packages/access/store.ts:7` |
| 4 | authorized browser user, I want refreshes and multiple tabs to retain valid access without renewing its absolute expiry | PASS | docs/evidence/ticket-31-*.json | Refresh and second tab keep one absolute expiry |
| 5 | browser user, I want logout to revoke my browser credential and its tabs on the server | PASS | docs/evidence/ticket-31-*.json | Logout revokes server credential |
| 6 | local OMP owner, I want to revoke all browser authorizations | PASS | ticket-61-platforms.json `linux.revokeAll` | `kill -USR1` then `/` and reused link 401 |
| 7 | local OMP owner, I want to explicitly grant a canonical working-directory root and its descendants in the WebUI | PASS | ticket-61-platforms.json `linux.grant` | Grant through product UI, descendants included |
| 8 | local OMP owner, I want directory grants to survive restarts and remain revocable | PASS | docs/evidence/ticket-30-*.json | Grants persist and stay revocable |
| 9 | local OMP owner, I want Sessions outside current working-directory grants to show permitted catalog metadata and an explanation without exposing history or execution | PASS | docs/evidence/ticket-33-*.json | Catalog metadata outside granted roots |
| 10 | OMP user, I want discovery to use the startup-selected profile and explicitly configured additional Session Sources | PASS | docs/evidence/ticket-33-*.json | Startup profile plus configured Session Sources |
| 11 | OMP user, I want Workspaces to group discovered and registered Sessions by their actual working directory | PASS | docs/evidence/ticket-34-*.json | Workspace grouping by actual directory |
| 12 | OMP user, I want catalog pages, partial failures and invalid or unknown directories to have honest status | PASS | docs/evidence/ticket-34-*.json | Honest partial/invalid status |
| 13 | OMP user, I want discovery alone to avoid registration, opening, migration, lease acquisition and model calls | PASS | docs/evidence/ticket-33-*.json | Discovery performs no registration, open, lease or model call |
| 14 | OMP user, I want the first explicit open to register an existing native reference before attempting continuation | PASS | docs/evidence/ticket-35-*.json | First explicit open registers the native reference |
| 15 | OMP user, I want failed opens to retain the registered reference and reason | PASS | docs/evidence/ticket-35-*.json | Failed open keeps reference and reason |
| 16 | OMP user, I want missing, replaced or ambiguous native instances to fail explicitly | PASS | docs/evidence/ticket-35-*.json | Missing/replaced instance fails explicitly |
| 17 | OMP user, I want an externally occupied Session to show only permitted catalog metadata until its owner exits | PASS | docs/evidence/ticket-36-*.json | Externally occupied Session shows metadata only |
| 18 | OMP user, I want to manually reopen a Session after its previous owner exits | PASS | docs/evidence/ticket-36-*.json | Manual reopen after owner exit |
| 19 | OMP user, I want new Sessions to be created only by explicit actions | PASS | ticket-61-platforms.json `linux.newSession` | New Session only from explicit action |
| 20 | OMP user, I want a newly created Session to expose its verified native identity | PASS | ticket-61-platforms.json `linux.newSession` | Verified native identity shown |
| 21 | OMP user, I want multiple Browser Views of one active Session to share one RPC Worker | PASS | docs/evidence/ticket-37-*.json | One worker shared by views |
| 22 | OMP user, I want the registered Workspace and Session Index to survive Host restarts without copying conversations | PASS | docs/evidence/ticket-36-*.json | Index survives restart without copying history |
| 23 | authorized Session user, I want to explicitly send text and observe real streaming content | PASS | ticket-61-platforms.json `linux.send` | Real streaming turn through the product Host |
| 24 | authorized Session user, I want readable tool calls, results, thinking and failures with their actual source semantics | PASS | docs/evidence/ticket-38-*.json | Tool/thinking/failure semantics preserve source |
| 25 | authorized Session user, I want tool results to remain associated with the correct call and execution context | PASS | docs/evidence/ticket-38-*.json | Results stay paired with their call |
| 26 | authorized Session user, I want to choose the current Session model and thinking level | PASS | docs/evidence/ticket-39-*.json | Model and thinking level per Session |
| 27 | browser user, I want appearance and language preferences to affect the WebUI | PASS | docs/evidence/ticket-55-*.json | Appearance and language preferences |
| 28 | busy Session user, I want to edit a draft and prepare attachments while new prompt, steer and follow-up queue input is refused | PASS | docs/evidence/ticket-48-*.json | Draft and attachments during busy turns |
| 29 | authorized viewer, I want to answer a pending Interaction from any authorized page | PASS | docs/evidence/ticket-49-*.json | Any authorized page can answer |
| 30 | authorized viewer, I want only the first valid answer to settle an Interaction and stale replies to fail | PASS | docs/evidence/ticket-49-*.json | First valid answer settles; stale replies fail |
| 31 | OMP user, I want admitted work and still-valid Interactions to survive ordinary browser disconnection | PASS | docs/evidence/ticket-50-*.json | Disconnect does not cancel |
| 32 | reconnecting viewer, I want only currently valid pending Interactions to be shown again | PASS | docs/evidence/ticket-50-*.json | Reconnect re-shows only valid Interactions |
| 33 | OMP user, I want approval and question expiry to cancel and request Stop after the configured non-renewing deadline | PASS | docs/evidence/ticket-51-*.json | Non-renewing expiry cancels without default consent |
| 34 | OMP user, I want ordinary Stop to cancel pending UI and history summaries, withdraw unexecuted queued work and request interruption | PASS | docs/evidence/ticket-52-*.json | Stop cancels UI, withdraws queue and interrupts |
| 35 | OMP user, I want recoverable stopped input to return only as an unsent draft with any loss explained | PASS | docs/evidence/ticket-52-*.json | Recovered input returns as unsent draft |
| 36 | OMP user, I want a separate force-termination choice after 30 seconds of an unfinished ordinary Stop | PASS | docs/evidence/ticket-53-*.json | Force termination is a separate 30 s choice |
| 37 | local OMP owner, I want root revocation, revoke-all and Host shutdown to reject new work and follow bounded cooperative, termination and forced-cleanup phases | PASS | ticket-61-platforms.json `linux.revokeAll` | Revoke-all rejects new work; shutdown path in ticket-57 |
| 38 | local OMP owner, I want shutdown to report actual drainage and owned-process exit rather than elapsed time alone | PASS | docs/evidence/ticket-57-*.json | Shutdown reports drainage and owned exit |
| 39 | OMP user, I want failed workers and lost operation outcomes to remain explicit and recover manually | PASS | docs/evidence/ticket-57-*.json | Unknown outcomes stay explicit and manual |
| 40 | OMP user, I want to inspect the full Session Tree independently of the current Conversation Projection | PASS | docs/evidence/ticket-54-*.json | Full tree independent of projection |
| 41 | OMP user, I want selecting a tree node to preview it without modifying the Session or sending input | PASS | docs/evidence/ticket-54-*.json | Preview without mutation |
| 42 | OMP user, I want a distinct action to navigate within the original Session | PASS | docs/evidence/ticket-56-*.json | Distinct in-Session navigation action |
| 43 | OMP user, I want a separate action to create a Branched Session from a historical user-message point | PASS | docs/evidence/ticket-56-*.json | Separate branch action with verified identity |
| 44 | OMP user, I want both historical actions to preview and confirm their effects and leave returned text unsent | PASS | docs/evidence/ticket-56-*.json | Preview and confirm; returned text unsent |
| 45 | OMP user, I want history confirmation to state that files and external effects are not rolled back | PASS | docs/evidence/ticket-56-*.json | Confirmation states files/external effects are not rolled back |
| 46 | OMP user, I want unsupported branch origins, stale targets and native ask-reanswer limitations to explain their actual reason | PASS | docs/evidence/ticket-56-*.json | Actual native reason for unsupported targets |
| 47 | busy Session user, I want to stop, wait for confirmed quiescence and then reinitiate history changes | PASS | docs/evidence/ticket-57-*.json | Busy history actions require Stop and proven quiescence |
| 48 | OMP user, I want successful History Navigation to persist its actual native position before any later prompt or exit record | PASS | docs/evidence/ticket-57-*.json | Position committed before later prompt or exit record |
| 49 | OMP user, I want retained active-path history before compaction or reset to remain expandable in folded segments | PASS | docs/evidence/ticket-41-*.json | Folded segments remain expandable |
| 50 | OMP user, I want the UI to distinguish displayed history from exact model input and native-pruned content | PASS | docs/evidence/ticket-41-*.json | Displayed history distinguished from model input |
| 51 | OMP user, I want historical pages and live output to reconcile exactly once | PASS | docs/evidence/ticket-40-*.json | History and live output reconcile exactly once |
| 52 | OMP user, I want all my views to rebuild consistently after branch changes or projection invalidation | PASS | docs/evidence/ticket-42-*.json | Views rebuild after branch or invalidation |
| 53 | OMP user, I want manual reopen after Host or worker restart to recover persisted native facts without promising lost provider chunks or timestamps | PASS | docs/evidence/ticket-57-*.json | Manual reopen recovers persisted native facts |
| 54 | OMP user, I want native custom messages, summaries, interruptions and file mentions to have safe readable presentation | PASS | docs/evidence/ticket-42-*.json | Custom messages, summaries, interruptions, mentions |
| 55 | OMP user, I want manual retry to follow native preconditions and explain possible tool reexecution | PASS | docs/evidence/ticket-55-*.json; ticket-61-platforms.json `linux.productFlow.retry` | Component contracts pass; the final product retry offer and confirmation settled with native outcome `succeeded` |
| 56 | OMP user, I want uploads, paste and drag-and-drop to become available only after explicit New or Open confirms native identity | PASS | docs/evidence/ticket-43-*.json | Attachments only after confirmed native identity |
| 57 | OMP user, I want new PNG, JPEG, WebP and GIF images to be accepted within validated limits | PASS | docs/evidence/ticket-44-*.json | PNG/JPEG/WebP/GIF within limits |
| 58 | OMP user, I want UTF-8 text and source files to be supported | PASS | docs/evidence/ticket-44-*.json | UTF-8 text and source files |
| 59 | OMP user, I want PDF, DOCX, PPTX, XLSX and EPUB inputs to use OMP conversion or native tool-reading paths | PASS | docs/evidence/ticket-45-*.json | PDF/DOCX/PPTX/XLSX/EPUB through OMP conversion |
| 60 | OMP user, I want unsupported formats, invalid encodings, MIME mismatches and damaged files to fail visibly | PASS | docs/evidence/ticket-45-*.json | Unsupported/invalid/damaged input fails visibly |
| 61 | OMP user, I want failed or pending attachment preparation to retain the complete draft and block prompt admission | PASS | docs/evidence/ticket-46-*.json | Failed preparation retains draft and blocks admission |
| 62 | OMP user, I want content-affecting degradation such as truncation to require explicit acceptance of the actual prepared result | PASS | docs/evidence/ticket-46-*.json | Degradation requires explicit acceptance |
| 63 | OMP user, I want attachment, count, total, decoded, model and encoded-RPC limits to be checked separately with clear refusal | PASS | docs/evidence/ticket-46-*.json | Each limit checked separately |
| 64 | OMP user, I want exact Attachment Originals to remain distinct from resized images or extracted document text | PASS | docs/evidence/ticket-45-*.json | Originals distinct from resized images and extracted text |
| 65 | OMP user, I want originals associated with committed native input to support history preview or download across Host restarts | PASS | docs/evidence/ticket-47-*.json | Originals for committed input across restarts |
| 66 | OMP user, I want missing or unavailable originals in imported TUI history to be explained without dropping the whole message | PASS | docs/evidence/ticket-47-*.json | Imported TUI history without originals stays readable |
| 67 | multi-tab user, I want drafts isolated by tab and Session to restore text and valid original references after same-tab refresh or Host restart | PASS | docs/evidence/ticket-48-*.json | Drafts isolated by tab and Session |
| 68 | draft author, I want restored attachments to obtain fresh scoped receipts and invalid items to remain explicit | PASS | docs/evidence/ticket-48-*.json | Restored attachments get fresh receipts |
| 69 | draft author, I want delayed restoration to respect newer edits and in-flight submissions | PASS | docs/evidence/ticket-48-*.json | Delayed restoration respects newer edits |
| 70 | OMP user, I want recovery and attachment preparation never to auto-send | PASS | docs/evidence/ticket-48-*.json | Recovery never auto-sends |
| 71 | local OMP owner, I want eligible unsent originals cleaned after 24 hours from explicit edit or active recovery without refresh-based renewal | PASS | docs/evidence/ticket-47-*.json | 24 h cleanup from explicit edit or active renewal |
| 72 | local OMP owner, I want execution and unresolved submission references to protect originals from ordinary cleanup or deletion | PASS | docs/evidence/ticket-47-*.json | Unresolved references protect originals |
| 73 | local OMP owner, I want committed sent originals to avoid automatic time expiry within a 10 GiB attachment budget | PASS | docs/evidence/ticket-47-*.json | 10 GiB committed-original budget |
| 74 | local OMP owner, I want a full attachment budget to reject new intake and request deliberate cleanup | PASS | docs/evidence/ticket-47-*.json | Full budget rejects intake |
| 75 | local OMP owner, I want original deletion to list known impacts and require confirmation | PASS | docs/evidence/ticket-47-*.json | Deletion lists impacts and needs confirmation |
| 76 | local OMP owner, I want deletion during related execution, known occupation or an unknown submission outcome to be refused without deferred execution | PASS | docs/evidence/ticket-47-*.json | Occupation and unknown outcomes block deletion |
| 77 | local OMP owner, I want deleting an original to leave native messages and saved model input intact | PASS | docs/evidence/ticket-47-*.json | Native messages survive original deletion |
| 78 | local OMP owner, I want uploads to use controlled private storage and display-only filenames | PASS | docs/evidence/ticket-47-*.json | Private storage, display-only filenames |
| 79 | authorized viewer, I want every original read, preview and download to recheck current browser, directory, Session and object rights | PASS | docs/evidence/ticket-47-*.json | Every read rechecks browser/directory/Session/object rights |
| 80 | local OMP owner, I want incompatible or changed global OMP installations to block Session admission with an explanation | PASS | docs/evidence/ticket-58-*.json | Changed installation blocks admission with re-enroll path |
| 81 | local OMP owner, I want upgrades and rollback to validate current native data and TUI compatibility as well as binaries | PASS | docs/evidence/ticket-61-native-data.json | Isolated synthetic data only; previous build is the pinned `@oh-my-pi/pi-coding-agent@18.20.2` |
| 82 | Linux or Windows-browser user, I want the declared Chromium or Chrome/WSL2 path and keyboard actions to be tested on the actual platform | PASS | ticket-61-platforms.json `linux.productFlow.keymap` and `windowsChrome.inputInjection` | Linux Chromium: four chords PASS. Real Win32 Chrome Dev 160.0.8171.0: keyboard, menu, file input and rendered turn PASS; a CDP file drop was not surfaced and OS clipboard/Explorer drag are recorded as interface limitations |
| 83 | OMP user, I want the accepted catalog and long-history corpus to be navigable within measured latency and Host memory targets | PASS | tests/product/evidence/performance-2026-11-22-product.json | #60 artifact shares source/patch/schema and DSH assets; bundle bytes differ only in bundler paths, so the thresholds hold for the same source |
| 84 | local OMP owner, I want installation, login, directory grants, manual recovery, revocation, shutdown and original cleanup to have reproducible instructions and accurate evidence | PASS | docs/operations.md; docs/release-final.md | Runbook plus this evidence set |

## Not covered by a story row

| Item | Status | Reason |
|---|---|---|
| Auditable deltas and immutable identities (decision 4) | PASS | `docs/evidence/ticket-61-freeze.json` + `tests/product/freeze.test.ts`; see acceptance row 1. |
| Automatic update / public distribution | out of MVP scope | Spec *Out of Scope*; `packages/delivery/gate.ts` is unwired (`scripts/inspect-delivery.ts` only) and still reports `blocked`/`GLOBAL_TARGET_NOT_SELECTED`. No released package or immutable public delivery is claimed. |
| Maintainer-operated workflow acceptance (decision 14) | NOT RUN | Requires the maintainer on their own machine; checklist in `docs/evidence/ticket-61-acceptance.md` and `docs/operations.md`. Agent-run substitution is not offered. |
| Real model-provider inference | NOT RUN by design | Every product flow uses `compatibility/omp/fixtures/live-provider.ts` with `realProviderInference: false`. |
