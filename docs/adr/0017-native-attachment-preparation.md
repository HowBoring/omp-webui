# ADR 0017: Stage attachment representations before durable input admission

- Status: Isolated S0 component under implementation; private product admission blocked
- Date: 2026-11-16
- Ticket: [Attachment preparation and consumption](https://github.com/HowBoring/omp-webui/issues/38)

OMP has no baseline generic file-ingestion RPC. Whole prompt dispatch, native file mentions and ReadTool
can invoke extensions, model/tool work or conversation writes, so none is a preparation API.

The additive native component validates controlled inline originals and converts each in an owned helper
process before admission. Its helper has a synthetic home, an allowlisted environment, a network denial
installed before converter imports, Linux data/CPU/file/core resource limits, a wall deadline, bounded
stdio and explicit kill/reap. Missing containment or converters refuse preparation. Filename/path inputs
are absent; browser names never become file mentions or extraction destinations. Native manual prose,
slash/templates and ordinary `@path` remain distinct from tagged controlled originals.

Exact originals remain Host-owned objects. Ephemeral native receipts stage processed representations;
restart requires fresh preparation. Every item is reported, any failed item blocks the entire input,
and actual truncation, transformation, animation loss and document omissions require consent to the
receipt digest. Original, decoded-image, archive, conversion, prepared-payload and complete JSONL RPC
limits have separate versioned ceilings in the native `attachments/limits.ts` source.

Consumption will validate the draft/object/order, target/source/instance, context/model/thinking,
authority and budget bindings before the #36 native durable reservation. It must fingerprint the exact
staged bundle and retain causal original/prepared identities on actual entries. Durable duplicate
queries precede ephemeral receipt validation, never replay work, and must survive receipt loss.
Host authentication/current grants are rechecked at intake, lookup and consumption; an opaque native
authority generation or a content hash supplies no browser/file authority by itself.

Public RPC/schema/client, #36 consumption/provenance, downstream exact-image behavior, bounded fault
fixtures and the real Bun/DSH browser path remain mandatory gates. Component tests do not authorize
private Session admission or establish product/global-runtime support. Windows remains owner-deferred.

The OMP-specific `ompAttachments` typed Remote contribution uses the existing public DSH Gateway/Connection.
Its native port is restricted to preparation/cancellation and durable submission; browser calls contain opaque
projection/draft/original identities, with trusted targets and verified bytes resolved by the Host authority.
The public semantic provider `beforeDispatch` registers the actual DSH request and frozen local attempt.
The trusted typed Session prompt Remote receives the exact DSH serialized content, prepares that same
attempt and holds Native admission until every object is ready and actual degradations are accepted.
Pre-Enter checks cover original readiness; they do not recreate private DSH quote/reference serialization.
The optional shell overlay displays every prepared representation and actual degradation before acceptance.
This contribution requires no upstream DSH business-workflow patch.

Persisted attachment links earn optional `entryPart` locators from the actual native part object at final
saved-message construction. Content/file indices are not guessed from a receipt, hash or append order.
Missing, changed or ambiguous occurrences remain explicit; reservations have no persisted slot. Public
history may expose the saved causal links without asserting that displayed history is exact provider input.

Wire fields remain readonly while native internal cache annotations are allowed. Actual controlled-provider
checks establish only their recorded source tuple; the pending locator/source changes require fresh matched
public-RPC/provider verification. An input/companion commit alone does not establish provider delivery.
