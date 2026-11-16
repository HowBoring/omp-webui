# M0 initialization validation

Reviewed on 2026-11-15 (Asia/Singapore). Initialization is complete; the compatibility proof
and usable WebUI remain pending under [the roadmap](roadmap.md).

## Repository and upstream evidence

- Actual default branch: `master`, not `main`. Initial inspection found only `.gitignore`
  and MIT `LICENSE` at `1de3bbcfae7270bea47edc03df01b09caa469733`.
- Concurrent initialization commits advanced `master` to `ec70c6c1bbff598f659b7279079fb1973030b2fd`.
  This validation update preserves that scaffold, its `apps/host` layout, health contract,
  port 3180, runtime source, base ignore rules, and MIT copyright notice.
- Fixed OMP/DSH revisions, release and npm metadata are in [upstreams.lock.json](../upstreams.lock.json).
  The source, package exports, wire/schema, Connection, Gateway, Session Controller and Remote access
  evidence is described in [upstream compatibility](upstream-compatibility.md).
- OMP `18.20.2` matches its release/npm version; DSH source `0.2.2-rc.3` differs from its Web
  frontend/client npm latest versions. Source review is not an installed-client compatibility result.
- DSH was subsequently pinned to the latest official published release (including prereleases):
  `dsh-v0.2.2-rc.3` at `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`. The tag and package versions
  were verified, and Connection, unary transport, Gateway, stream protocol, Session Controller and
  Remote access were reread at that revision. It replaces the earlier post-release `master` pin;
  the source version string is unchanged, but the commits and authentication composition differ.

## Passing local checks

Environment: Bun 1.4.4, TypeScript 6.0.3, `@types/bun` 1.4.4. Development dependencies are exact
and locked in `bun.lock`; no OMP or DSH runtime dependency is installed.

| Check | Command / evidence | Result |
| --- | --- | --- |
| Reproducible dependencies | `bun install --frozen-lockfile` | PASS; lock unchanged |
| Strict types, tests, build | `bun run check` | PASS; 11 tests / 16 assertions; `dist/main.js` |
| Built entry startup | `bun dist/main.js` with loopback host and ephemeral port, HTTP health request, process cleanup | PASS; expected service/status/stage JSON |
| Existing source and license | `git diff --exit-code -- LICENSE apps/host/src/http.ts apps/host/src/main.ts` | PASS; unchanged |
| Patch whitespace | `git diff --check` | PASS |

Tests exercise health content/no CORS, explicit 501 for unimplemented `/api/` routes, 404 elsewhere,
and real loopback HTTP startup/request/stop. They need no model credentials or external network.
Health success proves Host liveness only. Independent review of the final file tree is reported with
the delivered commit; it does not replace the pending integration checks below.

## Isolated Client policy evidence

On 2026-11-16 the [DSH public policy experiment](dsh-policy-validation.md) passed patched/baseline
browser comparisons, 2,306 Client tests, artifact build and aggregate type checks. Its source patch,
module/asset identities, traces, screenshots and review remain on a separate experiment branch.
This does not implement the Bun Gateway/OMP/Broker or satisfy the real integration rows below;
the tested shortcut profile and Linux Web limitations are explicit in that report.

## Outstanding M0 verification

| Area | Required evidence before exposing the capability |
| --- | --- |
| OMP public dependencies | Install pinned CLI/client artifacts; compile and runtime-import the public exports; verify Bun/native dependency closure on supported platforms |
| RPC v2/process lifecycle | Real `rpc-ui` worker, ready/negotiation/get_state round trip, chunk limits/corruption/backpressure, stdout drain and process cleanup |
| Completion and history | Prompt admission/result/settled; synchronous builtin `data.agentInvoked: false` completion without a later result; paged history, active-branch projection, duplicate/gap recovery |
| Interaction Broker | Tool and extension dialogs, ask opt-in, approvals, cancellation/deadlines, disconnects, authorized answerer and stale-generation rejection; `--no-ui` fail-closed behavior |
| DSH client delivery | Matched external build and dependency/asset closure, loader/module composition, license/third-party notice preservation; no vendored source or old SDK Driver |
| DSH Remote mapping | Descriptor-based capability matrix, unary envelopes/codec/errors, mux/uplink/cancel, `$events` generation and `$events/result`; explicit unsupported capability behavior |
| Attachments and drafts | [Accepted policy and remaining preparation decision](attachment-contract.md); exact originals, limits/quota, fresh receipts, per-tab reload/restart recovery, expiry/deletion, recoverable native-entry/commit association and real browser/OMP evidence |
| Session ownership/catalog | Stable Host/OMP identity, leases, concurrent viewers and crash recovery; additive RPC catalog extension before a complete workspace/session sidebar |
| Security | Authentication, Host/Origin/CSRF and WebSocket admission, per-session/workspace authorization, resource limits, output sanitization and redacted logs before privileged routes or remote binding |

All rows above are pending, not passing or silently skipped tests. RPC gaps must be resolved through
public wire/schema/client extensions rather than SDK embedding or session-file access.
