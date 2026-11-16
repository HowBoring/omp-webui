# S0 transport startup and bounded stdin evidence

Linux, Bun 1.4.4, 2026-11-16. Follow-up for [#30](https://github.com/HowBoring/omp-webui/issues/30).
Merged current `mvp/spec-29` at `dacdb9bff4563d6bf31a8a3035ae692748fbafb2` before final checks
(`git merge mvp/spec-29`: already up to date).

## Cause and correction

The fixture helper passed its deliberately short 50 ms request/drain deadline to process startup too.
Cold process scheduling during concurrent TypeScript builds could therefore fail the unrelated hung-child
shutdown test with `RPC_READY_TIMEOUT`. The fixture now supplies a separate 3000 ms startup allowance.
`ProcessSelection.readyTimeoutMs` bounds ready **and negotiation together**; when omitted it uses
`timeoutMs`, whose existing default remains 3000 ms. Inspect and drain still use `timeoutMs`.
No production caller or default was changed.

The backpressure investigation also found a resource-bound bug: request expiry freed pending slots while
closures accumulated behind a blocked stdin flush. Queued/inflight writes now have their own limit of 32,
using the existing `RPC_PENDING_LIMIT` error. Each write releases its slot in `finally`; a queued request
that expired before its write began is skipped.

## Vertical red/green at public stdio

Tests call only public `PreflightTransport.open/inspect/close` and launch the real Bun process fixture.
The fixture controls delays before ready and negotiation, then uses actual stdio. No clocks, transport
internals, native Agent Session, providers or personal profiles are substituted into this evidence.

1. Added a fixture ready delay of 150 ms with the existing 50 ms deadline. Running
   `bun test tests/compatibility/transport.test.ts --test-name-pattern 'slow fixture launch'`
   failed with `RPC_READY_TIMEOUT` at 55.33 ms. The final regression delays both ready and negotiation
   by 150 ms, opens successfully, and still rejects its 100 ms late report with `RPC_REQUEST_TIMEOUT`
   under the unchanged 50 ms request budget.
2. A separate test gives ready and negotiation 150 ms each, a total startup budget of 200 ms and a
   request budget of 1000 ms. It rejects with `RPC_READY_TIMEOUT` within 1200 ms. Another test omits
   the override and proves a 50 ms selected timeout still bounds ready. A delayed-start hung child
   retains its 50 ms drain deadline and is forcibly reaped within 1200 ms.
3. The former non-reader setup issued 256 small commands (about 20 KB). Adding the public drain
   assertion `protocolFailure === 'RPC_STDIN'` made it fail: the received value was `undefined`.
   Thus the previous test did not demonstrate blocked stdin. Offering 8192 commands (over 500 KiB)
   before the queue fix produced a real blocked write, `RPC_STDIN` on termination, and forced reap
   in a 2.81 s test. Adding the queue-cap assertion then failed: another inspect timed out with
   `RPC_REQUEST_TIMEOUT` instead of rejecting admission with `RPC_PENDING_LIMIT`.
4. With the independent queue bound, the same bounded workload rejects further admission with
   `RPC_PENDING_LIMIT`, then close returns forced nonzero exit and `RPC_STDIN` within 1200 ms.
   The stdin failure is observed only after killing the non-reader: it proves an actual write/flush
   remained outstanding, rather than inferring backpressure from the amount offered. The final
   workload still offers 8192 requests, but the cap rejects later requests before writing them.
   Cancellation separately rejects all 32 pending calls with `RPC_CANCELLED` and reaps within 1200 ms.

## Final validation and artifact scope

All commands ran in `/workspace/work/omp-webui-transport-fixture-startup`, with
`/workspace/work/rpc-public-module-probe/tooling/bun/package/bin` on PATH. Bun stdio tests ran with
the environment's additional network permission for its socketpair implementation.

- `bun run typecheck`: pass, including a concurrent run with the focused transport/framing suite.
- `bun test tests/compatibility/transport.test.ts tests/compatibility/framing.test.ts`:
  **30 pass, 0 fail, 81 assertions**, 1.69 s during that concurrent TypeScript check.
- `bun run build`: pass, five modules. Local `dist/main.js` SHA-256:
  `98b8be50ef7cecca72754f5b8a37ab171c212e475f1149f27aa35303c6ed9231`.
- `bun scripts/build-diagnostics-host.ts`: pass, 239 audited inputs, 1,261,856-byte bundle.
  Local `vendor/host-diagnostics/diagnostics-main.js` SHA-256:
  `adeb6be505f458f2368aae981d45f19df98e607bfce9135baae9413e16faadca`.
- `git diff --check`: pass.

Dependencies, existing candidate launcher and DSH sources were reused read-only from the existing local
cache; no upstream clone or cold/native build was needed. The one existing candidate test still performs
real public v2 preflight and normal drain, but the new fault coverage is explicitly contract-fixture
evidence. No OMP/DSH source patches, wire/schema, assets, production configuration or Session policy
changed. Host transport source and therefore the diagnostics Host bundle/input manifest changed;
downstream integration must regenerate its final Host enrollment/artifact tuple. The local build above
is not a replacement for that final combined integration proof.
