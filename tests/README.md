# Tests

Test layers:

- Unit: request handlers, configuration, state machines, RPC framing, and event projection.
- Contract: pinned OMP RPC wire schema and DSH Remote/Connection contract.
- Integration: real OMP RPC worker lifecycle and interaction round trips.
- Browser E2E: pinned DSH client, Session follow/replay, approval, branch changes, and reconnect.
- Performance: long history, streaming throughput, slow-client backpressure, and multi-worker resource use.

Fixtures must be sanitized and must not contain API keys, credentials, private prompts, or personal workspace paths.
