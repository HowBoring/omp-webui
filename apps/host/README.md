# Host application

This is the Bun process that will serve the DSH Web Client and supervise OMP RPC workers.

The current implementation is intentionally limited to:

- Loopback-only HTTP binding.
- `GET /healthz`.
- Explicit `501` responses for the not-yet-implemented API surface.

Do not add OMP SDK imports here. OMP integration belongs behind the RPC transport boundary described in [the architecture](../../docs/architecture.md).
