# DSH client extensions

This package contains only OMP-specific browser modules built against DSH's client module/slot extension points.

MVP modules and public-seam requirements follow the [client composition](../../docs/client-composition.md),
[projection](../../docs/projection-contract.md) and [acceptance/handoff](../../docs/mvp-acceptance-and-handoff.md)
contracts. This package is still a placeholder, not proof of a built or integrated client.

The MVP includes OMP catalog/history views and restricted WebUI preferences, using public module/slot
contracts and audited draft/journal/navigation seams. Global provider/credential/plugin Web management,
BTW and subagent panels are later extensions. Candidate modules across those stages include:

- OMP History Tree and branch actions.
- BTW side-question panel and history.
- Subagent controls and transcript views.
- OMP settings and provider credential views.

Reuse DSH primitives, themes, localization, and slot contracts. Do not fork core Conversation rendering merely to change OMP semantics. Every extension must have an explicit mapping to a public OMP RPC capability; missing capabilities are tracked as upstream RPC gaps, not emulated through private SDK access.
