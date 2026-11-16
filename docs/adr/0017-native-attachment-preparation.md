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
The public semantic provider `beforeDispatch` binds explicit consent to the actual DSH request and local attempt.
The optional shell overlay displays every prepared representation and actual degradation before acceptance.
This contribution requires no upstream DSH business-workflow patch.

Provider-delivery verification remains open: a fresh positive check exposed native cache annotations on frozen
companion objects before model dispatch. Wire fields remain readonly while internal native annotations are allowed.
An input/companion entry commit alone is not proof that a prepared representation reached the provider.
