# OMP WebUI

An RPC-first browser interface for [Oh-My-Pi](https://github.com/can1357/oh-my-pi), built around the [DeepSeek Harness Web Client](https://github.com/deepseek-ai/deepseek-harness).

OMP remains the only Agent Runtime. This repository owns the Web Host, OMP RPC process lifecycle, DSH Remote compatibility layer, and small OMP-specific DSH client extensions.

> **Project status: scaffold / M0.** The initial commit establishes the architecture and development baseline. The health endpoint works; the DSH Gateway, OMP RPC transport, Session projection, and browser UI are not implemented yet.

The accepted MVP plan is recorded in [OMP WebUI 可用 MVP：原生会话发现与历史导航决策地图](https://github.com/HowBoring/omp-webui/issues/14)
and the [acceptance and implementation handoff](docs/mvp-acceptance-and-handoff.md).
The handoff fixes compatibility gates before successive real integration slices, Linux Chromium and
Windows Chrome/WSL2 acceptance, and initial scale/performance targets. These targets remain unvalidated;
planning completion does not certify the health-only runtime as a usable MVP.
The agreed MVP includes existing TUI Session discovery/import, a persistent reference index grouped by working
directory, manual recovery after the previous process exits, tree viewing, same-Session history navigation,
and branching from a historical user message into a new Session. These capabilities remain unimplemented.
The [catalog contract](docs/session-catalog-contract.md) records the confirmed discovery, registration
and occupied-Session behavior; its required public OMP extensions remain pending.
The Host will use a local Bun transport over OMP's public decoder/wire/schema capabilities;
see [ADR 0004](docs/adr/0004-local-public-rpc-transport.md) and the [transport contract](docs/rpc-client-contract.md).
The [client composition](docs/client-composition.md) retains the DSH foundation with a small public
navigation/action seam and OMP modules. New image/file input is required for the MVP, alongside
Session-local model/thinking selection and WebUI appearance/language preferences; these remain unimplemented.
The [public Client policy experiment](docs/dsh-policy-validation.md) now passes isolated patched/baseline
checks; its patch and fixture assets remain on a separate experiment branch, without product runtime integration.
The [local access policy](docs/local-access-contract.md) remembers browser authorization for 30 days,
allows explicit persistent directory grants in the WebUI, and confines uploads to dedicated staging.
The normal Host supplies persistent browser login while private capabilities remain gated.
The [Workspace component](apps/workspaces/README.md) supplies isolated grant/catalog source and historical fixture
evidence. Its current [source verification](docs/implementation/ticket-43-source-evidence.json) leaves Workspace
registration in the normal Host absent and private capabilities gated; it does not establish complete #43 acceptance.
The accepted [history interaction contract](docs/history-interaction-contract.md) separates tree selection,
same-Session navigation and new-Session branching, with explicit confirmation, unsent drafts and a
stop-then-wait flow. Its disposable prototype is evidence for the interaction decision, not RPC integration.
The [Interaction lifecycle policy](docs/interaction-lifecycle-contract.md) permits the first valid answer
from any authorized page, preserves work across ordinary browser disconnects, and rejects busy queue input.
It defines cancellation and shutdown budgets; native timed-ask cancellation still requires a public RPC guarantee.
The accepted [RPC delivery policy](docs/rpc-delivery-contract.md) uses a pinned public compatibility build
and the user's **global OMP installation**, subject to exact artifact/schema/behavior verification.
The MVP supports one validated combination; the compatibility build and global-install verification remain pending.
The [attachment contract](docs/attachment-contract.md) records accepted original retention, quotas,
deletion, per-tab draft recovery and complete preparation before prompt admission, with explicit acceptance
of content-affecting degradation. Storage, public RPC guarantees and browser integration remain unimplemented.
The [projection contract](docs/projection-contract.md) retains folded older native history, permits
explicit view-generation rebuilds from persisted facts, and requires durable native navigation positions.
Coherent OMP history/live observation and a public DSH journal-rebuild seam remain delivery gates.

## Architecture at a glance

~~~mermaid
flowchart TB
  Browser["Browser · DSH Web Client"]
  Host["OMP Web Host<br/>Bun + TypeScript"]
  Gateway["DSH Remote Compatibility Gateway"]
  Registry["Session Registry / RPC Supervisor"]
  Projection["Session Event Projection"]
  Broker["Interaction Broker"]
  A["OMP RPC Worker A<br/>rpc-ui / JSONL v2"]
  B["OMP RPC Worker B<br/>rpc-ui / JSONL v2"]
  Store[("OMP native session storage")]

  Browser <-->|"DSH Connection + Gateway streams"| Host
  Host --> Gateway
  Gateway --> Registry
  Registry --> Projection
  Registry --> Broker
  Registry <-->|"stdio"| A
  Registry <-->|"stdio"| B
  A --> Store
  B --> Store
~~~

See [the architecture](docs/architecture.md), [RPC-first ADR](docs/adr/0001-rpc-first.md),
[MVP scope ADR](docs/adr/0002-native-session-mvp.md), and [upstream compatibility notes](docs/upstream-compatibility.md).

## Non-negotiable boundaries

- **RPC-only OMP integration.** The Host starts OMP as an external process using `--mode rpc-ui` and communicates through the public JSONL RPC protocol. It must not import OMP Agent SDK internals, `AgentSession`, `SessionManager`, or private runtime modules.
- **DSH is the browser protocol and UI source.** Reuse the pinned DSH Web Client and implement the Remote/Connection contract it consumes. Do not introduce a parallel browser protocol.
- **OMP owns durable state.** Session files, message history, branches, tool execution, and Agent state remain OMP-owned. Host state is derived, transient, or explicitly WebUI-specific.
- **No silent semantic flattening.** OMP's tree-shaped history must be projected into DSH's conversation journal without mixing abandoned branches into the active conversation.
- **No unauthenticated network exposure.** The initial Host binds to loopback only. Remote access requires an explicit security design.

## Upstream baselines

The exact upstream commits used for the initial compatibility review are recorded in [upstreams.lock.json](upstreams.lock.json):

- OMP `18.20.2` — `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`
- DSH `0.2.2-rc.3` — tag `dsh-v0.2.2-rc.3`, commit `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`

These are review baselines, not a promise that every upstream capability is already integrated. Update pins deliberately and rerun compatibility checks before changing them.

DSH is pinned to the latest official published release, including prereleases, checked on 2026-11-15.
The exact release commit is authoritative for builds; do not resolve floating `master` or npm `latest` at build time.

DSH source/release versions are not npm package versions: the reviewed source and latest prerelease are
`0.2.2-rc.3`, while npm latest is `0.0.1-rc.5` for `@deepseek-ai/dsh-web-frontend` and
`0.0.1-rc.1` for `@deepseek-ai/dsh-client-web`. No OMP or DSH runtime dependency is installed by this scaffold.

## Development

Requirements:

- Bun `>=1.4.4` for the Host.
- A global OMP installation matching the verified delivery combination for future RPC integration;
  an ordinary `omp` name or the unmodified official baseline alone is insufficient for the full MVP.
- Node.js `>=24.9.0` and pnpm `11.28.5` only when building the pinned DSH upstream client.

~~~bash
bun install --frozen-lockfile
bun run dev
~~~

The scaffold listens on `http://127.0.0.1:3180`. At this stage only `GET /healthz` is implemented;
unimplemented `/api/` routes return `501` and other paths return `404`. Health success indicates only Host liveness.

~~~bash
bun run typecheck
bun test
bun run check
bun run build
bun dist/main.js
~~~

The lockfile pins the tested development dependencies. `check` runs type checking, tests, and the Bun build.
Recorded local results and remaining M0 integration work are in [M0 validation](docs/m0-validation.md).

## Repository layout

- `apps/host` — Bun HTTP/WebSocket Host and runtime composition.
- `packages/contracts` — versioned OMP RPC and DSH Remote contract boundary.
- `packages/client-extensions` — OMP-specific DSH client modules/slots.
- `docs` — architecture, decisions, upstream compatibility, and roadmap.
- `tests` — protocol, integration, and browser acceptance tests.

DSH source checkouts and generated bundles belong under ignored `vendor/`; they are not committed. The initial scaffold vendors no third-party source.

## License

MIT. See [LICENSE](LICENSE).
