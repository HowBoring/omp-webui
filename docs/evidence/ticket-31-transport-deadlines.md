# Ticket 31 catalog transport follow-up

This retained record explains the original fixes and mutation proof. The [review-fix evidence](ticket-31-review-fixes.md)
records their extraction into the shared core and the final repeated public-client/native/browser checks.

The final ticket branch merges integration `3643be43d6ed7d3b5c782ddb97d24398ecc64641`, including the
[shared preflight transport fix](ticket-30-transport-deadlines.md). The copied catalog transport had the same
startup-budget and queued-write defects. Native catalog API, source patch, schema, identity and budgets are unchanged.

`CatalogTransport` now has an independent limit of **32 queued/inflight writes**, alongside the 32 pending-request
limit. Expiry can free a pending slot without freeing an outstanding write. Every write slot is released in `finally`,
and a request that expires before its queued write starts is skipped. Admission fails with `RPC_PENDING_LIMIT` at
either limit. Its stdin line ceiling stays 16384 bytes, so the serialized queued-line storage is bounded separately
from pending request IDs and the 262144-byte catalog response reader.

`readyTimeoutMs` selects one total deadline covering ready plus negotiation, independent of the ordinary
request/drain `timeoutMs`. Omitting it preserves the selected timeout and the existing 3000 ms default. The outer
startup timer bounds both phases together; a delayed ready does not restart it for negotiation. No product setting,
source scope, Session operation or private admission policy changed.

All new tests use only public `CatalogTransport.open/catalog.describe/close` and actual Bun stdio process fixtures.
They are explicitly contract-fault evidence, not synthetic substitutes for the separately rerun native/browser path.

- A 150 ms ready delay plus 150 ms negotiation delay with a 50 ms request budget failed before the fix with
  `RPC_READY_TIMEOUT` at **53.40 ms**. The independent 200 ms startup bound incorrectly resolved at **325.55 ms**.
  After the fix, the 3000 ms startup override permits startup while the later 100 ms response still exceeds the
  unchanged 50 ms request deadline; a 200 ms total startup budget rejects both phases together. Omitting the
  override still rejects the slow ready under the selected 50 ms default.
- The non-reader consumes no commands after negotiation. Eight waves offer 32 schema-valid descriptions each,
  with 4096-byte references: **over 1 MiB offered**, not a claim that the queue actually writes that much. Before
  the queue fix, the next call timed out with `RPC_REQUEST_TIMEOUT` instead of refusing admission. After the fix
  it rejects with `RPC_PENDING_LIMIT`. Both runs' drain checks observe forced nonzero exit and `RPC_STDIN` when
  terminating the non-reader, proving a real pending write/flush was outstanding. This does not infer blocked
  stdin from a 20 KB workload.
- A separate fixture pauses its actual reader for 1000 ms and then resumes. A mixed wave of capacity refusals
  and accepted-but-expired requests identifies calls queued behind the blocked predecessor. After resume, public
  description probes query the fixture's received-reference set. With **only** the skip guard removed as an explicit
  mutation, the test fails with received (`replaced`) instead of absent (`missing`) at **1448.31 ms**. Restoring the
  guard makes the probes absent, and the resumed child drains naturally with code 0 and no protocol fault. The
  Host was stopped before this temporary mutation; restored bytes match the already built/enrolled artifact.

Focused catalog transport validation passes **5 tests / 29 assertions**; the earlier combined catalog/shared stdio
run passed **21 tests / 74 assertions** before the extra late-publication regression. The final full combined check
is recorded in [ticket 31 evidence](ticket-31-catalog.md). Commands:

```sh
bun test tests/catalog/transport.test.ts --test-name-pattern 'blocked stdin'
bun test tests/catalog/transport.test.ts --test-name-pattern 'expire while queued'
bun test tests/catalog/transport.test.ts tests/compatibility/transport.test.ts
bun run check
bun scripts/build-compatibility.ts --check
bun scripts/build-diagnostics-host.ts
bun scripts/build-catalog-host.ts
bun scripts/enroll-candidate.ts --catalog-fixture
bun run catalog:fixture
python3 tests/browser/catalog-browser.py
```

Both Host bundles and the final enrollment were regenerated from the combined source. The browser workflow was
rerun against that exact Host tuple, retaining the same pinned DSH client assets and native candidate. The native
1000-bucket, identity, ownership, readonly, source and actual 60.5-second TTL evidence remains applicable because
its exact native inputs are unchanged; those cases also pass in the full regression run. No DSH source cold rebuild,
global install, real profile/history, model/provider/tool invocation, GitHub mutation or private admission occurred.
The earlier measured startup HWM failure and its streaming-hash correction remain documented rather than hidden.
