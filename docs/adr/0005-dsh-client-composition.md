# ADR 0005: Reuse the DSH client foundation with explicit OMP navigation policy

- Status: Accepted composition and product scope; stock product cutover in progress (ticket #63)
- Date: 2026-11-15
- Decision: [原生会话与历史导航 MVP 的 DSH 客户端组合](https://github.com/HowBoring/omp-webui/issues/19)

The MVP retains the tested DSH Conversation, Chat, Tool, layout and supporting service foundation,
adds small OMP catalog/history modules, and accepts a minimal auditable public extension patch for
navigation and action policy. It does not pursue the smallest plugin count or rewrite Conversation.
The tested 28-plugin graph is a starting foundation, not proof of the final modified composition.

Stock navigation can request Session creation during restoration and Workspace selection; some
keyboard routes bypass menu access checks. Slots can replace presentation but cannot withdraw those
private effects. The chosen public seam must control these behaviors explicitly. Hiding buttons,
overriding private instances or falsifying the owner access baseline is insufficient.

New image/file input is required in the MVP. Session-local model/thinking selection and WebUI
appearance/language preferences are included; provider, credential and plugin administration remain
in existing OMP configuration. Attachment formats, ownership, receipts and retention require their
own contract and validation. No permanent Host attachment store is approved by this decision.

This trades a small tracked upstream extension and its compatibility tests for preserving mature UI
and service behavior. Replacing narrower services remains an alternative if the seam experiment
shows the required patch would spread into a broad fork. Record the exact base SHA and patch/build
identity separately; this is not an already available API or permission to float the DSH pin.

The [client composition contract](../client-composition.md) records selected scope and gates. The
navigation experiment and attachment contract must complete before implementation handoff.

## Served client policy

The Host's history journals are generation-scoped: a native cut change replaces the presented journal,
and `session/control` announces the new projection. Stock `@deepseek-ai/dsh-api-session-controller`
defaults to `projectionRebuild: false`, which drops that announcement and leaves the view on
`openState = 'error'` after the first cut change. The served `WebBootEntry` therefore carries
`config: { projectionRebuild: true }` for that package (`scripts/build-product-client.ts`,
`clientConfigs`), verified against the built boot graph. This is a stock option, not a fork.

## Native records on the stock surface

Native log kinds have no arbitrary-event escape hatch: the stock surface event union accepts only
system/developer/user/assistant/tool result, and Decision 9 of Spec #29 forbids inserting native fields
into strict envelopes. Records that carry conversation text (custom messages, file mentions,
compaction/branch/reset boundaries) therefore project as one stock `user/message` with their exact text
and file list. Records that only record bookkeeping (`model_usage`, `thinking_level_change`,
`model_change`, `service_tier_change`, `title_change`, `session_init`, `mode_change`, `credential_pin`,
`ttsr_injection`, `label`) are explicitly omitted; the same projections expose that state through their
own surfaces. A record the native side marks hidden (`display: false`) stays hidden. Any other kind or
role raises `live_native_record_unsupported` rather than emitting an unknown surface event, so an
unmapped native feature is a typed compatibility failure instead of a silent skip.

## Semantic draft package

DSH's Conversation browser loader runs the `./client` factory. Node and Bun
consumers load the codec and identity constructors through the public ESM export
`./client/semantic-draft`. Both build targets compile the same draft implementation.
DSH preparation checks the emitted ESM in Node and Bun before recording the
source identity. [DSH package evidence](../evidence/ticket-45-dsh-semantic-draft-package.md)
