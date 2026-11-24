# #48 Stop coordinator source vertical

Status: real Host composition wired on the S2 isolated Chat component. The
browser → Host → public RPC → `StopCoordinator` → supervised native worker path
runs with Chromium against the real candidate; product admission stays blocked
in `apps/host/src/main.ts`. The public queue producer and the #47 Interaction
Broker are now composed into this isolated Chat Host, so pending native questions
and native queue withdrawal are reachable in the real browser path.

`apps/host/src/chat-component-runtime.ts` builds one coordinator per admitted
worker generation. Its native port issues the matched public
`abort_branch_summary` / `abort_and_restore_queue` commands through
`SessionWorker.control`; `observeState` consumes real `get_state`; EOF and
`session_settled`/`prompt_result.sessionSettled` enter through typed
notifications; the owned capability delegates to
`SessionSupervisor.forceWorker`, which closes the retained supervised worker with
the existing bounded termination/reap path. `session/cancel` on the Chat Gateway
now requests the same ordinary Stop. `apps/host/src/session-remote-dispatch.ts`
installs the page binding through `stopCaller` for `ompStop` methods only.

`packages/contracts/stop.ts` contributes the new public Host `ompStop` namespace:
`state`, `stop`, `offerForce`, and `confirmForce(token)`. The browser supplies no
Session path, arbitrary Native command, worker generation, or PID. Authenticated
Host dispatch supplies the page binding through `stopCaller`; the coordinator is
constructed for one immutable target and worker incarnation. The adapter must
revalidate browser/resource authority and bind the actual admitted Peer, as in
the #47 Broker. This source does not create that product admission route.

`StopCoordinator` atomically enters stopping and starts all three controls:

| Control | Existing matched public Native operation | Evidence and limit |
| --- | --- | --- |
| Fence/cancel UI | Broker `beginStop()` → generated `respond_ui` | Fences answers synchronously; cancellation does not recursively request Stop |
| Cancel history summary | `abort_branch_summary` | Existing out-of-order command bypass; acknowledgement does not prove the history operation ended |
| Withdraw queued input and abort | `abort_and_restore_queue` | Existing handler clears the queue before aborting; no `abort_and_prompt`, synthetic queue command, or automatic resubmit |

`PublicStopRpc` uses command/result types from committed `RpcWireCommands`.
`createStopNativePort` supplies fresh correlation IDs and those exact command
names. It is a typed injection into a validated public JSONL RPC client, not a
transport implementation or a new Native API. Source inspection used the matched
`vendor/omp/.../rpc-mode.ts` handlers (queue withdrawal before `session.abort`,
and `session.abortBranchSummary`) read-only. No vendor file was imported/executed.

The Host must install the coordinator before accepting work and implement
`StopHostPort.beginStop()` with synchronous answer fencing before its first await.
Broker expiry's injected `requestStop` calls the coordinator's `requestStop`;
the coordinator calls `beginStop`, which does not call back into `requestStop`.
Broker `pendingCount` includes unresolved Native UI and all in-flight `respond_ui`
writes, including cancellation of UI arriving during stopping. Failed, invalid or
incompatible acknowledgements remove answer rights but retain a per-UI unknown
blocker. The required internal `StopHostPort.cancellationUncertain()` method must
read the Broker's live ledger; it surfaces `ui-cancel-failed` even after the initial
`beginStop()` promise completed. `beginStop()` also rejects with the typed
`InteractionCancellationUnknownError` for known unresolved cancellation. There is
no optional getter or false default in this composition contract.

Only a validated terminal `respond_ui` result or a public Native cancel notice for
the same UI in this Broker's worker incarnation clears that UI's blocker. A held
answer that Native actually consumed retains its `answered` outcome; revocation
still fences the old view. An invalid answer cannot reopen a cancelled/unknown
request. Native settlement, unrelated cancel IDs, elapsed deadlines, duplicate UI,
and repeated Stop cannot clear unknown cancellation or retry it. Other Host
control failures stay failed even with an empty ledger. Scope revocation
permanently prohibits Broker resume. The busy count is used for its zero predicate,
not as a distinct-question count.

