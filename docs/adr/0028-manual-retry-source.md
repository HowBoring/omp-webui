# ADR 0028 — Preserve Native retry and correlate its outcome

**Status** — Source component for [#53](https://github.com/HowBoring/omp-webui/issues/53). Product admission remains gated.

## Native behavior

The pinned public `prompt` command accepts the literal `/retry` and reaches OMP's builtin. The builtin refuses
streaming work. Native recovery also refuses compaction, an active retry or a context with no retryable assistant
tail. Eligibility can come from the active context, a retained failure or the current branch's persisted
transcript. A fully failed tool batch can run again with its original arguments. Other retryable failures
continue from an earlier context and may issue new calls. The confirmation warns that tools can run again and
effects can repeat or persist. A failed tool call may already have produced effects.

A plain `prompt` response with `agentInvoked: false` includes synchronous refusals. OMP sends the usage text
`Nothing to retry.` or the streaming warning as `command_output`, whose public schema has no request ID.
This source uses the correlated result from the candidate's durable submission path. A terminal failed local
receipt yields a generic Native refusal. A schema-valid response with the exact RPC command and request ID
can supply the Native `SUBMISSION_BUSY` code. Transport exception text and uncorrelated command output
supply no refusal code.

[Public RPC review](../upstream-compatibility.md) ·
[Pinned retry handler](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/slash-commands/builtin-lifecycle.ts#L545-L578) ·
[Native recovery](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/session/turn-recovery.ts#L3480-L3546)

## Host decision

One supervised worker owns one `ManualRetry` coordinator shared by its Browser Views. The product Host and DSH
roster do not register it. Its trusted binding must supply a matched Native submission cohort and the current
View credential, grant, directory, native identity, worker, Stop state and context revision. The revision must
change on any intervening work or context mutation that could invalidate the offered action, even if the
worker is idle again. The lifecycle signal must be revoked synchronously on authority loss.

The Host offers one 30-second, one-use confirmation per View, with at most 64 pending. Confirm consumes the
key before any await and rechecks the exact View, Native context and Stop generation. Joint native and Host
quiescence includes pending Interaction, history, queued input and other work. A trusted shared admission
gate must check `blocksAdmission` for fresh execution and history changes. Stop and read-only recovery remain
independently available. The joint Stop snapshot must count real pending work without counting the retry
coordinator's admission hold itself. The worker supplies this snapshot independently of any Browser View
and withdraws it as soon as worker authority is lost. A committed admission and the exact live result can
release the hold after joint idle even if the original View disconnects and the durable outcome is pending.
Showing the outcome to any View, including a reconnected View, still requires current authority.

Confirmation sends exactly one `submission_submit` using the existing candidate wire, fixed `inputType: "prompt"`,
`message: "/retry"` and `idleOnly: true`. The Host uses the fresh key as the RPC request ID and stable Native
submission ID, as in the #45 direct worker adapter. Browser arguments supply neither input bytes nor native
scope. The worker's matched public transport must validate correlation and process EOF. The candidate uses
protected Native reservation and exact ticket results under [ADR 0014's submission contract](https://github.com/HowBoring/omp-webui/blob/54545e62489ce13c2328f14c0882abc0c1c7d87c/docs/adr/0014-native-durable-submission.md).
The [isolated candidate metadata](../../packages/contracts/candidates/durable-submission-v1/candidate.json) records
the copied validators, source and tooling. Relevant definitions agree across the working and reference artifact
schemas. The whole schema hashes differ, so this is no compatibility admission for either artifact.

Ack, outcome and quiescence remain distinct. A current-worker `prompt_result` is correlated by that request ID.
A correlated `SUBMISSION_BUSY` reply is a terminal local refusal (`failed`, reason `native_busy`) with no model
call. It settles once joint Host idle is observed and releases the admission hold, so later explicit input is
not blocked. Transport exception text and uncorrelated busy text remain unknown and never establish a busy
refusal. A later `session_settled` or an already-settled result still requires current joint Host idle. A known local
synchronous refusal has no later prompt result. Outcomes require matching committed receipt facts, including
Native no-input and invocation evidence for success. A completed local frame contradicts the committed
Native builtin invocation marker and leaves the attempt unknown. A successful primary outcome gives no
guarantee about every tool effect.

On lost or incomplete results, recover the current worker's key with `submission_query`. Each lookup reads at
most 32 pages of 128 relations. The next lookup resumes from the verified Native offset through the candidate
bound of 100,000 committed entry facts and 4,096 no-entry facts. Every page must preserve the full receipt
identity and committed outcome facts. It must also advance the cursor and introduce only unseen relations.
The coordinator keeps fixed-size hashes and the invocation fact for the most recent attempt in memory.
Invalid or inconsistent page sequences clear that continuation and leave the outcome unknown. The initial
Native reply and subsequent pages both reject a claimed no-input result that contains an initiating entry.
Current View and worker authority are checked before and after each request. The tracked key survives a View
reconnect to the same worker. Recovery after Host restart or worker replacement remains unavailable.

## Product acceptance still required

- The candidate performs input hooks and skill resolution before the builtin. A production binding must verify
  that confirmed input reaches the exact retry handler and ordinary chat, shortcuts, and extensions cannot
  bypass its confirmation. The product also needs a correlated Native refusal reason if it presents the
  specific Native usage text.
- Native retry can reparent the active history to replay a tool batch. Verify the projection withdraws stale
  tool rows and preserves the correct execution scope and same-Session history across Views. A retry action is
  distinct from History Navigation, branching, draft resubmission and Session Recovery after worker loss.
- Match public submission, Stop, shared admission and DSH composition. Provide fresh settled-state
  reconciliation if the terminal notifications are lost and a recoverable Native receipt is still available.
  Verify false/busy, confirmation loss and worker replacement with actual authority and worker lifecycle.
- Run the required matched public Native RPC and real DSH browser cases with a genuine failed tool, state
  refusal, cancellation, lost outcome and side-effect accounting. The 27 deterministic public submission
  codec fixtures use synthetic Native responses and Stop, clock and authority observations. Native/runtime,
  browser and product acceptance are **NOT RUN** for this source slice.
