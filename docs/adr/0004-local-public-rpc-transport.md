# ADR 0004: Own a narrow transport over OMP's public RPC

- Status: Accepted route; implementation and worker integration pending
- Date: 2026-11-15
- Decision: [原生会话 MVP 的 OMP 公共 client 接入路线](https://github.com/HowBoring/omp-webui/issues/18)

The MVP will use a local Bun stdio transport, reusing OMP's public framing modules, wire types and
schema generator. The Host owns process lifecycle, bounded I/O, request correlation, full prompt
admission results, UI routing and EOF/output draining. This remains a client of an external OMP
process and does not embed Agent Runtime objects or copy the old SDK Driver.

The alternative was to extend upstream RpcClient before integration. Its reviewed public interface
lacks general Extension UI handling, full prompt acknowledgement data and graceful EOF/drain control.
Keeping these responsibilities in the Host fits its existing Supervisor/Broker boundaries and avoids
adding those client API changes as another prerequisite. The cost is explicit local ownership of
protocol and fault tests; an upstream decoder alone does not validate all wire semantics.

Published-package probes verified the low-level public imports and schema generation under Bun 1.4.4.
They did not execute RpcClient's eager configuration/native import chain or start an OMP worker.
This decision therefore does not claim the full integration is proven or that native dependencies
are absent from the installed package graph.

The required server catalog/description and protected-continuation extensions remain dependencies
under either route, along with the later explicit-answer-only cancellation guarantee. [ADR 0008](0008-public-rpc-delivery.md)
selects a public compatibility build and verified global installation reuse; the actual artifact remains
undelivered and the upstream lock is unchanged.
A future public RpcClient may replace the local adapter after it satisfies the same external
contract and conformance tests. The [transport contract](../rpc-client-contract.md) records the
boundary, validation responsibilities and remaining gates.
