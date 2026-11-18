# ADR 0019 — Bind manual Chat to an exact supervised worker

**Status** — Unregistered Host source for [#45](https://github.com/HowBoring/omp-webui/issues/45).

One Chat Gateway lives with an explicitly opened supervised worker. Its trusted composition must
supply the verified Native submission cohort, the precise Native source, instance and Session,
current public RPC transport, joint Stop state, and current Browser View and draft-owner authority.
An authority lifetime ends synchronously when the credential, grant, canonical working directory,
or worker authority changes. The draft owner identity must be assigned by the Host, remain stable
across reconnects of the same draft, and differ for another browser, tab, draft, or authority scope.
The binding also supplies the current projection. The authenticated carrier installs an opaque
server-side View capability in `chatViewCaller` for each invocation. Shared Peer identity or request
JSON cannot supply this capability. With no carrier binding, both Gateway services refuse access.

The opt-in unary carrier uses `BrowserAuthority.admit` with write protection, then asks a trusted
Host resolver for the View's enrolled handle. Enrollment records the exact browser credential,
canonical cwd, grant identity, supervised worker generation and Native source, instance and Session.
The composition supplies the View and draft attachment lifetime and current projection, and keeps the
same enrollment when that draft reconnects. The Host assigns a distinct owner to every enrollment.
A resolver supplies the original server-side handle. A fresh invocation capability checks the
admitted credential, enrollment and exact worker and grant on every authorization and before reply
publication. An invocation captures one projection and combines Request, Peer and enrollment cancellation.
Enrollment lives in memory and is limited to 128 Views. The opt-in dispatch accepts at most 32 concurrent
calls through the existing public DSH unary parser. The size-bounded HTTP listener and the matched Native
and UI composition still own route activation. The diagnostics server keeps its existing unary allowlist.

The public DSH `session/prompt` delegate accepts manual non-empty text and captures its exact request
identity, UTF-8 bytes, mode and original projection before an await. A fresh prompt checks whether
the last acknowledged attempt has already settled, so admission can proceed without a separate View
state poll. Pending admission or execution still fences new input. The delegate requires exact
Session identity on each Native `get_state` observation and rechecks Native and joint Host
quiescence, View authority and projection. Both
accepted DSH modes use `submission_submit` with `inputType: "prompt"` and `idleOnly: true`. The DSH
request ID is also the Native submission ID and RPC request ID. The Native candidate owns the final
idle check. The future shared gate must account for Stop, Interactions, Retry, History Navigation and
other work without counting this gateway's admission hold as an independent operation. The
matched composition also has to enforce [Manual Retry confirmation](0028-manual-retry-source.md)
through the Native command boundary for ordinary Chat input.

The reply must match the exact command, request ID, target, durable submission ID, local reservation
and origin. Only a valid nonduplicate acknowledgement binds this dispatch to a reservation. A key
lookup exposes no Native fingerprint, so a missing acknowledgement leaves even matching query facts
unbound. Matching early lifecycle frames stay private until acknowledgement and are discarded on
a failed or ambiguous dispatch. A committed input relation from an acknowledged reservation supplies
acceptance, including when the matching generation fails or is cancelled. An input history row can
carry the request ID only through its exact validated Native origin and input role. A successful
terminal committed operation with a complete consistent no-input receipt supplies the alternative
settlement for an exact original projection. The correlated `prompt_result` and current Native and
joint Host quiescence determine execution settlement separately. Synchronous terminal builtins
without an invocation marker may settle without a later result notification. An exact committed
`native_builtin_consumed` marker on any receipt page requires the matching agent-invoked prompt
result and fresh idle checks before settlement or positive no-input evidence. An unkeyed `session_settled` frame has no per-request
causality and uses the current `get_state` observation for reconciliation.

Transport errors, uncertain receipts, duplicate Native reservations, and absent query results
provide no replay authority. A correlated Native conflict permanently fences recovery for that key
and releases its admission hold. A different key still requires ordinary current authority and
Native and joint Host idle checks. An ambiguous dispatch keeps its admission hold. A repeated
same-worker request can observe an acknowledged key without a second mutation. A stable `not-submitted` receipt requires a Host-owned proof of refusal
before RPC dispatch for a permanently consumed key. The Native may have created a reservation
before a reported busy failure. Another draft or worker cannot obtain a prior attempt's recovery
proof merely by knowing its ID. View cancellation or reconnect ends publication to the old invocation
while admitted work remains owned by the same worker. A replaced worker starts with no Host attempts.
The gateway retains up to 1,024 metadata records and no prompt body. An observation checks up to
32 pages of 128 relations for one consistent publication. One reconciliation runs per worker at a
time. Concurrent recovery can return unknown and concurrent state reads can return the latest
observation without starting another poll or query chain. Requests beyond the read budget may remain
unknown, with the worker's admission fence held when settlement remains unproved.

The existing semantic draft provider in `packages/drafts` remains the owner of current revision and
scope checks and storage publication. A Chat outcome is evidence only. The browser composition
still has to match that evidence to the exact protected marker and revision through the existing
provider gate. A no-input proof carries the old projection for exact echo cleanup after a projection
change. A newly ready projection has its own authority for prompt input and state publication. The
gateway does not create drafts, recover editor state or consume attachment Originals.

## Source and evidence

- Host donor `54545e62489ce13c2328f14c0882abc0c1c7d87c`. Source references are
  `packages/chat/admission.ts` blob `fa73f4b834cfb13af2b77dd93c82971e5cacdd1f`,
  `packages/contracts/chat.ts` blob `90a060de6b9627e07a39d9b355c92c512a82ba23`,
  `packages/sessions/presentation-service.ts` blob `31595fda37ba3e3293dc6b40dce301db6ab80596`,
  and `packages/compatibility/session-worker.ts` blob `4da03c7b878421444a584a0b365f5ff79147dc21`.
- The [isolated durable-submission candidate](../../packages/contracts/candidates/durable-submission-v1/candidate.json)
  records the exact public validator and generated wire source. The Chat and Manual Retry coordinators
  share the candidate response and page validation. The active SessionWorker has no adapter for this
  cohort. The candidate transport, authority, shared admission and Native provenance on active
  Conversation Projection remain composition obligations.
- The exact offline model discovery correction and original Linux receipts are recorded in
  `aa8dd041bbff1adb92ff89625077a897f8bf8c8f`, under
  `compatibility/omp/candidates/offline-model-discovery-v1`. The donor browser attempt used DSH
  tree `ff9cb83a99a9b969057ca74771210c66d67f5df5` and a one-file Native startup overlay.
  The original `361e13` → `542f4d` tool receipt exited 0. The retained provider-error result SHA-256
  is `545ec10201d7c4dc577070597531d20e2ea28666fda8017bd372df62eca687a5`.
  The external donor receipt covers one controlled failed generation, one submitted input, editable
  draft, absent unresolved notice, original wait/EOF drainage and zero guarded dispatch and denials.

The local fixtures invoke the real DSH Gateway and the current public `session/prompt` descriptor
with synthetic worker replies. That descriptor exercises committed input. Browser-side no-input
and notice reconciliation require the corresponding matched public DSH contract and composition.
These tests provide no new Native, browser, or product/private admission evidence.

```sh
BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 NODE_DISABLE_COMPILE_CACHE=1 bun test \
  --preload ./tests/interactions/no-provider.ts tests/chat/gateway.test.ts tests/manual-retry/public-rpc.test.ts
BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 NODE_DISABLE_COMPILE_CACHE=1 node \
  node_modules/typescript/bin/tsc -p tests/chat/tsconfig.json
```
