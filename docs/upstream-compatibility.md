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

### RPC facts verified

- RPC is newline-delimited JSON over stdin/stdout; it is not JSON-RPC 2.0.
- `ready` advertises protocol versions. The reviewed server supports v1 and v2; clients should negotiate v2.
- Physical JSONL frames are capped at 1 MiB. Protocol v2 can reassemble logical frames up to 64 MiB through validated `rpc_chunk` frames.
- Requests accept IDs and responses must be correlated by ID; responses can arrive out of order for concurrent commands.
- `prompt` acknowledgement is separate from `prompt_result`; `session_settled` is the quiescence signal.
- `--mode rpc-ui` enables the interactive tool UI context, including `ask` and supported Extension UI dialogs. The normal WebUI worker must not use `--no-ui`.
- Session commands include new/open/switch, history/tree reads, fork, branch, navigate, labels, and paged messages.
- Subagent subscriptions, progress/events, transcript reads, cancellation, and steering are available.
- BTW has dedicated `btw`, `btw_cancel`, and `get_btw_history` commands plus `btw_delta` and `btw_record` frames.
- Automatic retry can be configured or aborted. This is not equivalent to a manual mid-loop retry command.
- The RPC command set does not currently provide a global read-only Session catalog.

### Important implementation caveat

The current TypeScript `RpcClient` is a useful protocol reference and includes framing, request correlation, and many convenience methods. However, the reviewed public surface does not provide a general public API for receiving and answering all `rpc-ui` Extension UI requests, and its default startup mode is `rpc`.

Do not reach into its private fields or methods. Either:

1. use a future upstream public client API that exposes `rpc-ui` mode and Extension UI request/response handling; or
2. implement a small local JSONL transport from the public wire schema, with explicit protocol conformance tests.

The second option remains RPC-only; it must not import OMP Agent Runtime internals.

## DeepSeek Harness

- Repository: https://github.com/deepseek-ai/deepseek-harness
- Reviewed ref: `master`
- Commit: `39163dd30f703a79079e2d2446545cff3c453738`
- Version: `0.2.2-rc.3`
- Web app bundle: `@deepseek-ai/dsh-web-app`
- Session Controller: `@deepseek-ai/dsh-api-session-controller`
- Gateway: `@deepseek-ai/dsh-api-gateway`
- Connection: `@deepseek-ai/dsh-client-connection`
- Build requirements from the root package: Node.js `>=24.9.0`, pnpm `11.28.5`

### DSH Remote facts verified

The current DSH browser client uses a generic Connection transport for unary Remote calls and a Gateway-owned WebSocket mux for Remote streams.

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
