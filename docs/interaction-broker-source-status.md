# Interaction Broker source vertical (#47)

**Status** — Source, public Remote, isolated loopback carrier, and isolated Linux
Chromium evidence. Private Session admission depends on #46 and #41. Linux
product-browser and real Native Broker verification are pending. Windows
Chrome/WSL2 is deferred by the owner.

`packages/interactions/broker.ts` supplies an in-memory Broker for one worker
incarnation, with a separate verified Session or explicit startup-context scope.
`packages/interactions/service.ts` exposes it through the typed
`ompInteractionBroker` Host Remote contribution. It does not install an HTTP route,
listen, launch a worker, or change the existing S0 `InteractionBridge`.

The Host must install the Native receive path before starting the worker, create a
new Broker for every worker/Host incarnation, and close the old Broker on exit.
It must obtain each `PageBinding` from authenticated admission for the actual
credential, Connection clientId and Peer, then bind that object with
`interactionCaller.run()` around public Gateway invocation. Binding values never
come from Remote arguments. The synchronous authority callback must check current
credential, directory, Session/startup context and resource rights on every read
and answer. Broker generation, worker generation, Native UI id, Agent scope,
page generation and delivery id remain separate. The delivery id is a Host Remote
token; it is not a DSH source eventId or evidence of a source waterfall invocation.

The isolated Session component can opt in by supplying an `interactionBroker`
instance from trusted Host startup. It binds one logical `$events` stream per
independently issued BrowserAuthority credential. The existing Gateway generates
the ready frame's `clientId` and its physical Peer supplies `Peer.id`. The Host
requires the same current Peer for the generated `pending` and `answer` Remotes.
These requests retain the existing BrowserAuthority, exact Origin and CSRF
checks. Stream cancellation, socket closure or credential loss retire the
binding. Each request retains its admitted binding through parsing, invocation
and result publication, so reconnect cannot inherit a prior request's result.
The service rechecks authority after Gateway preparation before using the
Broker. Unary bodies have a 16 KiB limit and a five-second deadline. Terminal
authority loss also ends a body read. A valid invocation failure retains its
DSH request correlation and uses a fixed public error.

The unary fixture uses a distinct credential for each Browser View. Ordinary
DSH unary envelopes carry no Connection clientId. The caller supplies current
scope authorization as part of the Broker. Trusted revoke-all closes Broker
admission before waiting for Native cancellation and supervisor drainage.
The carrier owns the supplied Broker's lifetime until Host stop. Worker/Native
wiring and composed Browser acceptance are separate gates.

The isolated `interactionBrokerMode: "shared-cookie-snapshot"` option exposes
`ompInteractionBroker/pendingSnapshot` on the standard DSH Remote mux. In this
mode the fixture exposes only the snapshot Broker Remote. The Host binds the
snapshot to the admitted socket Peer and its one live Gateway `$events` ready
stream. The snapshot takes zero arguments. Authority is checked when admitting
the read and again before publishing. A successful read emits one exact
`BrokerSnapshot` and a terminal `end`. Rejected reads receive a fixed typed error
on the logical stream. The Client validates the item, reads the terminal, and
disposes the handle.

The loopback regression uses independent pinned DSH Clients sharing one issued
cookie. Their ready client, Peer, and delivery identifiers are distinct.
Canceling the first Client's logical `$events` stream withdraws its snapshot
admission while the second Client keeps its existing delivery. A ready physical
reconnect receives a new delivery with the original deadline. A controlled
monotonic clock and synthetic Native port verify zero answer and Stop calls.
Shared-cookie answering and composed product-browser verification are separate
work.

Ordinary disconnect retires only that page's deliveries. A current reauthorized
page receives only pending UI and the original deadline. Refresh, reconnect and
wait-configuration changes cannot renew existing requests. A fresh Broker has no
old pending records, even when the Session id is unchanged. Limits are 64 current
pages, 16 pending/settling UI records, 4,096 seen Native UI ids per incarnation,
and 64 bounded outcome records; no transcript or pending UI is persisted.

