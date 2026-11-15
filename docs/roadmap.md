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
- [x] Select the local public-RPC transport route; isolated package/decoder probes are evidence inputs.
- [ ] Implement the [transport contract](rpc-client-contract.md), including full prompt ack and EOF/drain tests.
- [x] Select DSH foundation reuse plus a minimal public navigation/action seam, as recorded in [ADR 0005](adr/0005-dsh-client-composition.md).
- [ ] Prove the [navigation/action seam](https://github.com/HowBoring/omp-webui/issues/27) and freeze the modified client manifest.
- [x] Define persistent browser access, WebUI directory grants and dedicated upload staging in [ADR 0006](adr/0006-persistent-local-browser-access.md).
- [ ] Implement and verify [local admission and revocation](local-access-contract.md) before serving private Session data.
- [x] Confirm tree selection, same-Session navigation, new-Session branching and stop-then-repeat behavior
  through a disposable prototype; record the [history interaction contract](history-interaction-contract.md).
- [x] Confirm [Interaction lifecycle policy](interaction-lifecycle-contract.md): shared answering,
  live reconnect, busy admission, explicit expiry cancellation and separate Stop/revocation budgets.
- [ ] Specify and validate public OMP catalog/description, protected continuation and explicit-answer-only
  UI expiry/cancellation guarantees; decide their delivery baseline and compatibility gates.

Exit criterion: a real browser can load the pinned DSH shell and complete a harmless Remote request and stream against the Bun Host; a real OMP RPC worker can complete an interactive protocol round trip.

## M1 — single-Session vertical slice

- Session Registry and worker lifecycle.
- OMP process startup, RPC framing, v2 negotiation, request correlation, and stderr diagnostics.
- New/open Session and model selection.
- Session-local thinking selection and WebUI-only appearance/language preferences.
- Required new image/file input, including its [attachment contract](https://github.com/HowBoring/omp-webui/issues/28), lifecycle and public OMP handoff.
- Prompt, incremental assistant output, tool call/result, cancel, and prompt completion.
- Reject new prompt/steer/follow-up queue input while busy, preserving draft editing and UI answers.
- DSH `session.follow` snapshot and live event stream.
- Event buffering/reconciliation during snapshot opening.
- Public Session Catalog capability and existing TUI Session discovery/import, grouped by Workspace.
- Persistent Host-owned reference index; recover registered lists after Host restart without copying history.
- One active top-level worker at a time, with explicit external-owner conflict behavior.

Exit criterion: one Session can be used through DSH WebUI with streaming and tools, then refreshed/reconnected without losing or duplicating messages.

## M2 — history and interaction correctness

- Full active-branch Conversation projection and separate full-tree History view.
- Older-history pagination.
- Implement the accepted [history interaction contract](history-interaction-contract.md): full tree,
  same-Session History Navigation and Branched Session from a historical user message, with confirmation
  and returned drafts left unsent; verify real stop/quiescence, identity refresh and rebuild behavior.
- Compaction and branch replacement correctness; navigation does not roll back files or external effects.
- Implement the [Interaction lifecycle contract](interaction-lifecycle-contract.md): approval, ask,
  select/confirm/input/editor, deadlines, explicit cancellation, shared answering and live reconnect.
- Multiple viewers of one Session and ownership conflict handling.
- Manual worker crash recovery, continuation after the old owner exits, user-confirmed force Stop,
  security revocation and bounded Host shutdown cleanup, with observed exit and no replay.
- Manual `/retry` through the existing public `prompt` route, with native preconditions and tool side effects.

Exit criterion: the expanded MVP can discover/import native Sessions, retain their registered list,
chat with streaming/tools and image/file input, recover manually, and navigate or branch history without mixing conversations.
Authentication, path authorization and protocol correctness are prerequisites to opening private history.

## M3 — OMP feature extensions

- BTW side-question panel and history.
- Subagent Hub, progress, transcript, cancel, and steering.
- OMP model roles, providers, credentials, and settings.
- Plan/Vibe and other mode controls where public RPC supports them.
- Advanced history labels, tree editing/comparison and broader recovery conveniences.
- Export and broader file-management capabilities beyond the required MVP attachment input/history behavior.

Exit criterion: the supported OMP feature matrix is documented and each exposed feature has an end-to-end test.

## M4 — performance and distribution

- Long-session virtualization and history window policies.
- Streaming render benchmarks and slow-browser backpressure.
- Worker resource quotas and idle eviction.
- Reproducible DSH asset build/package.
- WSL2/Linux distribution and optional SSH-tunnel workflow under a separately reviewed exposure policy.
- Upgrade checks for OMP and DSH pins.

Exit criterion: repeatable install/update workflow with measured performance and documented security posture.
