# Architecture

## 1. Purpose

OMP WebUI provides a browser-first interface for Oh-My-Pi while preserving OMP as the only Agent Runtime.

The Host reuses the DSH Web Client and implements the DSH Remote/Connection contract expected by that client. It starts and supervises OMP RPC workers and projects OMP's native session state into the DSH browser model.

This is not an SDK embedding project and not a fork of the OMP Agent Runtime.

## 2. System context

~~~mermaid
flowchart TB
  Browser["Browser"]
  Client["Pinned DSH Web Client"]
  Host["OMP Web Host<br/>Bun + TypeScript"]
  Gateway["DSH Connection / Remote Gateway"]
  Registry["Session Registry"]
  Supervisor["RPC Process Supervisor"]
  Projection["Event Projection / Replay"]
  Broker["Interaction Broker"]
  W1["OMP RPC Worker A<br/>rpc-ui · JSONL v2"]
  W2["OMP RPC Worker B<br/>rpc-ui · JSONL v2"]
  OMPStore[("OMP native session storage")]

  Browser --> Client
  Client <-->|"DSH Remote calls and streams"| Gateway
  Gateway --> Registry
  Registry --> Supervisor
  Registry --> Projection
  Registry --> Broker
  Supervisor <-->|"stdin / stdout / stderr"| W1
  Supervisor <-->|"stdin / stdout / stderr"| W2
  W1 --> OMPStore
  W2 --> OMPStore
~~~

## 3. Responsibility boundaries

### 3.1 DSH Web Client

- Owns the browser UI, layout, Conversation rendering, tool cards, settings shell, theme, and client-side stores.
- Is built from an exact DSH upstream commit.
- Is served as static assets by the Host.
- Receives only the DSH Connection and Remote protocol it already understands.
- OMP-specific features are added as small DSH client modules/slots, not by forking core Conversation UI unless an upstream extension point is insufficient.

The upstream DSH checkout and generated assets live under ignored `vendor/`. They are not copied into this repository.

Select the latest official published DSH release, including prereleases, then lock its exact tag and commit
in `upstreams.lock.json`. The current pin is `dsh-v0.2.2-rc.3` at
`38a6a5c965aa99ab525161efb7cc5cf1fe62fced`; builds use that SHA rather than floating `master` or npm `latest`.

### 3.2 OMP Web Host

The Host is a single-user local application initially. It owns:

- HTTP and WebSocket carriers.
- DSH Connection envelopes, Remote dispatch, stream multiplexing, and static asset serving.
- Authentication and request-origin checks.
- Session catalog and viewer/owner attachment state.
- OMP worker lifecycle, process supervision, and resource limits.
- OMP RPC framing, command correlation, event ingestion, and UI interaction responses.
- The projection from OMP's native history/events into the DSH Session contract.

The Host does not execute model calls or tools itself.

### 3.3 OMP Runtime workers

OMP runs as a child process. The intended command is `omp --mode rpc-ui` with validated arguments and an explicit working directory.

The Host communicates only through OMP's public RPC protocol:

- stdin: newline-delimited JSON commands and UI/tool/URI responses.
- stdout: ready, response, Agent/session events, extension UI requests, host-tool/URI requests, and other documented frames.
- stderr: diagnostics only.

The Host must never parse human-oriented terminal output from stdout.

### 3.4 Durable state

OMP remains the source of truth for:

- Session identity and persistence.
- Message and tool history.
- Branch tree, current leaf, rewind, and fork.
- Agent execution and tool state.
- Subagent lifecycle and transcripts.
- OMP settings and provider credentials.

Host memory may hold worker handles, pending requests, stream subscribers, and derived projections. Any persistent Host-owned data must be explicitly limited to WebUI preferences or metadata; it must not become a second transcript store.

## 4. Runtime and process topology

### 4.1 Worker cardinality

The initial concurrency model is one supervised RPC worker per concurrently active top-level OMP Session.

- Multiple browser tabs viewing the same Session attach to the same Host-owned worker.
- Different active Sessions may have independent workers and progress concurrently.
- Subagents remain children of their parent OMP worker and use OMP's native subagent RPC commands/events.
- A cold Session has no worker until it is opened or activated.

This is a logical ownership rule, not permission to create duplicate OMP writers. Before opening a Session, the Host must detect ownership conflicts and let OMP acquire its native Session lease. The RPC `get_session_lease` command is a probe; it is not a lease reservation API.

