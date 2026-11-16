# Public explicit interactions (#33)

This is the S0 isolated acceptance slice. Product Session admission stays blocked.
It uses synthetic native profiles, a real candidate rpc-ui worker and genuine DSH
root Slot, Connection, Remote and Gateway. Windows acceptance is deferred.

## Native public contract

Ordered patches are 0001 safe preflight, 0002 readonly catalog, then
`compatibility/omp/0003-explicit-interactions.patch`. The private Git index source
gate verifies their exact cumulative tree. Authored wire definitions generate
TypeScript/Python/Go/Rust contracts and narrow native/Host AJV validators from the
same source.

Safe `--rpc-preflight` reports `rpcUiInteractionPolicy` without importing the
ordinary CLI/session/UI closure. The fixture compares base/source/patch/schema
and runtime identity with the built candidate **before starting an ordinary worker**.
The policy is a frozen, import-free native value:

```json
{"version":"1","explicitAnswersOnly":true,"nativeExpiry":"cancel","toolExpiry":"cancel","invalidAnswer":"pending"}
```

rpc-ui `ready.interactionPolicy` is emitted before extension initialization. The
native public `RpcClient` validates and freezes its cache before delivering startup
UI callbacks. `get_interaction_policy`, `respond_ui` and existing
`negotiate_protocol` are startup-fast. A real unanswered root dialog can remain
pending while v2 negotiation completes; process readiness has its own bounded
deadline rather than sharing the human interaction deadline.

`respond_ui {targetId,answer}` accepts tagged `value`, `confirm`, `ask` or `cancel`
answers. `confirm:false` is an explicit answer. Business results are `answered`,
`cancelled`, `expired`, `invalid` or `stale`. Invalid values leave the request pending
with its original deadline. Existing unacknowledged `extension_ui_response` remains
supported with the same atomic settlement rule. Public client methods are
`getInteractionPolicy()` and acknowledged `respondUI()`.

One native settlement primitive covers select, confirm, input, editor and opt-in
ask. It validates before settlement and checks monotonic time before accepting a
reply even if the timer callback is delayed. Timers/listeners release once;
cancellation carries a reason, output failure rejects, and duplicate/late/aborted
replies cannot produce defaults. UI, tool and URI correlation maps stay separate.

The actual rpc-ui context's readonly policy reaches builtin AskTool through the
SDK's real ToolContextStore. An HTML fallback shares one original deadline across
all fields, retries and prefilled editors. Expiry/abort cancels partial input;
the elapsed-time heuristic and recommended defaults cannot submit it. A timedOut
HTML form result also cancels. Ordinary TUI contexts omit this RPC policy and keep
their existing behavior.

## Isolated Host and browser

InteractionBridge keeps ephemeral records scoped by worker generation and UI ID.
Startup cards require no Session; after startup settles, public native get_state
supplies the actual isolated Session identity for later cards. No private Session
file or native SDK import enters the Host. The Host build rejects OMP imports
outside the existing pure public frame decoder. Public RpcClient imports run only
inside guarded native test children.

The page mounts the public DSH root Slot/contribution and sends typed
ompInteractions.snapshot/answer/start calls. DSH's renderer requires its public
session-maybe adapter even for root rendering: the binding represents strict
absence (undefined key, no sources/props, rejects actual targets). It creates no
Session object/controller. React and ReactDOM are exactly 18.3.1, with all DSH and
application imports resolving one React realm.

Default Host wait is 1,800,000 ms. Operator-only S0_INTERACTION_WAIT_MS configures
it (positive, at most one day); earlier native constraints take precedence.
Monotonic timers and display deadlines are created once. Refresh, reconnect,
snapshots and all viewers leaving never renew them. Expiry sends acknowledged
native cancellation and abort independently; real browser Host logs retain abort acknowledgement.
Browser answer retention is bounded before payloads/continuations are retained:
one outstanding answer per interaction, eight per worker, and no answer queue.
Excess attempts return the typed Host result
`{status:"overloaded",code:"INTERACTION_ANSWER_LIMIT"}` immediately. This is Host
admission feedback, separate from the unchanged native `respond_ui` result schema.
Up to sixteen cancellation requests and one coalesced abort have separate capacity;
duplicate cancellation attempts share the existing request. A held answer reply
cannot delay cancellation, expiry or abort. Invalid native replies release answer
capacity without renewing the interaction deadline. The original native result is
returned unchanged even when its acknowledgement arrives after the Host deadline
or an earlier cancellation notice. The monotonic deadline check also covers an
answer reaching the Host before its already-due timer callback: it requests native
expiry cancellation and returns that native result, rather than inventing expiry.

The diagnostics and interactions servers share only the bounded public DSH
`$events` carrier (eight peers, one stream per peer, 16-KiB frames, cancellation,
slow-viewer failure and disposal). Their route whitelists, payload validators and
S0 authorization/admission remain explicit. Diagnostics, interactions and catalog
share package/input/asset identity collection; each build still verifies its actual
resolved DSH source against the complete declared candidate before bundling.

Future Broker #47 can enforce a shorter policy or Stop. This slice does not claim
durable delivery, authentication, global installation or product admission.

The normal carrier reuses BoundedStdioTransport/StdioWriteQueue: independent
startup, negotiated framing, strict command policy, bounded queue/correlation,
serialized write/flush, expired-send suppression, stderr limits and actual exit/drain.
Known EOF notifications validate while retired generations fence delivery. Raw
cross-family fault frames occur only in the guarded native client test.

## Reproduce

Use Bun 1.4.4. This checkout reuses the canonical reviewed DSH candidate at
/workspace/work/omp-webui-ticket-39-final-fix/vendor/dsh-final read-only. Its
declared-patch source gate must pass before building. OMP source and
runtime dependencies are owned ignored outputs. Before native imports, use a
synthetic HOME/profile/XDG/TMPDIR and an allowlisted environment.

```sh
bun run compat:prepare --reset
bun run compat:build
bun scripts/build-compatibility.ts --check
bun run interactions:build
bun run interactions:fixture
# http://127.0.0.1:3183 — S0 isolated label; product APIs return 501
bun test tests/interactions
bun scripts/check-interactions-native.ts
BUN_EXECUTABLE=/absolute/path/to/bun python3 scripts/trace-interactions.py
python3 tests/browser/interactions-browser.py --bun /absolute/path/to/bun
python3 tests/browser/interactions-browser.py --bun /absolute/path/to/bun \
  --port 3184 --wait-ms 4000 --evidence vendor/interactions-browser-configured
```

Native tests need local stdio socketpairs; browser tests need loopback. Child
preload tests/interactions/no-provider.ts runs before OMP imports and denies
audited fetch/preconnect, WebSocket, Bun, Node TCP/TLS/HTTP/HTTP2 and datagram
entrypoints. Only synthetic-HOME Unix sockets are permitted. Initial verified
OpenAI selection avoids Anthropic's credentialless HEAD prewarm branch. No real
inference occurs. The SDK test selects an explicitly registered public in-process
literal-message provider after bootstrap; this is a controlled provider boundary,
not real model evidence. Three blocked metadata fetch attempts per observed native
client are recorded separately from independent zero-INET syscall proof.

Controlled clocks, real workers, actual SDK builtin execution, network trace and
Linux browser/exit results are separate in
[the evidence record](../docs/evidence/ticket-33-interactions.md).
