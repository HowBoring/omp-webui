# Interaction Broker source vertical (#47)

Status: SOURCE / public Remote fixture only. This does not admit private Sessions,
complete #47, or satisfy its #46/#41 dependencies. Linux product-browser and real
Native evidence are pending; actual Windows Chrome/WSL2 is deferred by the owner.

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

- Public Client Connection/Remote → real Host Typert Gateway/service → Broker →
  injected generated Native boundary: 12 passing fixtures, 68 assertions.
- Held Native acknowledgement with simultaneous two-page answers; invalid answer,
  cross-page delivery, refresh, Native-invalid redelivery, absolute deadline,
  timer-late admission, all-page disconnect, explicit/native cancellation,
  credential and scope revocation, lost acknowledgement, startup scope,
  tool/URI separation and worker replacement.
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
