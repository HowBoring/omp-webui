# Ticket 33 public interaction candidate

S0 isolated synthetic acceptance only; product Session admission remains blocked.
Ordered source deltas are 0001 preflight, 0002 catalog, then
`compatibility/omp/0003-explicit-interactions.patch`. The canonical private-index
source gate verifies the cumulative tree and all generators consume that tree.

The actual OMP rpc-ui `ready.interactionPolicy` reports an immutable effective
policy before extension initialization. `get_interaction_policy` is handled
immediately during initialization; it never waits behind a startup dialog.
`respond_ui {targetId, answer}` is also startup-fast. Its tagged answer union
uses `type: value | confirm | cancel | ask`; successful business results are
`answered | cancelled | expired | invalid | stale`. Invalid business answers
retain the pending request and original native deadline. The same authored
wire generates TypeScript/Python/Go/Rust clients and native/Host validators.
The baseline unacknowledged `extension_ui_response` side channel remains
supported with the same first-valid settlement semantics.

One native settlement primitive covers select, confirm, input, editor and
opt-in ask. It validates before releasing a request, checks monotonic deadline
before accepting an answer even when timer delivery is late, cancels remote
presentation with a reason, and fences duplicate/late/aborted replies.
The effective source policy reaches the actual RPC UI context and builtin
AskTool. Under this policy the full HTML form retains one original deadline
across all fields/retries, elapsed-time inference cannot turn cancellation
into default submission, and timedOut formDialog results cancel. Ordinary TUI
contexts omit this RPC policy and retain their existing behavior.

Validation commands (Bun 1.4.4 on PATH):

```sh
bun test tests/interactions/native-dialogs.test.ts
bun test tests/interactions/native-worker.test.ts
```

The first command spawns children with synthetic HOME/profile before any OMP
import. Its native real timers and controlled clocks are separate fixtures.
The controlled clock covers a 30-minute boundary, invalid first answers,
delayed timer/reply races, explicit cancel/timedOut, abort, duplicates, exact
select/confirm semantics, partial HTML fallback expiry and formDialog expiry.
The native worker fixture uses the real candidate launcher in rpc-ui mode and
public extension registration. Its builtin AskTool fixture uses in-memory
settings and the actual worker-provided UI context; it never invokes a model.
`--offline` plus a preload HTTP guard forbids provider HTTP before OMP imports.
Synthetic native fixture paths, credentials and argv are fixed by source.

At the initial source checkpoint: controlled/native-dialog fixtures PASS;
actual worker and browser proof are pending (sandbox piped stdout requires
separately authorized execution). This is not yet completed #33 evidence.