The ledger shares the existing 4,096 seen-UI bound; accepted answer cards remain
bounded at 16. Repeated declined IDs cannot start more cancellation writes. Tracking
overflow latches a blocker for the worker incarnation rather than evicting evidence;
it cannot be cleared by a partial cancel notice or a timeout. Such a worker cannot
be declared jointly idle through this source coordinator.

Joint idle requires successful completion of all three controls, affirmative
current-worker Native settlement, and zero Host Interaction/history/queue/other
work. Native notifications enter through typed `observeNotification` using actual
`prompt_result.sessionSettled` / `session_settled`; public `get_state` enters through
`observeState`, requiring explicit idle/background/queue fields and matching
Session/worker identity. A Native ack, agent_end, EOF, old worker, missing state
field, or browser disconnect cannot establish joint idle. The real transport must
continue consuming and validating ordered frames, correlate accepted prompts and
clear Native settlement on new work; the source API does not infer those facts.
EOF/worker loss stays unknown, including later tail settlement observations.

Each real prompt/steer/follow-up/history dispatcher must check
`admitFreshAction(currentPage)` synchronously at dispatch, alongside its own
admission/transaction rules. `acceptingWork` is false until the joint predicate
holds, and returns false again for observed background or Host work. This class
stores no blocked operation or history target. Users must make a fresh action
after Stop; no retry, navigation, queue drain, or input replay is scheduled.

Withdrawn input is returned as an `unsentOnly: true` recovery candidate. Queue
order, image data/metadata, `imagesDropped`, and `truncated` are preserved;
`draftConflict` reports the Host draft adapter's current newer/nonempty edit.
No composer is overwritten, attachment receipt fabricated, or prompt sent.
The consuming UI must present recovery/missing-image/truncation/conflict details
and require a deliberate edit/merge; complete attachment-original recovery and
per-tab revision ownership remain gated by the attachment vertical.

Thirty elapsed monotonic seconds only make a separate force offer possible.
There is no kill timer. An offer is one-use, expires after 60 seconds, and binds
the current page/credential/Peer generation, immutable target, coordinator, and
original worker capability. Re-offer replaces the old token; disconnect, refresh,
revocation, idle, and observed invalid handle invalidate it. An invalid or throwing
handle check permanently removes force authority for that coordinator, even if an
adapter later reports it current. Concurrent confirms consume before awaiting.

`OwnedStopCapability` must close over the original supervised spawn handle and
delegate its existing bounded termination/reap implementation. It has no numeric
PID or recovered/group/process-enumeration fallback. Only observed `reaped`
becomes ended; failure/loss is unknown and cannot replay. The capability is
optional: absent or wrong-generation ownership never exposes force. `SessionSupervisor.forceWorker` resolves only the retained active worker of the
authenticated owner/grant/cwd and delegates to that worker's own bounded
`close({cooperativeMs:0, terminationGraceMs:5000, readerGraceMs:1000})` path; it
never enumerates PIDs or signals a recovered process. Chromium evidence: after
the 30-second offer, one-use confirmation terminates and reaps the stubborn
fixture worker (PID gone, exit audit present) while the draft survives.
Directory/revoke-all/Host shutdown's automatic 30+5-second safety policy remains
separate and is not implemented by ordinary Stop's user confirmation policy.

Validation (Bun 1.4.4 `38afee6c8`, strict TypeScript):

- 30 Stop public Client Connection/Remote → real Typert Gateway/service →
  coordinator/Broker fixtures, 223 assertions, pass. Concurrent Stop and force
  arrivals are active together while an external acknowledgement is held.
- Controlled monotonic-clock checks cover 29,999/30,000 ms, expired confirmation,
  no timer-driven termination, current/replaced/revoked page, invalid original
  handle, and unknown/throwing termination.
- Joint-idle checks cover each Host busy category, held queue withdrawal, late UI
  cancellation, public state/background fields, wrong Session/worker, agent_end,
  EOF/tails, cancellation failure, restoration warnings and newer draft conflict.
  Invalid/rejected/incompatible known and late-UI cancellation plus affirmative
  Native settlement stays stopping with an unknown UI outcome and refuses fresh
  action. Controlled held-answer races cover Stop, deadline, scope revocation,
  Native cancel, later actual consumed answers, and invalid replies that must not
  reopen. Tracking overflow and unrelated Host UI-control failures remain blocked.
