# Durable navigation public contract candidate

This is an **unregistered SOURCE candidate**, a prerequisite for #51. Its capability
remains **unavailable**: there is no Host RPC port, transport integration, service,
Remote, route, Browser View action, projection owner, or draft operation here.

`navigation-client.ts` and the three generated validators are copied exactly from
the public generated artifacts at #37 commit
`c8efeced4b6f59bc686a90fe48f4ee4ea72d5180`. `candidate.json` pins every artifact,
the eight ordered Native patches, source/build/schema identities, generated wire
input, type closure, compiled validators, client, and runtime helper. This namespace
does not extend the active `packages/contracts/generated/omp-wire.ts` command union
or replace the active schema, decoder, capabilities, upstream lock, or patch list.
No product module imports this directory.

`source/` contains inert **public generated OMP** inputs. It contains no DSH source
and is never a runtime dependency. The native generated wire is byte-identical to
the public wire input. Native schema JSON and the public schema have equal values
but different formatting: the public bytes are exactly
`JSON.stringify(nativeSchemaValue, null, 2) + "\n"`, the existing public build
serialization. Both original hashes are recorded. No Native generator was imported
or run to establish this equality.

The pure checker extracts `omp-wire.ts` from the exact public TypeScript AST. It
copies the three original command-table members and recursively copies all referenced
declarations, plus `NavigationPolicy`, refusing an open or nonlocal reference. Eight
declarations close the contract. The current integration has no `SubmissionTarget`;
the candidate includes its exact public definition and imports no active Root type.
The checker also verifies the command table against the public schema, recompiles
all three validators with AJV and requires byte equality, verifies artifact hashes,
and audits every runtime import including the AJV helper's empty import closure.
`--write-types` reproduces only the narrow candidate type file; it does not invoke
Native, write its inputs, or rebuild validators or an active contract.

The validator wrapper exposes the exact native command validator as a boolean:
the native schema permits an omitted transport `id`, whereas the public callback
client always supplies an `id`. Giving this validator the client's required-id
type predicate would be unsound. Preview and result predicates use the matching
generated types. Structural validation does **not** attest scope, admission,
semantic success, or durable effects. The copied public client checks echoed
entry/operation IDs but does not enforce exact target scope or semantic result
combinations. Wire confirmation revisions are optional; a future Host must require
both and independently validate target/origin, matched policy, ownership and idle
authority. No generic raw request bypass or legacy `navigate_tree` fallback is
provided. A missing port must continue to mean unavailable.

`navigation_query` reads facts; an absent or unknown result gives no permission to
resend. A failed outcome can carry committed effects. Reference-only returned
drafts stay explicitly unavailable, and inline returned text is not sent here.

Pure/static evidence is recorded in
[`docs/implementation/ticket-51-contract-source.md`](../../../../docs/implementation/ticket-51-contract-source.md).
The #37 immutable 6110-input chain and Native 123-file/index/diff state were checked
read-only. The final #37 terminal-fault actual remains pending with historical
failed actuals and unresolved old fake accounting; old crash evidence does not
attest this cohort. #38 retainer work and #41's permission-blocked actual grant no
runtime authority to this candidate. Whole #51/#37/#29 and global/private/product
admission remain open or blocked. Fresh paired review is required before any
integration decision.
