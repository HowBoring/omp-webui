# ADR 0005: Reuse the DSH client foundation with explicit OMP navigation policy

- Status: Accepted composition and product scope; public seam and integration unimplemented
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
