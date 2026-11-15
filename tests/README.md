# Tests

Current executable checks in `host/http.test.ts` cover health JSON, absence of
CORS headers, unavailable API paths (501), unknown non-API paths (404), and a
real ephemeral loopback HTTP listener with cleanup. They require no model
credentials or upstream processes. These checks do not prove OMP readiness or
DSH compatibility.

Future test layers remain pending:

- Unit: state machines, RPC framing, and event projection.
- Contract: pinned OMP RPC wire schema and DSH Remote/Connection contract.
- Integration: real OMP RPC worker lifecycle and interaction round trips.
- Browser E2E: pinned DSH client, Session follow/replay, approval, branch changes, and reconnect.
- Performance: long history, streaming throughput, slow-client backpressure, and multi-worker resource use.

Add authentication, Host/Origin admission, authorization, and resource-limit
checks before introducing privileged HTTP or WebSocket endpoints. Real OMP,
DSH compatibility, and browser tests need separately configured integration
environments; no passing local test represents them as complete.

Fixtures must be sanitized and must not contain API keys, credentials, private prompts, or personal workspace paths.
