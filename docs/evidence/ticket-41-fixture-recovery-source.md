# Ticket 41 fixture diagnostics and original-owner recovery — SOURCE only

This TEST HARNESS correction is based on `bb607004a391247981e7fced92cf5fcbc09e3bbe` in a separate sparse
worktree. It does not fix or rerun the consumed signed attempt. Original session 85655 failed with the masked
`DRAIN_UNRESOLVED`; the original tool ultimately returned EOF/exit 130 after the separately reviewed manual
exact-pidfd recovery. Its fixture and automatic cleanup acceptance remain false. The JSON source record preserves
hash references to the original Git preimages and original FAIL/final/manual receipts; no original stage is edited.

The source repair supersedes `075fc364e4409d9df2e5a2046f3aceee09962857` (tree
`8404f33bc22340d6f9194e51fef370a055e983f6`). That source, descriptor and evidence remain available at their
immutable Git references. Both source reviews held its final-journal failure ordering and masked regression.
This revision changes only that P2 release ordering, its regression evidence and this source descriptor. The earlier
scope latch and fresh HOLD challenge remain in place. It is ready only for a fresh independent paired source review
and remains NOT BUILT/NOT RUN.

The agreed test seams are the public fixture diagnostic function and original retainer lifecycle/control methods,
with fake OS/process/selector boundaries. There is no Native import, preflight, actor, pidfd, `/proc`, signal,
network, FFI, producer, build, staging, key or signed-stage operation in this validation. The Python tests import the
class with a fake selector; they never execute its ONE-run entry. Kernel/FFI preflight imports are deferred inside
that entry's preflight. Bun tests use the existing no-provider/no-process guard for final verification.

## Diagnostic behavior

The diagnostic seam reads only own string data descriptors. It preserves the eight explicit public OwnershipError
codes and enumerated fixture codes, including `DRAIN_V4_REQUIRED`. Unknown messages/codes, inherited properties,
getters, coercions, proxy failures, arbitrary objects and unrecognized phase values cannot become receipt payloads.
The parent applies the same closed code/phase policy. It retains every accepted bounded event and the first parent
failure phase, along with child phase and code source. Non-diagnostic events also require their exact known factual
fields before entering the journal. Invalid/raw stdout and stderr are never logged.

Bootstrap authentication still precedes every Native/Host-bearing import. Authenticated component import/entry
failures now reach the same retained-failure path. Native reports its last attempted fixture operation around its
existing calls; real server open/close, guard checks and selection disposal remain the same operations. No production
ownership, handshake, support32, Host adapter, public client/server or admission contract is changed.

## Narrow future Root control

Only after entering an eligible HOLD does the original retainer mint a fresh unpredictable 128-bit challenge with
`os.urandom(16)`. It flushes the `ROOT_HOLD_CHALLENGE` entry to its original JSONL journal before enabling control.
Tests inject a pure challenge factory; they guard against real randomness. The challenge is never preminted,
refreshed on later errors or reconnects, or stored in another endpoint or credential store. Root must inspect that
post-HOLD journal to obtain it. Previously queued bytes cannot predict this fresh value.

After that journal entry, the original retainer registers **its original stdin** while continuing its original
bounded output readers. A single complete command, at most 128 bytes, is accepted:

```text
RECOVER_EARLY_NATIVE <exact 64 lowercase hex generation> <fresh 32 lowercase hex holdChallenge>\n
```

Here `\n` denotes one actual newline. Extra bytes in that input frame, wrong generation/challenge, arbitrary commands,
PIDs, FD numbers and paths are rejected. The first complete/oversized request or EOF consumes the control opportunity.
Malformed/uncertain control, journal failure and failed output drainage preserve HOLD. There is no timer-triggered
action or retry signal. Root must retain and inspect the original tool's flushed JSONL journal; the harness does
not create a second journal path or an authority-transfer endpoint.

