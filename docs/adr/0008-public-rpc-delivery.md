# ADR 0008: Deliver public OMP compatibility extensions and reuse the verified global installation

- Status: Accepted delivery policy; compatible source/artifact and installation verification pending
- Date: 2026-11-15
- Decision: [OMP 公共 RPC 扩展：目录、严格接续与交互取消的交付门禁](https://github.com/HowBoring/omp-webui/issues/25)

The MVP will use an auditable public compatibility build based on the pinned OMP source, adding the
catalog, protected-continuation and explicit-answer-only expiry guarantees. Source delta, actual build,
schema and conformance evidence must be immutable and linked. This permits progress before an official
release while making the project responsible for patch maintenance; an official build replaces it only
after passing the same gate. The Host remains an external public RPC client.

The maintainer chose the global OMP installation over a separately installed WebUI worker. The Host
must identify and verify the actual global launch target/runtime closure on every startup; unknown or
changed installations block Session admission. This accepts operational coupling with the user's TUI
and global upgrades in exchange for one installation. It is not permission to trust any `omp` on PATH,
silently install a parallel worker, or claim an existing official build has the missing semantics.

Initially only one fully validated Host/OMP-build/schema combination is supported. Upgrades replace
the complete locked tuple after isolated verification. Rollback additionally requires compatibility with
current native data: replacing an executable does not reverse Session migration. The
[delivery contract](../rpc-delivery-contract.md) records provenance, early capability checks, global
installation stability, failure behavior and real fixture gates. No upstream pin or global software
was changed by recording this policy.
