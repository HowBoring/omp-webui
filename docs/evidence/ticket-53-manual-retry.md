# Ticket 53 — Explicit manual Retry and native refusal

Status: component evidence PASS in the isolated Chat carrier. Ticket 53 and parent spec 29 stay
**open**; product Host admission is **blocked**. The Retry surface is mounted only in this
evidence carrier, not in the product Host route table, and every provider is a controlled
synthetic fixture, not real inference.

## What is proven

- A terminal native failure is never retried by the WebUI on its own. The failed turn settles
  `failed` with the native error rendered in the preserved assistant entry, the provider is called
  exactly once, and no Retry attempt exists until the user acts
  (`tests/chat/browser.py`: `retry-failed-turn-not-resubmitted`).
- Retry is an explicit two-step action: an offer only becomes a confirmation carrying the native
  disclosure (`run tools again`, `side effects`, `earlier effects can remain`), and cancelling that
  confirmation sends nothing (`retry-cancel-sends-nothing`; `tests/manual-retry/public-rpc.test.ts`).
- One confirmed retry sends exactly one public prompt `/retry` through the durable submission
  carrier to the same worker and target. The attempt is visible (`admitted` → `succeeded`), the
  draft is preserved, and the provider is called once more only after confirmation
  (`retry-lost-reply-pending-then-one-native-attempt-recovers`).
- The native journal is the source of truth: a successful retry appends **one** assistant entry and
  **zero** user entries. The original failed assistant entry remains. UI assertions compare this
  native delta (`users +0`, `assistants +1`) rather than bounded projection totals, because the Chat
  projection is recent-windowed and re-enrolls after the retry settles
  (`retry-history-preserved-across-host-restart`).
- A lost `ompRetry/confirm` reply is not assumed succeeded or failed: the attempt stays
  `unknown` with `evidence="no_response"` and `settled=false`, no second request is sent, and the
  explicit `Check outcome` lookup reads the already-issued request's durable receipt and reconciles
  it to the exact live result (`retry-lost-reply-pending-then-one-native-attempt-recovers`;
  `tests/manual-retry/public-rpc.test.ts` lost-reply and paged-recovery cases).
- Native refusal is surfaced as a refusal with its public reason (`native_refused`, `Nothing to
  retry`) and no model call; busy, expired confirmation, changed context, replaced worker and
  revoked authority all refuse without dispatching (`retry-native-refusal-explicit-no-model-call`;
  `tests/manual-retry/public-rpc.test.ts`).
- A failed tool batch revisited through Retry replays the tool visibly: the controlled tool's
  second execution reaches the worker, Stop aborts it, the retry attempt settles `cancelled`, the
  draft survives, and admission recovers for the next fresh prompt
  (`retry-replays-aborted-tool-batch`, `retry-stop-settles-cancelled-and-recovers-admission`).
- The retried conversation survives a Host restart and is rebuilt from the native Session with the
  original failed turn and the single retried turn; no attempt is reconstructed
  (`retry-history-preserved-across-host-restart`).
- A second browser credential that opens the same Session withdraws the first View's authority
  before it can offer; the displaced page receives 401 and starts no attempt while the native call
  count is unchanged (`retry-second-credential-withdraws-displaced-view-no-dispatch`). Two attached
  Views sharing one worker and one attempt, and detached-page authority loss, are covered against
  the real carrier in `tests/chat/carrier.test.ts`.

## Mechanism

Public OMP prompt RPC only. Confirmation issues a `submission_submit` with
`inputType: "prompt"`, `idleOnly: true`, `message: "/retry"`, a fresh `clientSubmissionId` and
`preparationId: manual-retry-v1:<requestId>`; no tree/rewind selector and no hidden prompt is used.
`ManualRetry` (`packages/manual-retry/service.ts`) keeps per-View confirmations bound to the exact
browser authority, context revision and Stop generation, refuses unless the Stop snapshot is idle
with all pending counts at zero, and blocks shared admission until the issued attempt settles.
Outcome evidence is the exact live `prompt_result` for the issued id plus the durable receipt;
`completed` without an agent invocation is not accepted as a retried turn, and contradictory
receipt/live evidence becomes `unknown`/`conflict` instead of being guessed.

