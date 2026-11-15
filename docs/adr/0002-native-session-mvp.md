# ADR 0002: Include native Session discovery and core history navigation in the MVP

- Status: Accepted scope; implementation and detailed contracts pending
- Date: 2026-11-15
- Decision owners: project maintainer, confirmed in planning conversation
- Decision map: [OMP WebUI 可用 MVP：原生会话发现与历史导航决策地图](https://github.com/HowBoring/omp-webui/issues/14)

## Context

The owner's daily workflow depends on existing OMP/TUI conversations and their branching history.
A UI restricted to conversations it creates would not provide the requested usable MVP.
The original planning map excluded native discovery and branch UI; the expanded destination therefore
uses a new map while retaining the old research as evidence.

## Decision

- Target Linux/WSL2, loopback, one local user and one active top-level Session at a time.
- Show a DSH-style Workspace-to-Session list, including discovery and import of existing TUI Sessions.
  Import retains the native conversation identity and registers a reference, not a transcript copy.
- Persist registered Workspace/Session reference metadata across Host restarts. OMP alone persists
  messages, tool history, branch trees, credentials and Agent state.
- Support manual recovery after a worker failure and continuation after the previous owner exits.
  Do not automatically replay prompts or tools, force leases, or kill an unknown owner.
- Include Session Tree viewing, History Navigation within one Session, and creating a Branched Session
  from a historical user-message point. Returned draft text is not automatically submitted.
- Provide manual retry where OMP's existing public behavior permits it. Native preconditions and
  possible tool side effects still apply; navigation does not roll back files or external actions.
- Preserve [ADR 0001's RPC-only boundary](0001-rpc-first.md). Missing public catalog or recovery
  capabilities require RPC extensions, not Host access to private runtime APIs or Session files.

## Consequences

Native catalog and import validation are usable-MVP dependencies. The pinned public RPC has history
operations but lacks a global Session catalog; current internal discovery helpers are evidence for an
upstream design, not Host integration APIs. No proposed catalog method name or schema is accepted here.

Follow-on [catalog](../session-catalog-contract.md), [transport](../rpc-client-contract.md),
[client composition](../client-composition.md), [local access](../local-access-contract.md) and
[history interaction](../history-interaction-contract.md) contracts record the resolved choices.
The [Interaction lifecycle contract](../interaction-lifecycle-contract.md) resolves answering, disconnect,
expiry and Stop/revocation policy. The [delivery contract](../rpc-delivery-contract.md) resolves the public
compatibility route, global installation reuse and support window; actual delivery remains unimplemented.
Event projection, attachments and remaining acceptance/handoff decisions continue on the map.
Source review and prototype feedback are not runtime proof.
The health-only scaffold remains unchanged until implementation and end-to-end validation follow.

Live transfer from an active external TUI/Host, parallel Session execution, arbitrary crash repair,
filesystem rollback, complex tree editing/comparison/merging, and broad feature parity remain outside
this MVP. A narrower transport experiment may advance M0, but does not satisfy this destination.
