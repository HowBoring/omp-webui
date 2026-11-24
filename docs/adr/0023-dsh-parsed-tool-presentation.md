# ADR 0023: Distinguish parsed Tool presentation from original model arguments

- Status: Implemented in the isolated Host/DSH component; upstream release and private admission blocked
- Date: 2026-11-17

DSH's public `tool/call` and LLM ToolCallBlock promise an exact raw model argument
string. Native tool arguments may be available only as parsed JSON objects. Formatting
those objects cannot recover original whitespace, escaping, key spelling or provider text.

Add the required public Session event `tool/parsed-call`, leaving existing `tool/call`
and raw LLM blocks unchanged. Its parsed JSON object flows through existing Conversation
Definitions, public discriminated Tool records and the existing generic Tool row. It
never populates `argsRaw`. The parsed row labels inert JSON and retains final text and
`isError`; it does not offer business-card argument controls. Text-only details explicitly
label the parsed representation. Old readers must refuse the unknown required event.

The ordered source patch is implemented and browser-verified in this isolated component, but is not a released Session vocabulary.
The upstream generation, persistence acknowledgement, bilingual pairing, complete consumer
and build checks must finish in a later matched cohort before any producer can emit it.
No generated catalog or release version is changed here, and no alternate Host protocol
or native data path is introduced.

The dormant combined source candidate places the exact ticket 45 prompt-notice patch
after parsed Tool presentation. These patches affect disjoint paths and both orders
produce the same tree. They retain their existing Session and Conversation boundaries.
The combined tree requires its own matched build and admission checks.
[Source composition evidence](../evidence/ticket-45-dsh-source-composition.md)

The Host now pairs native calls and results through an ordered call-ID ledger. An unresolved
call ID may not change owner; a result may resolve it once, and a repeated result is refused.
Reopen reconstructs the same parsed call, result, usage and signature records from native
history. Private Session and product admission remain blocked.
