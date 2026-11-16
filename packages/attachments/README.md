# Controlled attachment preparation

`AttachmentBridge` resolves every browser call through an injected live Host authority. The browser supplies only
an opaque projection, semantic draft identity/revision and ordered controlled original IDs. The authority must verify
the authenticated owner, current trusted projection, original retention/authorization, draft and authority generation;
it returns the native target and verified inline bytes. Paths and content hashes never grant browser read authority.
There is no default authority or product listener. Normal product Session admission remains blocked.

`attachmentsContribution` and `AttachmentRemoteService` mount the OMP workflow on the public DSH Connection/Gateway.
`AttachmentPreparationController` composes with the public semantic provider's `beforeDispatch` hook. Providers own
semantic edit revisions; DSH's submission-entry revision is a separate fence. Render its actual ordered receipt and
all degradation codes, then call `consent` only from the user's explicit acceptance. Failed, stale, cancelled or
unconsented results reject the entire input. Persist only the semantic document/original references, never this
controller, a receipt, prepared bytes or a consent handle.

The trusted DSH prompt adapter calls `submitForRequest` for the exact request bound by `beforeDispatch`. This invokes
the same-source public native submission client; it does not create an alternate prompt or ingestion path. Native
reservation precedes consumption and every input/extension/model/tool effect. Native query reconciles an unresolved
DSH checkpoint by stable attempt identity. The integrating provider must explicitly resolve accepted or not-submitted
outcomes; this bridge does not infer acceptance from HTTP or automatically resend.

The Host holds at most two pending/ready preparations. Native byte/time/decode/archive/output/RPC budgets apply
independently. The native transport must advertise `bounded-jsonl-input-v1` and use a 48 MiB command cap, an explicit
64 MiB queued-byte cap and the unchanged 1 MiB stdout physical-frame cap with negotiated 64 MiB reassembly.
