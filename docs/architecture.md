# Architecture

## 1. Purpose

OMP WebUI provides a browser-first interface for Oh-My-Pi while preserving OMP as the only Agent Runtime.

The Host reuses the DSH Web Client and implements the DSH Remote/Connection contract expected by that client. It starts and supervises OMP RPC workers and projects OMP's native session state into the DSH browser model.

This is not an SDK embedding project and not a fork of the OMP Agent Runtime.

The [OMP WebUI 可用 MVP：原生会话发现与历史导航决策地图](https://github.com/HowBoring/omp-webui/issues/14) and
[scope ADR](adr/0002-native-session-mvp.md) include native TUI Session discovery/import and core history
navigation. They record product requirements, not completed integration.

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

[ADR 0005](adr/0005-dsh-client-composition.md) selects the tested DSH service foundation with small
OMP catalog/history modules and a minimal public navigation/action policy seam. Stock restore and
Workspace selection can request Session creation, and some keyboard routes bypass menu checks.
Presentation-only slot replacement is insufficient. The seam must be proven before product integration;
record its base commit and patch/build identity separately. The original 28-plugin startup experiment
does not validate the modified composition. See the [client contract](client-composition.md).

New image/file input is part of the usable MVP. Session-local model/thinking selection and WebUI-only
appearance/language preferences are included; provider, credential and plugin administration is deferred.
The [attachment contract](attachment-contract.md) records original retention, byte ownership and history
retrieval targets, with complete preparation before prompt admission and explicit acceptance of degradation.
Native submission/persistence evidence, preparation/consumption and public draft recovery are implemented in
the stock product shell; `tests/product/product-flow.py` verifies prepared `fileMention`/inline-image
submission, per-tab draft reload, unsupported-file refusal without blocking a valid send, and byte-exact
Originals after history reopen. Retained images are still shown as native text placeholders rather than
inline `<img>` history rendering.

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
- Exact attachment originals, minimal native-entry associations, quotas and deletion, as specified in the
  [attachment contract](attachment-contract.md); these do not duplicate native conversation history.

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

Host memory may hold worker handles, pending requests, stream subscribers and derived projections.
Approved persistent Host data is limited to WebUI preferences, browser authorization, directory grants,
the Session reference index, and attachment originals with necessary associations. Browser draft recovery
uses the per-tab policy in the [attachment contract](attachment-contract.md). These stores do not copy
native messages, tool history or the Session Tree; OMP remains their durable authority.

## 4. Runtime and process topology

### 4.1 Worker cardinality

The initial concurrency model is one supervised RPC worker per concurrently active top-level OMP Session.

- Multiple browser tabs viewing the same Session attach to the same Host-owned worker.
- The usable MVP permits one active top-level worker at a time; its catalog can list many Workspaces and Sessions.
- Independent workers for concurrent Sessions remain a later extension of this ownership model.
- Subagents remain children of their parent OMP worker and use OMP's native subagent RPC commands/events.
- A cold Session has no worker until it is opened or activated.

This is a logical ownership rule, not permission to create duplicate OMP writers. Before opening a Session, the Host must detect ownership conflicts and let OMP acquire its native Session lease. The RPC `get_session_lease` command is a probe; it is not a lease reservation API.

If another TUI or Host already owns a Session, the Host must not force-open it. Return a stable conflict or provide a read-only path where available.
The MVP supports continuation after the previous process exits, not live writer transfer. A lease probe
neither identifies the owner nor reserves ownership; a sibling/continuation created on conflict must not
be presented as successful attachment to the original Session.

### 4.2 Worker lifecycle

A worker has explicit states:

- `starting`: child spawned; waiting for `ready` and protocol negotiation.
- `attaching`: opening or restoring the requested Session.
- `active`: attached and accepting commands.
- `busy`: a Prompt or asynchronous Agent work is in progress.
- `idle`: native settlement confirmed and no Host-tracked pending Interaction or busy operation.
- `stopping`: Stop or shutdown requested; completion/exit has not yet been confirmed.
- `failed`: process or protocol failure; recovery is required.

Worker shutdown must drain or reject pending requests, settle UI interactions, close streams, and reap the child. Host shutdown must not leave orphaned OMP processes.
The [Interaction lifecycle contract](interaction-lifecycle-contract.md) distinguishes ordinary Stop
from security termination and shutdown. Its timers govern escalation, not a fabricated guarantee that
the OS has completed exit. Startup and branch-summary work need their specific public cancellation paths.

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
Native settlement does not include every extension UI or branch-summary operation. Host admission
additionally checks its pending interactions/operations. The MVP rejects new prompt/steer/follow-up
input while busy; the user may keep editing drafts, answer UI or request Stop.

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

Per [ADR 0004](adr/0004-local-public-rpc-transport.md), the MVP owns a small Bun JSONL transport over
OMP's public protocol. The current TypeScript `RpcClient` remains reference code; its public UI,
prompt admission and graceful EOF/drain surfaces do not cover the required Host contract. Do not
reach into private members or add a second reader to the same worker's stdout. A future public
client replacement must satisfy the same [transport contract](rpc-client-contract.md) and tests.

Use the public `RpcFrameDecoder` at `@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame` for framing;
the package's `./modes/rpc/*` export also covers `rpc-client` and `rpc-types`.
The upstream `src/modes/rpc/wire/rpc-wire.schema.json` is a JSON Schema 2020-12 bundle with an
`x-rpc` command table and stdout/inbound frame unions; generated TypeScript is beside it.
Reuse these public wire/schema/client capabilities rather than inventing a second command schema
or copying the old omp-web SDK Driver. Published-package probes verified the public decoder, wire type
modules and `wire/index` schema generator under Bun 1.4.4; the JSON schema path itself is not a working
package import. Generate validation inputs through the public generator at build time, tied to the
worker version. Type-only wire modules are not runtime validators. The product scaffold still has no
OMP dependency or real worker integration; RpcClient's eager configuration/native imports were not executed.

`--no-ui` disables extension UI in both RPC modes. Although `rpc-ui --no-ui` retains tool dialogs,
tools requiring approval fail closed without the extension UI. MCP authentication challenges do not
gain an RPC UI handler in either mode. Native `ask` UI frames require `set_ask_dialog` opt-in;
the tool ask flow and extension askDialog are distinct. Unsupported interactions must fail explicitly,
never default to approval. Validate startup dialogs before marking a worker ready for browser commands.

### 5.3 Delivery and actual worker identity

[ADR 0008](adr/0008-public-rpc-delivery.md) selects an auditable public OMP compatibility build and
reuse of the global OMP installation, with one validated Host/OMP-build/schema combination. The
[delivery contract](rpc-delivery-contract.md) requires a controlled resolved launch target, its actual
runtime/dependency closure, matching generated schema and independent conformance evidence. There
is no hidden separately installed production worker or trust in arbitrary PATH/version output.

Current `ready` negotiates framing, not general build/schema identity; `get_available_commands` lists
slash commands. The new public guarantees must be verifiable before dependent operations/startup UI,
and a normal Session-opening worker is not a read-only capability probe. Unknown/mismatched delivery
blocks Session operations while only non-private health/diagnostics may remain. The compatibility
artifact is not yet delivered; upstream pins remain review baselines, not an approved runtime tuple.

Global installation updates couple WebUI and TUI maintenance. Upgrade the complete validated tuple;
rollback additionally requires compatibility with current native data, without Host Session-file edits.

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

The MVP must discover and import existing TUI Sessions and group them by working directory. To preserve
the RPC-only boundary, the Host must not scan or parse OMP session directories. This requires a public
OMP catalog capability before the complete sidebar can ship. The [catalog contract](session-catalog-contract.md)
records confirmed product choices and semantic targets; concrete public wire schemas, extension delivery
and validation remain pending. Proposed capabilities are not API names or existing wire fields.

Import registers a native Session reference; it does not copy its transcript or create a replacement
conversation. The persistent Host index retains registered references across restarts. Opening a Session
is a separate operation subject to native ownership and path validation. In the pinned implementation,
`switch_session` may create a new Session for a missing path; it is not a read-only existence check.

Per [ADR 0003](adr/0003-session-discovery-and-registration.md), the MVP discovers the startup-selected
OMP configuration's default source plus explicitly authorized custom directories. It displays candidates
without registering them; first open registers the reference before attempting continuation. Failed
continuation retains the registration and reason. Externally owned Sessions expose catalog metadata,
not history/tree browsing, until the previous owner exits. Missing/changed identities and ownership
conflicts require protected public operations; a lease probe alone does not provide that guarantee.

### 6.4 Event Projection and Replay

OMP history is tree-shaped. DSH Conversation consumes an ordered event journal with snapshots, cursors, projections, and live assistant-stream frames.

The projection layer must:

1. Read OMP entries and the current tree/leaf through public RPC, distinguishing observed memory from committed state.
2. Preserve scoped OMP entry identities and detect payload rewrites or deletions.
3. Project only the active root-to-leaf branch into the Conversation surface.
4. Preserve the full branch tree for the OMP History extension.
5. Map OMP live assistant updates to DSH transient assistant-stream frames, then settle them against the durable committed entry.
6. Reconcile buffered live events against the opening history snapshot to avoid gaps and duplicates.
7. Coordinate a new DSH projection generation when the visible branch changes; old records must not remain in Chat.
8. Rebuild all derived state after worker restart; never treat the projection cache as durable truth.

The accepted [projection contract](projection-contract.md) and [ADR 0010](adr/0010-native-history-projection.md)
retain readable older active-path history as folded segments, separate it from model context, and define
snapshot/live cuts, generation-scoped cursors and recovery limits. Source append order is not branch order;
DSH seq is not a timestamp or native ID. Current RPC lacks the required coherent observation/version and
complete live-to-entry/commit linkage. DSH surface replacement preserves human transcript originals, and
physical follow restart preserves the old journal window; neither provides the required branch reset.
A narrow public invalidation/rebuild seam must coordinate Chat, projections, assistant state and drafts.
Navigation success also requires a recoverable native position before another prompt or normal shutdown.
These are unimplemented delivery gates, with real failure/restart and multi-view fixtures required.

### 6.5 Interaction Broker

The Broker owns pending OMP Extension UI requests and their browser-side dialogs.

It must support request correlation, response validation, timeout, cancellation, session switching,
browser disconnect, and worker shutdown. `select`, `confirm`, `input`, `editor` and opt-in `ask` may
await answers; `cancel` is a notification targeting an existing UI id, not another question to answer.

The Broker also separates Extension UI from host-tool and host-URI requests. These have different schemas and security boundaries.

An answer belongs to an authorized Session, worker generation, OMP UI request ID, and DSH event
generation/ID. Enforce at-most-once answers; stale replies and disconnections must not imply consent.

[ADR 0007](adr/0007-interaction-lifecycle.md) and the [lifecycle contract](interaction-lifecycle-contract.md)
select first-valid-answer settlement across authorized pages, live pending-UI retention across ordinary
disconnects, a default 30-minute non-renewing Interaction deadline, and distinct Stop/revocation behavior.
An ordinary Stop offers explicit user-confirmed force termination after 30 seconds; revoke-all, lost
directory authorization and Host shutdown use 30-second cooperative/drain and 5-second termination
phases. Native timed asks can synthesize default answers, requiring a verified public server guarantee
before claiming strict expiry-as-cancellation. The Broker and this extension are unimplemented.

### 6.6 OMP-specific DSH client extensions

Use DSH client module/slot extension points for OMP-only capabilities such as:

- MVP: Session Tree viewing, same-Session history navigation through `navigate_tree`, and a new
  Branched Session through `branch` at a historical user-message point. `get_tree` supplies the tree;
  UI labels must distinguish navigation from creating a new conversation. Re-read authoritative state
  after each operation, handle native busy/cancellation rules, and do not automatically resubmit returned text.
- MVP: manual retry through the public `prompt` route with `/retry`, subject to native preconditions
  and explicit user action; retry may execute failed tools again.
- BTW history and live side-question output.
- Advanced tree editing/comparison and labels, beyond the core MVP history controls.
- Subagent controls and transcript views.
- OMP settings and provider credential management.

Do not rename or reinterpret DSH tool cards when their underlying semantics differ.
History navigation changes conversation context; it does not undo filesystem or external side effects.
The TUI `/tree` and `/rewind` selectors are not text handlers to send blindly through RPC.

The accepted [history interaction contract](history-interaction-contract.md) keeps selection separate
from mutation, previews and confirms both history actions, and leaves returned drafts unsent.
Running work must stop and reach verified quiescence before the user reinitiates navigation/branching;
an abort acknowledgement does not execute the pending action. Session identity and leaf are read back
before presenting the result. The prototype is a decision artifact, not runtime integration evidence.

## 7. Capability gaps and extension policy

At the reviewed OMP baseline, the following are already available through RPC: prompt/steer/follow-up, abort, model and thinking selection, message/history/tree reads, branch/fork/navigation, subagent subscription/control, BTW and BTW history, automatic retry configuration, and Extension UI requests in `rpc-ui`.

Known gaps or caveats:

- Global Session enumeration is not exposed as a public RPC catalog.
- Native/tool ask expiry may generate default answers or reinterpret cancellation as timeout. The
  accepted lifecycle policy needs an additive, publicly verifiable cancellation guarantee; a Host timer
  cannot eliminate the native race. Delivery joins the catalog/strict-continuation compatibility gate.
- Delivery follows the accepted public-compatibility/global-install policy above; actual extension
  schemas, artifacts, installation identity and runtime proofs are still implementation gates.
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
- Keep remote binding disabled for the MVP; loopback still requires authentication, Host/Origin validation, WebSocket admission and CSRF protection.
- Use a random launch token and appropriately scoped HttpOnly browser cookie before serving private Session data.
- Validate every Session ID, workspace path, attachment ID, and RPC operation against the authenticated owner scope.
- Do not expose arbitrary process spawning or raw OMP RPC to the browser.
- Bound request bodies, attachments, event buffers, output queues, worker count, and per-session resource use.
- Use explicit environment allowlists for workers; redact credentials and prompt content from logs.

[ADR 0006](adr/0006-persistent-local-browser-access.md) selects 30-day browser authorization across
Host restarts, with logout and global revocation, plus explicit persistent WebUI grants for canonical
working-directory roots and descendants. This does not expand the configured OMP Session discovery
sources. Uploads go only to dedicated staging, never a browser-selected project destination.
The [local access contract](local-access-contract.md) defines admission, lifecycle and required tests;
these are policy targets, not implemented security features.

The health-only scaffold intentionally has no application API and is not a remotely deployable service.

Loopback is not authentication, and RPC is not a sandbox: OMP extensions and tools retain the Host
user's privileges. Treat model/tool output and UI requests as untrusted data, sanitize rendered content,
and apply a separate policy to external actions such as `open_url`. Browser input cannot select arbitrary
executables, argv or environment. Directory candidates are accepted only by the authenticated, explicit
grant operation and validated server-side; ordinary requests use authorized identities and paths.
Normalize authorized workspace paths and check symlink boundaries. Drain stdout after closing stdin, bound output queues and frame reassembly,
and never automatically replay side-effecting prompts after a worker crash.

## 9. Persistence policy

The MVP persists a small Host-owned reference index for registered Workspaces and Sessions so the list
survives Host restart. Storage format and update/reconciliation rules remain open decisions. This index
may contain authorized native references and WebUI metadata, not a second conversation store.
Browser credential verification/revocation state and working-directory grants are separately persisted
as private Host-owned data. They are distinct from OMP provider credentials and transcript storage.
Worker handles, pending interactions and projections remain transient and must be rebuilt where the
public RPC contract permits. Crash recovery is manual; never replay prompts or tools automatically.

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
6. The Session Catalog gap and the required upstream OMP RPC change are specified. Native discovery/import
   is required for the usable MVP; a narrower M0 transport proof must not be labelled a usable MVP.
7. The event projection design has fixtures proving active-branch correctness and replay reconciliation.

Until then, the project remains a scaffold, not a usable OMP WebUI.