If another TUI or Host already owns a Session, the Host must not force-open it. Return a stable conflict or provide a read-only path where available.

### 4.2 Worker lifecycle

A worker has explicit states:

- `starting`: child spawned; waiting for `ready` and protocol negotiation.
- `attaching`: opening or restoring the requested Session.
- `active`: attached and accepting commands.
- `busy`: a Prompt or asynchronous Agent work is in progress.
- `idle`: `session_settled` observed.
- `stopping`: graceful shutdown requested.
- `failed`: process or protocol failure; recovery is required.

Worker shutdown must drain or reject pending requests, settle UI interactions, close streams, and reap the child. Host shutdown must not leave orphaned OMP processes.

### 4.3 Prompt lifecycle

Do not conflate these OMP signals:

- The `prompt` response acknowledges admission; it does not mean the model run completed.
- `prompt_result` reports the outcome of a particular accepted Prompt and is correlated by its request ID.
- `agent_end` marks an Agent turn boundary, but can be non-terminal.
- `session_settled` means the Session is quiescent, including background work that may wake the Agent later.

The UI should render these states separately.

Exception: a synchronous builtin slash command may complete in the successful `prompt` response with
`data.agentInvoked: false`; no `prompt_result` follows. Every other accepted prompt completes through
its correlated `prompt_result`. Its `sessionSettled` field, or a later `session_settled`, determines quiescence.

## 5. Protocol boundaries

### 5.1 Browser to Host: DSH Connection and Remote

The Host must implement the current DSH browser protocol, not a newly invented equivalent.

At the reviewed DSH baseline:

- Unary Remote calls are carried through the Connection HTTP channel using the `client-request` / `server-response` envelope and request correlation ID.
- Remote streams are owned by the DSH Gateway and carried through its WebSocket stream mux.
- Binary attachment paths have explicit transport handling; they must not be silently coerced into plain JSON.
- The Session Controller exposes list/search/create/rename/fork/prompt/attachment/updateQueue/cancel, history page/events, state, follow, projection, and control surfaces.
- `session.follow` opens with a snapshot containing Session header, cursor, history records, `hasMore`, projections, and an optional assistant-stream baseline. Later frames carry durable events and assistant-stream updates.
- DSH Session wire events carry sequence, time, data, and optional surface replacement/source metadata.

The DSH protocol is not "REST plus an arbitrary WebSocket". The implementation must follow the pinned Connection, Typert Remote, Gateway stream, and Session contracts. See [upstream compatibility](upstream-compatibility.md).

For the `/api` channel, browser unary calls use POST to `/api/<endpoint>` with `rpcId`, `method`, and
`payload`; the current client resolves document-relative routes, so deployment prefixes require testing.
The stream carrier is `/api/remote.mux`. The Gateway's `$events` logical stream opens with a `ready`
item carrying `clientId` and Host facts, establishing a Client generation. Forwarded waterfall results
use `$events/result` and an `eventId`; Broker routing must retain both generation and correlation.
DSH's `ready` is unrelated to OMP's stdio `ready`.

### 5.2 Host to OMP: public RPC

- Start `omp --mode rpc-ui`; do not use plain `rpc` for the normal interactive WebUI.
- Do not pass `--no-ui` in the normal mode. The `rpc-ui` mode enables the tool UI context required for interactive dialogs such as `ask`.
- Wait for `ready`, validate the advertised protocol versions, and negotiate protocol v2 when available.
- Reassemble `rpc_chunk` frames with strict validation and the advertised size ceiling.
- Correlate every command response by ID; concurrent commands may complete out of order.
- Process stdout continuously, even while no browser is attached. Drain stderr separately.
- Route `extension_ui_request` frames to the Interaction Broker and send `extension_ui_response` frames back to the same worker.
- Treat host-tool and host-URI requests as separate sub-protocols; these are not ordinary UI dialogs.

The current OMP TypeScript `RpcClient` is useful reference code. It defaults to `--mode rpc` (its custom `spawn` override can supply `rpc-ui` argv), but its public API does not expose a general interface for receiving and answering all Extension UI requests. Do not reach into its private members. The implementation must either use a future public OMP client API or own a small, schema-backed JSONL transport. The latter must remain a protocol client, not an Agent SDK integration.

