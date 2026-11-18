# DSH compatibility source

The exact release base is `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`
(tree `77ab54bbce37988207baa603b1d39aa9db9aeaaa`). The active [manifest](patches.json)
applies patches 1–3 followed by the semantic draft package patch. It builds
`@deepseek-ai/dsh-client-ui-conversation/client/semantic-draft` as native ESM for
the shared draft decoder and identity constructors. The browser loader uses the
`./client` factory. `bun run dsh:prepare` builds DSH with Node 24.22.1 and
pnpm 11.28.5, then checks the compiled public draft entry in Node and Bun.

To move from the previous patches 1–3 checkout, set `DSH_SOURCE` to a fresh owned
path under `vendor/`. Use that path for both preparation and linking.

```sh
export DSH_SOURCE=vendor/dsh-semantic-draft
bun run dsh:prepare
bun run dsh:link "$DSH_SOURCE"
```

[`parsed-tool-source-candidate.json`](parsed-tool-source-candidate.json) separately records
all six exact source patches under `UNREGISTERED_SOURCE_ONLY`; no current script or runtime
reads that descriptor. Patches 4–5 are inert source prerequisites of patch 6, an unregistered
ticket 46 source proposal.

[`chat-and-tool-source-candidate.json`](chat-and-tool-source-candidate.json) records a
separate dormant cohort for tickets 45 and 46. Patch 7 is the byte-identical Source45
prompt-notice patch, ordered after parsed Tool presentation. The [composition evidence](../../docs/evidence/ticket-45-dsh-source-composition.md)
records both patch orders and the exact scope of the earlier browser evidence.
The [build preflight](../../docs/evidence/ticket-45-dsh-build-preflight.md) records the
exact candidate's generator and Client compiler failures, inactive corrective patches,
and the remaining persistence compatibility review.

Patch 6 adds required `tool/parsed-call` presentation while preserving the existing
`tool/call.arguments: string` and raw LLM blocks. Public display records distinguish
`argsRaw` from `argumentRepresentation: 'parsed-json'` plus `argsParsed`. Chat and
Trajectory retain that distinction through results. Trajectory privately formats its
text-only argument details and imports only the public argument type from Conversation.
The existing generic Tool row
shows parsed objects as labeled inert JSON, bypassing keyed business cards and
argument links. Raw dispatch and raw argument strings retain their previous behavior. Existing PTC
dispatch serialization into legacy `argsRaw` is unchanged and is not an original model
spelling guarantee; this slice addresses the distinct new parsed Session event.

This patch has **not** been enrolled or built. It changes a declared Session persistence
vocabulary. Before any emission, use an independently owned, complete checkout to run
the upstream persistence/catalog generation and compatibility acknowledgement workflow,
refresh bilingual pairing records, inspect every consumer and generated public descriptor,
then build and validate the complete matched client cohort. The generated known-event
catalog is deliberately unchanged in this source slice: existing readers must refuse the
new unknown required event. `ignorable: true` is forbidden by the public new-event type.
Do not copy a generated allowlist entry by hand or reuse ticket 45's built identity.

Native durable owner/context association after reopen remains unimplemented. DSH's existing
call-ID association is presentation behavior, not evidence of authoritative Native ownership.
No Host projector, `get_entries` splice, provider, Native/schema change or admission is included.
Tickets 46/29 remain open; private Session admission remains blocked.

The original ticket 46 worktree's ignored `vendor/dsh` is a historical sparse source preparation
using exact baseline Git objects via a read-only alternate. This normalized candidate does
not copy it or its dependencies. That sparse preparation is not a complete source or build-gate
candidate. Only patch proposals, descriptors, fixtures and documentation are tracked here.
The [normalization record](../../docs/evidence/ticket-46-parsed-source-candidate.md) pins the
selected files and distinguishes historical evidence from checks of this composition.

Historical pure-fixture commands below require an explicitly prepared, exact matching DSH
source and existing dependencies. They are not runnable in this new worktree as checked out;
no source/dependency preparation or runtime admission is implied by retaining the fixtures:

```sh
bun test --no-env-file --tsconfig-override ./compatibility/dsh/fixtures/tsconfig.json \
  --preload ./compatibility/dsh/fixtures/guard.ts \
  ./compatibility/dsh/fixtures/presentation.fixture.tsx
node node_modules/typescript/bin/tsc -p compatibility/dsh/fixtures/tsconfig.contract.json
```

The fixture uses public module composition and React static rendering. It exercises
raw spelling, parsed representation, escaped HTML-like text and final text/error replay;
it does not execute tools or prove Native reopen ownership, a browser, release artifacts
or runtime compatibility. See the preserved
[historical source evidence](../../docs/evidence/ticket-46-parsed-tool-source.md)
and [normalization record](../../docs/evidence/ticket-46-parsed-source-candidate.md).