Recovery is eligible only when the first parent HOLD is the authenticated Native failure while awaiting readiness,
before `NATIVE_READY` or any Host object,
with a completed original constructor, original retained pidfd and both original registered readers. The exact
Popen object is published before `__init__`; constructor BaseException and partial acquisition cannot grant recovery
authority. The original object, descriptor, generation, phase and first authenticated failure are pinned at HOLD.
Any later READY/Host event/object, second failure, changed first failure or phase, or failed drainage permanently
disqualifies recovery. Every bounded accepted event is still journaled. Already buffered child frames and all child
observations in a selector batch precede Root control regardless of selector order; uncertain partial frames cannot
authorize a signal. Eligibility is rechecked before signaling and before terminal release. Later Native/Host/helper
failures remain HOLD and require a separate reviewed policy.

The one Root request journals intent, sends one SIGTERM through the already retained Native pidfd, and journals the
result. It never reopens an authority handle or signals a numeric PID/group. Subsequent finite HOLD ticks only drain
original readers and observe terminal facts. The original Native Popen wait, both original clean EOFs, terminal
original pidfd and actual original-parent `P_ALL`/ECHILD are all required. The final
`RECOVERY_COMPLETE_RUN_STILL_FAILED` receipt must flush successfully before the original pidfd can close;
eligibility is rechecked after that flush. Successful completion closes it once and reaches the existing exit 1 with
`FAILED_EARLY_NATIVE_ORIGINAL_DOMAIN_DRAINED`. The final journal describes terminal domain facts while release is
still `NOT_ATTEMPTED`; after close returns, the in-memory receipt records `originalPidfdRelease: CLOSED`.
A final-journal failure keeps release `NOT_ATTEMPTED` and preserves the original descriptor. An exception from close
records `originalPidfdRelease: UNCERTAIN`, preserves the first failure, and permanently prevents another close,
signal or control opportunity; it cannot claim that descriptor remains open. Unknown adopted children, a live domain,
adopted zombies, nonterminal/missing pidfd, incomplete wait/readers or failed journaling remain HOLD. No adopted child is enumerated,
signaled or reaped by a fabricated recovery authority.

That status describes process-domain facts after Root's request. `fixtureAcceptance` and
`automaticCleanupAcceptance` remain false; fences are not inspected or mutated by the retainer. It does not prove
lease/fence disposal, product admission, nominal handshake or the runtime fault matrix.

## Verification and limits

The original vertical RED/GREEN transcripts under `fixture-recovery/` cover lowercase diagnosis, secret scrubbing, constructor
ambiguity, parent validation, original Root recovery, event payload rejection, failed drain,
partial reader acquisition, already buffered event drainage and phase scrubbing. The source repair adds vertical
RED/GREEN transcripts for late-event scope, fresh HOLD challenge, partial pending output and control-journal failure.
New tests also cover stale queued/fragmented generation/challenge commands, consumed EOF/malformed input, permanent
scope invalidation and no challenge refresh. The earlier final-journal regression replaced the pinned child and
therefore did not reach its injected failure. The repaired regression keeps that exact original child, changes its
wait behavior in place, reaches the final-journal failure once and asserts no close across later ticks. An independent
pure-fake counterexample against immutable `075fc364` also reaches that failure once with the same child and proves
the old close occurred; the corrected source passes the same counterexample. The positive path verifies one final
FAILED journal before one original close. A close-failure test proves explicit uncertainty, no second attempt, no new
scope or Root control; scope changes during the final journal also block release. AST inspection alone verifies the
completed HOLD path reaches exit 1; the ONE-run entry is never executed. New P2 RED/GREEN receipts and exact command
tool objects are pinned by `fixture-recovery/final-journal-checks.json`.
Final verification passes all 25 prior pure Python tests plus one close-uncertainty test (26 total),
and 9 Bun tests (the 3 diagnostic tests plus the unchanged 6 public handshake tests), with 33 Bun assertions.
Both supplied Python interpreters pass. Targeted strict no-emit TypeScript checks cover diagnostics/bootstrap and
both test files; Native fixture and source-checker syntax are parsed as text. The full Native type/build graphs and
all actual runtime/kernel cases are NOT RUN here. The source checker includes the new tests for a future explicitly
selected full source check, but was not executed because it also builds graphs.

Fresh independent Spec and Standards review is the next gate. New staging, approval/signing and a separately
selected actual run require a new scope. Whole ticket 41, global/private admission and the runtime fault matrix
remain open/BLOCKED. No GitHub write or integration merge is part of this change.