The retry RPC is authorized by the Chat component runtime's own trusted caller; it needs no Chat
presentation binding (`apps/host/src/session-remote-dispatch.ts`). The browser client clears the
consumed confirmation before dispatch and refreshes `ompRetry/state` when the confirm reply is lost,
so the unknown attempt and its `Check outcome` control remain visible instead of disappearing
(`apps/chat/src/client.tsx`).

## Evidence tuple

- OMP base `57771ae562b9345e0579bceb2d68d585e3e6927e`
- candidate source `e9e00d47306d8885563fc271f5a79ea3330f18a5ec52de4f54688c64101b0530`
- candidate patch set `99b33a85b209f7f3e29beb97ee531a8399eb5e9069f2eb4abc7f1e3e146bd5cb`
- candidate schema `b13a75ebfb36a0c48edb5d796e8335d6ab0a6a6b6fad7eda06be40c7f7c5a1ff`
- candidate CLI `a5dcfd62b2e1045faa8fb00c7919636d4f8291903b362d39f131fe6f8a8c8b30`
- Chat host bundle `7f7a6839f2f4940e5be2830d843fa2ae83fcafec891a4be561c4a9df8c4ffdf8`
- enrolled chat manifest `7bbf0bb7090bd0e18b2fa59358ac523081e9fc047f112ce6c1735081ddfa4088`
- Bun `1.4.4`, Linux Chromium `157.0.8103.38`, Playwright `1.65.2` (Python 3.14.4)

`docs/evidence/ticket-53-browser.json` is the full run: 32 scenarios, `status: PASS`,
`privateData: false`, `productAdmission: blocked`, `errors: []`. It was captured on commit
`429d6ef` before merging the latest integration. The final tree `ff08968` (merging `0e437d7` and
`b4f8db2`, including ticket 57's tab-scoped drafts) rebuilt both bundles and re-ran the complete
eight-scenario Retry matrix on the same fixed port: `PASS`, all eight scenarios, 63s. `bun test
tests/manual-retry tests/chat/carrier.test.ts` remains 52 pass / 0 fail and `bun run typecheck` is
clean on the final tree. The full 1010-test repository suite has 15 pre-existing environment
failures (for example `compatibility/omp/fixtures/live-public-rpc.test.js` "genuine controlled tool
execution"); that same test reproduces the failure at integration baseline `584fd72`, before this
ticket's code, so it is not evidence for or against Retry.

## Reproduction

```
bun --no-env-file scripts/create-chat-fixture.ts
bun --no-env-file apps/chat/build.ts
bun --no-env-file scripts/build-chat-host.ts
mkdir -p vendor/chat && bun --no-env-file scripts/enroll-chat-fixture.ts
bun test tests/manual-retry/public-rpc.test.ts tests/chat/carrier.test.ts
OMP_CHAT_PORT=32953 OMP_CHAT_FIXTURE_PORT=32953 OMP_BROWSER_ONLY_RETRY=1 \
  CHROME_EXECUTABLE=/usr/bin/google-chrome \
  /home/howboring/Projects/omp-webui-recovery/venv/bin/python tests/chat/browser.py
OMP_CHAT_PORT=32953 OMP_CHAT_FIXTURE_PORT=32953 \
  CHROME_EXECUTABLE=/usr/bin/google-chrome \
  /home/howboring/Projects/omp-webui-recovery/venv/bin/python tests/chat/browser.py
```

The fixed ports keep this ticket's Host from colliding with other worktree acceptance runs. The
retry-only mode runs the eight Retry scenarios twice consecutively; both runs listed all eight and
the full matrix listed all 32.

## Not claimed

- Product Host admission of Retry, or a claim that this slice is the complete MVP.
- Real inference or real third-party provider behaviour; the failure paths are the explicit
  `live-provider.ts` synthetic scenarios (`retry`, `retry-tool`).
- Arbitrary crash recovery: a retried native turn is shown from native history, and an unknown
  durable outcome is never silently converted into success by the Retry entry point.
- Two browsers concurrently acting on one worker Session: the supported guarantee is that the
  second credential displaces the first View (401) and no second native call occurs. Shared-worker
  multi-View admission is proven at the carrier seam, not as a product concurrent-editing feature.
- The lost confirmation is simulated in the real browser by answering the public RPC with HTTP 502
  after the Host processed it; the underlying durable lost-reply cases are unit/RPC evidence.
