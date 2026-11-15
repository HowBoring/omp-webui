# Roadmap

The roadmap is ordered around protocol correctness. UI feature parity comes after the Host can reliably open, stream, replay, and recover a Session.

[OMP WebUI 可用 MVP：原生会话发现与历史导航决策地图](https://github.com/HowBoring/omp-webui/issues/14) governs open questions;
[ADR 0002](adr/0002-native-session-mvp.md) records the confirmed expanded MVP scope. Milestones below
are implementation stages, not permission to omit native discovery/import or core history controls
from the usable MVP. The runtime is still a health-only scaffold.

## M0 — compatibility proof and architecture baseline

Status: scaffold created; implementation not complete.

- [x] Record exact OMP and DSH upstream commit baselines.
- [x] Record the RPC-first and DSH Remote architecture decisions.
- [x] Establish strict TypeScript/Bun project configuration.
- [x] Add a loopback-only health-check scaffold and unit test.
- [ ] Build the pinned DSH browser bundle and serve it without starting DSH's Agent Host.
- [ ] Implement one harmless DSH unary Connection/Remote call.
- [ ] Implement one Gateway WebSocket Remote stream with cancellation.
- [ ] Spawn a real `omp --mode rpc-ui` worker and negotiate RPC v2.
- [ ] Complete an Extension UI request/response round trip.
- [ ] Decide and specify the additive OMP Session Catalog RPC, including read-only import validation.

Exit criterion: a real browser can load the pinned DSH shell and complete a harmless Remote request and stream against the Bun Host; a real OMP RPC worker can complete an interactive protocol round trip.

## M1 — single-Session vertical slice

- Session Registry and worker lifecycle.
- OMP process startup, RPC framing, v2 negotiation, request correlation, and stderr diagnostics.
- New/open Session and model selection.
- Prompt, incremental assistant output, tool call/result, cancel, and prompt completion.
- DSH `session.follow` snapshot and live event stream.
- Event buffering/reconciliation during snapshot opening.
- Public Session Catalog capability and existing TUI Session discovery/import, grouped by Workspace.
- Persistent Host-owned reference index; recover registered lists after Host restart without copying history.
- One active top-level worker at a time, with explicit external-owner conflict behavior.

Exit criterion: one Session can be used through DSH WebUI with streaming and tools, then refreshed/reconnected without losing or duplicating messages.

## M2 — history and interaction correctness

- Full active-branch Conversation projection and separate full-tree History view.
- Older-history pagination.
- MVP Session Tree viewer, same-Session History Navigation and Branched Session from a historical user message.
- Compaction and branch replacement correctness; navigation does not roll back files or external effects.
- Approval, ask, select/confirm/input/editor, timeout, cancellation, and browser disconnect.
- Multiple viewers of one Session and ownership conflict handling.
- Manual worker crash recovery, continuation after the old owner exits, and Host shutdown cleanup.
- Manual `/retry` through the existing public `prompt` route, with native preconditions and tool side effects.

Exit criterion: the expanded MVP can discover/import native Sessions, retain their registered list,
chat with streaming/tools, recover manually, and navigate or branch history without mixing conversations.
Authentication, path authorization and protocol correctness are prerequisites to opening private history.

## M3 — OMP feature extensions

- BTW side-question panel and history.
- Subagent Hub, progress, transcript, cancel, and steering.
- OMP model roles, providers, credentials, and settings.
- Plan/Vibe and other mode controls where public RPC supports them.
- Advanced history labels, tree editing/comparison and broader recovery conveniences.
- File references, image attachments, export, and other selected DSH capabilities.

Exit criterion: the supported OMP feature matrix is documented and each exposed feature has an end-to-end test.

## M4 — performance and distribution

- Long-session virtualization and history window policies.
- Streaming render benchmarks and slow-browser backpressure.
- Worker resource quotas and idle eviction.
- Reproducible DSH asset build/package.
- WSL2/Linux deployment, launch token, authentication, and optional SSH-tunnel workflow.
- Upgrade checks for OMP and DSH pins.

Exit criterion: repeatable install/update workflow with measured performance and documented security posture.
