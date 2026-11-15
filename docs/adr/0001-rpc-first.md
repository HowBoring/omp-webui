# ADR 0001: Use OMP public RPC as the only Runtime boundary

- Status: Accepted
- Date: 2026-11-15
- Decision owners: project maintainers

## Context

The goal is to reuse the mature DSH browser UI while preserving Oh-My-Pi's Agent Runtime and interaction semantics.

An SDK-integrated Host can call internal Agent objects directly, but it couples the Host to OMP's internal TypeScript APIs and tends to create a single in-process Session driver. That makes independent upgrades, process isolation, worker supervision, and concurrent Session ownership harder to reason about.

OMP already exposes a JSONL RPC protocol over stdio. At the reviewed baseline it supports protocol v2 framing, Session commands, live Agent/session events, subagent surfaces, BTW, and an `rpc-ui` mode for interactive Extension/Tool UI requests.

DSH's current browser client uses its own Connection and Typert Remote contract. Its Session Controller includes unary methods and Gateway-owned streams; `session.follow` opens with a snapshot and continues with ordered events.

## Decision

1. OMP is an external process. The Host communicates with it only through the public OMP RPC protocol.
2. Interactive workers run with `--mode rpc-ui`, without `--no-ui` by default.
3. The Host targets RPC protocol v2 and must retain a validated v1 fallback only where required for compatibility.
4. The Host implements the DSH Connection and Gateway Remote contract consumed by the pinned DSH Web Client. No parallel browser protocol is introduced.
5. One concurrently active top-level OMP Session maps to one supervised worker. Multiple browser viewers of that Session share the worker; OMP subagents remain under their parent worker.
6. OMP owns durable Session and Agent state. Host projections and caches are derived and disposable.
7. Missing OMP capabilities are addressed through additive public RPC protocol changes, not internal SDK imports or direct session-file parsing.
8. The DSH upstream source and generated client assets are pinned and built outside the Git repository.

## Alternatives considered

### Embed OMP Agent SDK in the Host

Rejected. It makes the Host depend on internal runtime APIs and complicates process isolation and multi-Session lifecycle management.

### Run DSH Host and replace its Agent implementation

Rejected. This retains unnecessary DSH runtime dependencies and does not preserve OMP's native execution and persistence semantics.

### Build a new browser protocol

Rejected. It would require rewriting or adapting DSH's Connection, Remote, stream, and Session client layers, undermining the primary UI reuse objective.

### Use a separate language for the Host

Deferred. Go or Rust could be appropriate for a separately deployed multi-user service, but TypeScript + Bun minimizes protocol/type duplication with both OMP and DSH at this stage.

## Consequences

Positive:

- OMP and the Web Host can be upgraded and restarted independently.
- Worker crashes and Session concurrency have explicit process boundaries.
- No OMP Agent SDK dependency leaks into Host runtime code.
- DSH UI reuse is maximized.

Costs and constraints:

- The Host must implement two protocols: OMP RPC and DSH Remote/Connection.
- OMP RPC currently lacks a global read-only Session Catalog; an upstream RPC addition is required for a complete DSH sidebar.
- DSH's sequenced Session journal must be projected carefully from OMP's tree-shaped durable history and live events.
- The current OMP TypeScript RpcClient does not expose every `rpc-ui` operation through its public API; a small protocol transport or upstream client enhancement is required.
- TUI-only features must be classified as RPC gaps, browser extensions, or intentionally unsupported.

## Follow-up

- M0: prove DSH Connection/Gateway compatibility with a minimal Host.
- M0: prove OMP `rpc-ui` v2 round-trip and Extension UI response.
- M0: specify the public Session Catalog RPC extension.
- M1: implement Session projection and replay fixtures before broad UI feature work.