Locally invalid answers never reserve a request. The first locally valid answer
reserves it synchronously, before awaiting Native RPC; concurrent answers fail as
stale. Native remains the final business authority. An `invalid` acknowledgement
re-presents a still-live question with fresh delivery tokens and its original
deadline. The timer continues while an acknowledgement is held. Expiry or scope
revocation may send a coalesced explicit cancellation alongside that outstanding
answer and request Stop. These are competing public Native commands, not a Host
claim that it can undo a consumed answer. A late Native acknowledgement remains
the actual Native result; it cannot revive retired UI. A revoked page receives
stale on result application. A lost or incompatible acknowledgement remains
unknown and requests Stop without replay. Stop request/acknowledgement/failure is
observable, and none of them establishes joint quiescence or process exit.

The default deadline is 30 minutes from Broker creation of the UI record on its
monotonic clock. A smaller Native timeout wins; configuration applies to future
records. Expiry sends `{type:"cancel",timedOut:true}` via `respond_ui` and requests
Stop, without a selected option, recommended answer, `false`, or fallback text.
`timedOut:true` is Host expiry, never ordinary disconnect or credential logout.
Credential revocation removes only that credential's pages; scope/revoke-all must
use `revokeScope()` and the external bounded Stop coordinator. #48's full Stop,
queue restoration, quiescence and escalation remain outside this vertical.

The injected `BrokerNativePort` is a Host adapter interface, not a new Native API:

| Source request | Matched public Native contract | Broker handling |
| --- | --- | --- |
| Startup/root extension UI | `extension_ui_request` + `respond_ui {targetId,answer}` / `UIReplyResult` | Explicit startup scope, no fabricated Session |
| Session extension UI (`ask`, `select`, `confirm`, `input`, `editor`) | Same command; exact question order/id, option labels and answer discriminants | Current Session/worker/page authority and delivery checks |
| Extension cancellation notice | `extension_ui_request`, `method:"cancel"`, `targetId`, `reason` | Retires the target; expiry requests Stop |
| Native ask / HTML-form tool fallback that emits extension UI | Same extension request/answer contract, with matched `interactionPolicy` guarantee | No invented generic tool answer |
| `host_tool_call` / `host_tool_cancel` | `host_tool_update` / `host_tool_result`, including actual result/error payload | Separate execution contract; never routed to `respond_ui` |
| `host_uri_request` / `host_uri_cancel` | `host_uri_result`, with read/write/content/error semantics | Separate execution contract; never routed to `respond_ui` |

Types and request/policy validators are reused from the committed current33
generated public contracts. The candidate declares explicit-answer-only native
and tool expiry semantics before UI admission. Stock pinned OMP without that
effective guarantee remains incompatible; an earlier Host timer cannot supply it.
This vertical needs no additional Native command for its extension-UI subset.
The combined #47/#48 source correction retains unresolved Native UI independently
of visible answer cards. Invalid, rejected or incompatible cancellation (including
late UI during Stop) records unknown and blocks Broker resume; settled or elapsed
time cannot clear it. Only a validated same-UI terminal result or Native cancel
notice resolves it. Tracking shares the 4,096 seen-UI bound, and overflow latches a
worker-lifetime blocker without evicting unresolved evidence. The Stop adapter must
read both `pendingCount` and the required live `cancellationUncertain` signal;
[Stop source status](stop-coordinator-source-status.md) documents that composition
and its 30 controlled public Remote fixtures. Public Remote/RPC schemas are unchanged.
It does still need an admitted, provenance-verified worker transport wired to
public `respond_ui`, validated notification dispatch, and the actual #48 Stop
coordinator before product use. `requestStop(reason)` is that injected coordinator
boundary, not a claim that a new Native method exists or that an `abort` ack is
quiescence. Dedicated host tool/URI execution adapters, source-event presentation,
real timer/worker races and the final matched tuple are not delivered here.

Validation on Bun 1.4.4 (`38afee6c8`) and Node 24.22.1:

