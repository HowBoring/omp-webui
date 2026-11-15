# DSH client extensions

This package contains only OMP-specific browser modules built against DSH's client module/slot extension points.

Candidate modules include:

- OMP History Tree and branch actions.
- BTW side-question panel and history.
- Subagent controls and transcript views.
- OMP settings and provider credential views.

Reuse DSH primitives, themes, localization, and slot contracts. Do not fork core Conversation rendering merely to change OMP semantics. Every extension must have an explicit mapping to a public OMP RPC capability; missing capabilities are tracked as upstream RPC gaps, not emulated through private SDK access.