Use the public `RpcFrameDecoder` at `@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame` for framing;
the package's `./modes/rpc/*` export also covers `rpc-client` and `rpc-types`.
The upstream `src/modes/rpc/wire/rpc-wire.schema.json` is a JSON Schema 2020-12 bundle with an
`x-rpc` command table and stdout/inbound frame unions; generated TypeScript is beside it.
Reuse these public wire/schema/client capabilities rather than inventing a second command schema
or copying the old omp-web SDK Driver. M0 does not yet import the package; installed export resolution
and native dependencies remain integration checks.

`--no-ui` disables extension UI in both RPC modes. Although `rpc-ui --no-ui` retains tool dialogs,
tools requiring approval fail closed without the extension UI. MCP authentication challenges do not
gain an RPC UI handler in either mode. Native `ask` UI frames require `set_ask_dialog` opt-in;
the tool ask flow and extension askDialog are distinct. Unsupported interactions must fail explicitly,
never default to approval. Validate startup dialogs before marking a worker ready for browser commands.

## 6. Core Host components

### 6.1 DSH Compatibility Gateway

Responsibilities:

- Serve the pinned DSH Web Client and plugin bundles.
- Implement DSH unary Connection requests and Remote method dispatch.
- Implement Gateway WebSocket stream multiplexing and cancellation.
- Preserve DSH request/response envelopes, typed failures, and binary attachment behavior.
- Enforce per-request authorization and origin policy.

Only the DSH methods needed by the selected client module roster should be implemented initially. The roster and supported methods must be documented and tested together.

### 6.2 RPC Process Supervisor

Responsibilities:

- Spawn OMP with an argument array; never invoke a shell command assembled from user input.
- Negotiate RPC v2 and own the stdout frame decoder.
- Correlate requests, timeouts, cancellations, and late responses.
- Keep stdout protocol-only and stderr diagnostic-only.
- Enforce worker limits, restart policy, graceful shutdown, and child cleanup.
- Expose a narrow worker interface to Session Registry and Interaction Broker.

### 6.3 Session Registry and Catalog

The Registry maps a stable OMP Session identity to its worker, lifecycle state, active viewers, and projection generation.

A significant upstream gap exists: the current per-session OMP RPC protocol does not provide a global read-only Session Catalog equivalent to DSH's `session.list` and `workspace.list`. `get_session_lease` only probes lease ownership; it does not enumerate Sessions.

To preserve the RPC-only boundary, the Host must not scan or parse OMP session directories. Add an additive public OMP RPC catalog command (paged, read-only, and returning stable Session IDs plus cwd/title/timestamps/parent metadata) before implementing the complete DSH workspace/session sidebar.

### 6.4 Event Projection and Replay

OMP history is tree-shaped. DSH Conversation consumes an ordered event journal with snapshots, cursors, projections, and live assistant-stream frames.

The projection layer must:

1. Read OMP durable entries and the current tree/leaf through public RPC.
2. Preserve OMP entry IDs as stable source identities.
3. Project only the active root-to-leaf branch into the Conversation surface.
4. Preserve the full branch tree for the OMP History extension.
5. Map OMP live assistant updates to DSH transient assistant-stream frames, then settle them against the durable committed entry.
6. Reconcile buffered live events against the opening history snapshot to avoid gaps and duplicates.
7. Express branch changes as a DSH-compatible replacement/rebaseline, not by appending abandoned-branch messages.
8. Rebuild all derived state after worker restart; never treat the projection cache as durable truth.

Do not assume OMP entry order is the active conversation path. Do not invent a DSH sequence from wall-clock timestamps. The exact cursor and replacement algorithm is an M0/M1 design gate and must be covered by fixtures for normal turns, tool batches, rewind, fork, compaction, and reconnect.

### 6.5 Interaction Broker

The Broker owns pending OMP Extension UI requests and their browser-side dialogs.

It must support request correlation, response validation, timeout, cancellation, session switching, browser disconnect, and worker shutdown. A pending `select`, `confirm`, `input`, `editor`, `ask`, or `cancel` interaction must not leave a tool or Agent turn permanently suspended.

The Broker also separates Extension UI from host-tool and host-URI requests. These have different schemas and security boundaries.

An answer belongs to an authorized Session, worker generation, OMP UI request ID, and DSH event
generation/ID. Enforce at-most-once answers; stale replies and disconnections must not imply consent.

### 6.6 OMP-specific DSH client extensions

Use DSH client module/slot extension points for OMP-only capabilities such as:

- BTW history and live side-question output.
- Full OMP Session tree, labels, rewind, and fork.
- Subagent controls and transcript views.
- OMP settings and provider credential management.
- Manual retry through the public `prompt` route with `/retry`, subject to native preconditions
  and explicit user action; retry may execute failed tools again.

