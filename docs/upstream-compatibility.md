# Upstream compatibility baseline

This document records the exact upstream revisions inspected for the initial architecture. The machine-readable pins are in [upstreams.lock.json](../upstreams.lock.json).

## Oh-My-Pi

- Repository: https://github.com/can1357/oh-my-pi
- Reviewed ref: `main`
- Commit: `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`
- Version: `18.20.2`
- RPC reference: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/docs/rpc.md
- RPC types: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-types.ts
- RPC frame implementation: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-frame.ts
- Wire schema: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/wire/rpc-wire.schema.json
- Public export map: https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/package.json
- Latest GitHub release and npm coding-agent version checked on 2026-11-15: `v18.20.2` / `18.20.2`.

### RPC facts verified

- RPC is newline-delimited JSON over stdin/stdout; it is not JSON-RPC 2.0.
- `ready` advertises protocol versions. The reviewed server supports v1 and v2; clients should negotiate v2.
- Physical JSONL frames are capped at 1 MiB. Protocol v2 can reassemble logical frames up to 64 MiB through validated `rpc_chunk` frames.
- Requests accept IDs and responses must be correlated by ID; responses can arrive out of order for concurrent commands.
- A synchronous builtin slash command can complete in its success response with `data.agentInvoked: false` and no later `prompt_result`. Other accepted prompts complete through a correlated `prompt_result`; its `sessionSettled` or a later `session_settled` determines quiescence.
- `--mode rpc-ui` enables the interactive tool UI context, including `ask` and supported Extension UI dialogs. The normal WebUI worker must not use `--no-ui`.
- Session commands include new/open/switch, history/tree reads, fork, branch, navigate, labels, and paged messages.
- Subagent subscriptions, progress/events, transcript reads, cancellation, and steering are available.
- BTW has dedicated `btw`, `btw_cancel`, and `get_btw_history` commands plus `btw_delta` and `btw_record` frames.
- Automatic retry can be configured or aborted. Manual `/retry` is separately reachable through
  the public `prompt` slash dispatcher; neither `abort_retry` nor resending a prompt is equivalent.
- The RPC command set does not currently provide a global read-only Session catalog.

### Interaction and Stop compatibility

The accepted [Interaction lifecycle contract](interaction-lifecycle-contract.md) requires explicit
answers and expiry-as-cancellation. Pinned native asks may instead submit recommended/first answers;
the tool ask fallback can reinterpret near-deadline cancellation as timeout and return default form data.
`set_ask_dialog` changes presentation availability, not those semantics. An earlier Host timer cannot
guarantee it beats a server timer started before delivery. A public, verifiable server guarantee covering
both paths is therefore a delivery gate; no new method name or completed extension is claimed here.

During extension initialization only UI responses and ask opt-in bypass queued commands. Stop must
cancel known startup UI before relying on abort, and may need owned-worker teardown. Branch summaries
have `abort_branch_summary`; generic abort cannot overtake the same pending navigation. Queue-restoring
abort can report `imagesDropped`/`truncated`; native `isSettled` excludes some pending UI/operations.
The Host must combine native settlement with its own operation/Interaction state and test actual
process teardown. Source links and acceptance cases are in the lifecycle contract; no live UI test passed yet.

### Important implementation caveat

The current TypeScript `RpcClient` is a useful protocol reference and includes framing, request correlation, and many convenience methods. However, the reviewed public surface does not provide a general public API for receiving and answering all `rpc-ui` Extension UI requests, and its default startup mode is `rpc`.

Do not reach into its private fields or methods. [ADR 0004](adr/0004-local-public-rpc-transport.md)
selects a small local Bun JSONL transport using public framing/wire/schema capabilities, with explicit
conformance and failure tests. It remains RPC-only and does not import Agent Runtime internals.
A future public client can replace it only after satisfying the same [transport contract](rpc-client-contract.md).

The public `./modes/rpc/*` exports include `RpcClient`, `RpcFrameDecoder`, and RPC types. Prefer the
upstream decoder and wire/schema capabilities for the local transport. A command builder as well as
custom spawn can choose controlled `rpc-ui` argv, but neither provides the missing general UI API.
The health-only product scaffold still imports none of these modules. Isolated Linux x64 probes of
the published 18.20.2 package under Bun 1.4.4 verified decoder imports and a 1,200,097-byte synthetic
object round trip through five v2 chunks. Five malformed-input cases also passed; full decoder and
transport conformance remain untested. Type modules resolve and erase to empty runtime namespaces;
no project-level TypeScript check against those declarations was performed.

The JSON schema asset matches the pinned source but its package JSON subpath does not resolve.
The public `@oh-my-pi/pi-coding-agent/modes/rpc/wire/index` module exports `buildRpcWireBundle()`;
its generated bundle matched the published schema. Use this pinned generator as a build input,
then generate and test boundary validators while preserving the schema's extension metadata.
Neither the generator nor the type exports is an already implemented runtime validator.

