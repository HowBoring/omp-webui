# OMP WebUI

An RPC-first browser interface for [Oh-My-Pi](https://github.com/can1357/oh-my-pi), built around the [DeepSeek Harness Web Client](https://github.com/deepseek-ai/deepseek-harness).

OMP remains the only Agent Runtime. This repository owns the Web Host, OMP RPC process lifecycle, DSH Remote compatibility layer, and small OMP-specific DSH client extensions.

> **Project status: scaffold / M0.** The initial commit establishes the architecture and development baseline. The health endpoint works; the DSH Gateway, OMP RPC transport, Session projection, and browser UI are not implemented yet.

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

See [the architecture](docs/architecture.md), [ADR 0001](docs/adr/0001-rpc-first.md), and [upstream compatibility notes](docs/upstream-compatibility.md).

## Non-negotiable boundaries

- **RPC-only OMP integration.** The Host starts OMP as an external process using `--mode rpc-ui` and communicates through the public JSONL RPC protocol. It must not import OMP Agent SDK internals, `AgentSession`, `SessionManager`, or private runtime modules.
- **DSH is the browser protocol and UI source.** Reuse the pinned DSH Web Client and implement the Remote/Connection contract it consumes. Do not introduce a parallel browser protocol.
- **OMP owns durable state.** Session files, message history, branches, tool execution, and Agent state remain OMP-owned. Host state is derived, transient, or explicitly WebUI-specific.
- **No silent semantic flattening.** OMP's tree-shaped history must be projected into DSH's conversation journal without mixing abandoned branches into the active conversation.
- **No unauthenticated network exposure.** The initial Host binds to loopback only. Remote access requires an explicit security design.

## Upstream baselines

The exact upstream commits used for the initial compatibility review are recorded in [upstreams.lock.json](upstreams.lock.json):

- OMP `18.20.2` — `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`
- DSH `0.2.2-rc.3` — `39163dd30f703a79079e2d2446545cff3c453738`

These are review baselines, not a promise that every upstream capability is already integrated. Update pins deliberately and rerun compatibility checks before changing them.

DSH source/release versions are not npm package versions: the reviewed source and latest prerelease are
`0.2.2-rc.3`, while npm latest is `0.0.1-rc.5` for `@deepseek-ai/dsh-web-frontend` and
`0.0.1-rc.1` for `@deepseek-ai/dsh-client-web`. No OMP or DSH runtime dependency is installed by this scaffold.

## Development

Requirements:

- Bun `>=1.4.4` for the Host.
- OMP installed and available as `omp` for future RPC integration tests.
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