- The guarded public Client Connection/Remote path through the upstream Host
  Typert Gateway and Broker to the synthetic Native boundary passes 14 fixtures
  with 80 assertions.
- A shared barrier releases two request arrivals from independently bound
  synthetic Peers. One matching answer reaches the Native boundary, and the
  losing Remote returns stale while the winner's acknowledgement is held. After
  acknowledgement, the winner returns answered and both pending views are empty.
- The fixtures also cover invalid answers, cross-page delivery, refresh,
  Native-invalid redelivery, absolute deadlines, timer-late admission, all-page
  disconnect, explicit and Native cancellation, credential and scope revocation,
  lost acknowledgement, startup scope, tool/URI separation and worker replacement.
- RED before GREEN: missing Broker import; duplicate expiry Stop; lost-ack Stop;
  held-ack timer expiry; revoked-view result application. Each failed at the
  intended public seam before its implementation fix.
- Strict whole-repository TypeScript and `git diff --check` pass. No generated
  Native schema, dependency, build, Native source or pin change. The new typed
  Host Remote contribution is source only.
- Existing pure S0 Bridge/public Remote regression: six tests, 28 assertions pass
  under the same no-provider preload; no real Native or HTTP listener was started.

Run the fixture explicitly in its own Bun invocation; its `.fixture.ts` name keeps
the process-global pre-import guard out of the ordinary shared test discovery:

```sh
env -i HOME="$fixture_home" PI_CODING_AGENT_DIR="$fixture_profile" TMPDIR=/tmp \
  BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 PATH="$approved_bun_bin:/usr/bin:/bin" \
  "$approved_bun_bin/bun" test --no-env-file \
  --preload ./compatibility/omp/fixtures/no-provider.ts \
  ./tests/interactions/broker-remote.fixture.ts
```

The caller creates disposable fixture home/profile directories first. The fixture
then creates a second temporary TOP containing synthetic HOME/profile/cwd/tmp
before importing the public Client/Host graph. It installs the existing no-provider
guard and an import/runtime guard rejecting Native/SDK/FFI, sockets, listening and
process creation. The fetch transport composes Request/Response envelopes in
memory. No actual Native, Agent, worker, Host listener, browser, network/provider,
FFI, process, or kernel runtime is exercised. This is complementary source/fixture
evidence, not real simultaneous browser/Native or full #47 acceptance.

## Isolated Linux Chromium verification

On Host candidate `669d1c76d03c2c17e17da54fbd35818b73b41652`, Linux Chromium
`156.0.8078.79` ran two independent browser contexts with distinct issued
credentials. Each used the pinned DSH Connection and Gateway to register a
live `$events` stream and invoke the generated Broker Remote over loopback.
The two answers arrived concurrently. One reached the synthetic Native
port, and the other returned stale before the acknowledgement was released.
After release, both views had cleared the completed card.

Closing one page invalidated that page's Remote admission before reconnect.
The replacement page registered a new ready client and received a fresh
delivery for the same pending question with the original deadline. Its old
delivery stayed stale. The unaffected page remained authorized. The fixture
recorded zero worker launches and zero Stop requests. It uses a synthetic
Native port and a minimal browser page, so the evidence covers this isolated
carrier. Shared-cookie operation in a product browser and the composed UI
require separate verification.

| Evidence | Identity |
| --- | --- |
| Reviewed Host tree | `4b434c9bbfa03895df3edf6a26ea750e1b03fd5b` |
| DSH source target | `d05468939bcb06446ace47045d138f716406c788` |
| DSH source input manifest SHA-256 | `aa03d966ef697d27a0817eececff6dfaf0b4125a369ea7ab47eac5af700b1539` |
| Browser client bundle SHA-256 | `41537312d88fa027173877a4b7059728b09c45231f3be8621e422d385cea7588` |
| Chromium executable SHA-256 | `ce1ff960ce428a4a88b1b1c38516bdf1954a57fc24036161b7a0d8d0f8aec511` |
| Validated fixture result SHA-256 | `71f441d55c667dafa571103def0e88f1e581fb2d535565997a0e66a6faf68fa4` |