Only resolution was tested for `rpc-client`. Its static import closure reaches eager configuration
reads and native initialization, so its runtime import was not executed within this experiment's
no-user-configuration boundary. Installed native assets do not establish native ABI or CLI support.
Evidence is recorded in [OMP 公共 RPC 模块分发：锁定包导出与 Bun 加载实证](https://github.com/HowBoring/omp-webui/issues/26).

### Manual recovery and ownership recheck

The fixed RPC mode dispatches text-capable builtins, so `prompt` with `message: "/retry"` can invoke
OMP's native retry handler. Retry has state-dependent refusal conditions and can replay some complete,
failed tool batches; it is not a side-effect-free model request or a universal crash-repair command.
See the pinned [RPC dispatch](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1940-L2009)
and [retry handler](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/slash-commands/builtin-lifecycle.ts#L545-L578).

`/rewind` is an alias of the TUI-only branch selector, not an RPC text builtin. Sending that literal
through prompt is not a rewind API. Public `branch(entryId)` creates a new Session; `navigate_tree(entryId)`
changes the current Session's leaf. Neither reverses filesystem or external tool side effects.
See the [builtin registry](https://github.com/can1357/oh-my-pi/blob/7c49c11aa5bbaf3f418406583096168ad5b8c6dc/packages/coding-agent/src/slash-commands/builtin-session.ts#L631-L688).

Some interrupted-turn recovery needs `--restore`, which is currently TUI-only. Ordinary cold resume
and an available `/retry` route do not establish that every crash outcome can be repaired over RPC.
Likewise, reattaching a browser to a Host-owned worker differs from transferring another live process's
writer ownership. The public lease probe neither identifies the owner nor transfers or reserves its claim.
The [takeover feasibility research](https://github.com/HowBoring/omp-webui/issues/13) records the precise
source boundaries and proposed validation. The selected product policy is recorded in
[ADR 0003](adr/0003-session-discovery-and-registration.md) and the [catalog contract](session-catalog-contract.md).

## DeepSeek Harness

- Repository: https://github.com/deepseek-ai/deepseek-harness
- Reviewed ref: `dsh-v0.2.2-rc.3`
- Commit: `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`
- Version: `0.2.2-rc.3`
- Web frontend artifact entry: `@deepseek-ai/dsh-web-frontend` (`apps/web`)
- Web Client boot kernel: `@deepseek-ai/dsh-client-web` (`packages/client/web`)
- Session Controller: `@deepseek-ai/dsh-api-session-controller`
- Gateway: `@deepseek-ai/dsh-api-gateway`
- Connection: `@deepseek-ai/dsh-client-connection`
- Build requirements from the root package: Node.js `>=24.9.0`, pnpm `11.28.5`

The latest GitHub prerelease checked on 2026-11-15 is `dsh-v0.2.2-rc.3` (not a stable release).
It is the selected latest official release, including prereleases. Its tag resolves to the exact commit
above, which replaces the previous post-release `master` review baseline. Builds must use the locked
commit, not resolve a moving branch or dist-tag. Upgrades require an explicit lock update and contract review.
Source package versions differ from npm dist-tags: npm latest is `0.0.1-rc.5` for the Web frontend
and `0.0.1-rc.1` for client-web. Do not assume `0.2.2-rc.3` is installable from npm or mix these
artifacts without testing. Pin a matched upstream build and its dependency/asset closure before UI integration.

Pinned source references:

- [Connection](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/connection/README.md)
- [Unary transport](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/client/connection/src/client/rpc.ts)
- [Gateway](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/gateway/README.md)
- [Stream and event protocol](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/gateway/src/stream-protocol.ts)
- [Remote resource access](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/remote-access/README.md)
- [Session Controller](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/api/session-controller/README.md)

The release's Connection owns browser launch-token/Cookie authentication. Do not assume the later
`master` authentication-provider split exists in this release. The selected release's unary envelopes,
mux/event framing, Session Controller and resource-access contracts were rechecked after repinning.

### DSH Remote facts verified

The current DSH browser client uses a generic Connection transport for unary Remote calls and a Gateway-owned WebSocket mux for Remote streams.

Browser unary calls carry `client-request`, `rpcId`, `method`, and `payload` to `/api/<endpoint>`.
Streams use `/api/remote.mux`, including the `$events` stream whose opening ready item creates a
Client generation. Waterfall results use `$events/result` with generation and event correlation.
Identity authentication, Host/Origin source trust, and per-resource Remote authorization are separate boundaries.

Stock Gateway broadcasts pending waterfalls to answering owner clients; the first result/rejection
settles the transport invocation. Disconnect leaves it pending; reconnect assigns a new clientId and
replays the same pending eventId. This does not validate OMP answers or enforce per-credential revocation
for our Host. `userQuestions.attachWait` has multiple claims; `userQuestions.answer` handles continued
questions through Inbox. The Broker must implement the accepted lifecycle policy over those real contracts.

The Session Controller exposes, among other methods:

- Session list/search/create/rename/fork.
- Model catalog and Session-local model selection.
- Prompt, attachment, queue update, and cancel.
- Event/history page reads and event observation.
- Session state, state observation, and wait.
- `follow`, projection reads/observation, and host-wide control stream.

A `session.follow` opening snapshot includes the Session header, event cursor, history records, `hasMore`, projection baseline, and optional assistant-stream baseline. Later frames carry durable event records or assistant-stream notifications.

The DSH Session wire event has a sequence, timestamp, data payload, and optional surface replacement/source metadata. The Conversation client therefore consumes more than a plain array of chat messages.

### Adapter implication

The Host must implement the DSH Connection envelope, Remote method contract, Gateway stream carrier, cancellation, and Session snapshot/event semantics expected by the pinned browser modules. A custom REST API or a raw WebSocket event feed is not compatible by itself.

## Prior art

`https://github.com/LaneSun/omp-web` is useful prior art for the DSH client boot process, OMP feature mapping, and browser acceptance cases. It is not a runtime dependency and no old SDK-based Driver is copied into this scaffold. Its DSH baseline predates the current DSH Remote/Session stream contract; re-check all code and assumptions against the pins above.
