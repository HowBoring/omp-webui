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
- Performance: accepted catalog/history corpus, streaming throughput, slow-client backpressure, and
  the one-active-worker MVP resource envelope. Parallel workers remain a later extension.

The [acceptance and handoff contract](../docs/mvp-acceptance-and-handoff.md) defines the required
scenario coverage, S0–S5 dependencies, actual Linux Chromium and Windows Chrome/WSL2 matrix,
measurement method and evidence statuses. Its initial count/byte/latency/RSS targets are unvalidated.
Keep source review, deterministic fixtures, actual RPC/native data and real platform-browser evidence
separate, tied to the same tested combination. A simulated Win32 profile or sequential stale-answer
fixture does not replace actual Windows/WSL2 or simultaneous-answer tests. Control-clock boundary tests
for expiry still need separate real restart/persistence tests; preserve unknown outcomes and avoid replay.

Add authentication, Host/Origin admission, authorization, and resource-limit
checks before introducing privileged HTTP or WebSocket endpoints. Real OMP,
DSH compatibility, and browser tests need separately configured integration
environments; no passing local test represents them as complete.

Fixtures must be sanitized and must not contain API keys, credentials, private prompts, or personal workspace paths.