- RED before GREEN: absent source contract; late in-flight UI incorrectly reached
  idle; missing typed public command adapter; missing public state observer.
  The late-UI RED expected stopping and observed idle before busy-write tracking.
  Review-fix RED reproduced the same false idle for known Native-invalid
  cancellation after settled; retained unknown evidence/live failure propagation
  made it green. The typed internal port changed; public Remote/RPC schemas did not.
- Existing #47 Broker regression: 12 fixtures / 68 assertions pass. Whole strict
  repository typecheck and `git diff --check` pass.
- Public queue producer: the Host policy now validates only `steer` and
  `follow_up` from the authored wire schema (`queue-command.generated.js`), and
  `SessionWorker.steer/followUp` are Host-only typed methods. A real cooperative
  busy worker queued `"queued while busy"` through `steer`, observed it in
  `get_state.queuedMessages.steering`, and `abort_and_restore_queue` returned it
  before clearing the queue. The Chat UI still refuses busy prompt/steer/follow-up
  input per US28; no browser tunnel or synthetic queue command exists.
- Composed #47 Broker: `chat-component-runtime.ts` builds one Broker per worker
  generation, forwards validated frames, reports its `pendingCount` as Stop's
  interaction pending, and its `beginStop`/`cancellationUncertain`/`resumeAfterStop`
  back Stop's host port. The Broker is seeded with the ready frame's negotiated
  policy, and the Host opts in to native ask dialogs through the public
  `set_ask_dialog {enabled:true}` interaction command (`SessionWorker.setAskDialog`),
  so questions arrive as typed `extension_ui_request` frames. Chromium `pending-ui`
  scenario: the native question audit
  records `answer: "cancelled"` and Stop settles only after the interaction count
  returns to zero and native state is quiescent.
- Draft recovery: `apps/chat/src/restore.ts` is the single browser-side merge rule
  (join steering then follow-up, explain dropped images/truncation, never
  overwrite a non-empty composer) and is covered by `tests/chat/restore.test.ts`.
- Chromium matrix: 24 scenarios pass, including ordinary Stop keeping the draft,
  idle Stop offering no force, busy refusal, pending-UI cancellation, stubborn
  30s force termination/reap, provider error, worker EOF, and Host restart.

Run each guarded fixture in its own Bun process, explicitly by path:

```sh
fixture_top=$(mktemp -d /tmp/stop-fixtures.XXXXXX)
mkdir "$fixture_top/home" "$fixture_top/profile"
approved_bun_bin=/workspace/work/rpc-public-module-probe/tooling/bun/package/bin
env -i HOME="$fixture_top/home" PI_CODING_AGENT_DIR="$fixture_top/profile" TMPDIR=/tmp \
  BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 PATH="$approved_bun_bin:/usr/bin:/bin" \
  "$approved_bun_bin/bun" test --no-env-file \
  --preload ./compatibility/omp/fixtures/no-provider.ts ./tests/interactions/stop-remote.fixture.ts
env -i HOME="$fixture_top/home" PI_CODING_AGENT_DIR="$fixture_top/profile" TMPDIR=/tmp \
  BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 PATH="$approved_bun_bin:/usr/bin:/bin" \
  "$approved_bun_bin/bun" test --no-env-file \
  --preload ./compatibility/omp/fixtures/no-provider.ts ./tests/interactions/broker-remote.fixture.ts
./node_modules/.bin/tsc --noEmit -p tsconfig.json
```

The imported fixture guard runs before the public graph: disposable TOP containing
synthetic HOME/profile/cwd/tmp, allowlisted environment, no-provider preload,
Native/SDK/FFI/process/socket/listener import/runtime guards. Remote HTTP envelopes
are composed in memory; no actual HTTP, browser, Host listener, Native/Agent/SDK,
provider, socket, FFI, or kernel process operation runs. Dependencies are linked
read-only; no build/schema/pin/dependency mutation or private Session data access.

Remaining acceptance gates: complete attachment-original recovery, the matched
provenance/global-build tuple, and product admission (still blocked in
`apps/host/src/main.ts`). The browser path has no queue producer by design: the
public queue methods are Host-only, and US28 keeps busy Chat input refused, so the
browser never fabricates queued work. Queue creation/withdrawal and draft merging
are proven by the real worker RPC test and the browser merge unit test instead.