Do not rename or reinterpret DSH tool cards when their underlying semantics differ.

## 7. Capability gaps and extension policy

At the reviewed OMP baseline, the following are already available through RPC: prompt/steer/follow-up, abort, model and thinking selection, message/history/tree reads, branch/fork/navigation, subagent subscription/control, BTW and BTW history, automatic retry configuration, and Extension UI requests in `rpc-ui`.

Known gaps or caveats:

- Global Session enumeration is not exposed as a public RPC catalog.
- `abort_retry` stops an automatic retry; it is not the same as a manual mid-loop retry command.
- Manual `/retry` is already reachable through public `prompt` slash dispatch. A dedicated wire command
  is not required, but it cannot repair every crash. `/rewind` has only a TUI selector; public `branch`
  and `navigate_tree` provide distinct history operations. See [compatibility notes](upstream-compatibility.md).
- Dedicated RPC state transitions for every TUI-only mode (for example, all Plan/Vibe behavior) are not guaranteed.
- Some terminal-only extension presentation features have no browser equivalent.
- MCP authentication flows may have limitations in RPC UI mode.

When a feature is missing, add or propose a public OMP RPC command/event. Do not solve the gap by importing internal Agent objects into the Host.

## 8. Security model

Initial deployment is local and single-user:

- Bind to `127.0.0.1` by default.
- Keep remote binding disabled until authentication, Host/Origin validation, WebSocket admission, and CSRF protections are implemented.
- Use a random launch token and secure session cookie before serving private Session data.
- Validate every Session ID, workspace path, attachment ID, and RPC operation against the authenticated owner scope.
- Do not expose arbitrary process spawning or raw OMP RPC to the browser.
- Bound request bodies, attachments, event buffers, output queues, worker count, and per-session resource use.
- Use explicit environment allowlists for workers; redact credentials and prompt content from logs.

The health-only scaffold intentionally has no application API and is not a remotely deployable service.

Loopback is not authentication, and RPC is not a sandbox: OMP extensions and tools retain the Host
user's privileges. Treat model/tool output and UI requests as untrusted data, sanitize rendered content,
and apply a separate policy to external actions such as `open_url`. Browser input cannot select arbitrary
executables, argv, environment, or host filesystem paths. Normalize authorized workspace paths and
check symlink boundaries. Drain stdout after closing stdin, bound output queues and frame reassembly,
and never automatically replay side-effecting prompts after a worker crash.

## 9. Persistence policy

MVP state is in memory plus OMP-native persistence. A small atomic JSON or SQLite store may later hold WebUI-only preferences such as workspace ordering or per-browser layout.

Do not copy OMP transcripts, messages, branch trees, credentials, or Agent state into SQLite. Any cache must be disposable and reconstructible from OMP RPC.

## 10. Runtime and build toolchain

- Host runtime: Bun `>=1.4.4`.
- Language: strict TypeScript.
- HTTP/WebSocket carrier: `Bun.serve`; avoid a framework until routing needs justify one.
- OMP process: `Bun.spawn` or an equivalent process adapter using argv arrays and piped stdio.
- Tests: `bun test`; browser acceptance: Playwright.
- DSH client build only: Node.js `>=24.9.0` and pnpm `11.28.5`, matching the pinned DSH repository baseline.
- DSH source and build outputs are generated under ignored `vendor/`.

The checked-in `bun.lock` pins development tooling; no upstream Agent or DSH runtime is installed.
DSH source `0.2.2-rc.3` differs from npm Web frontend/client latest versions; select and verify a matching
artifact set before distributing the UI, preserving upstream licenses and third-party notices.

## 11. M0 exit criteria

M0 is complete only when all of the following are demonstrated:

1. The pinned DSH browser bundle can be built and served without starting DSH's Agent Host.
2. A minimal Bun Host can satisfy the DSH Connection handshake and a harmless Remote request.
3. A browser stream can open through the DSH Gateway WebSocket mux and close/cancel correctly.
4. The Host can start a real OMP `rpc-ui` worker, negotiate RPC v2, and complete a command round trip.
5. The Host can receive an Extension UI request and return a validated response without using OMP SDK internals.
6. The Session Catalog gap and the required upstream OMP RPC change are resolved or explicitly scoped out of the first UI slice.
7. The event projection design has fixtures proving active-branch correctness and replay reconciliation.

Until then, the project remains a scaffold, not a usable OMP WebUI.
