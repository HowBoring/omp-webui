# Repository instructions

## Mission

This repository provides a browser Host for Oh-My-Pi (OMP), reusing the DeepSeek Harness (DSH) Web Client.

The Host is an adapter and process supervisor, not a second Agent implementation.

## Non-negotiable architecture rules

1. **OMP integration is RPC-only.** Spawn the OMP executable and use its public JSONL RPC protocol. Do not import `AgentSession`, `SessionManager`, internal OMP runtime packages, or private SDK APIs into Host runtime code.
2. Use `--mode rpc-ui` for the interactive WebUI. Do not add `--no-ui` to the normal worker command.
3. Negotiate OMP RPC protocol v2 when the `ready` frame advertises support. Validate chunk metadata, frame sizes, UTF-8, and request correlation. Never assume responses arrive in request order.
4. OMP stdout is protocol-only. Read stderr separately for diagnostics. Never parse human-oriented CLI output from stdout.
5. A prompt acknowledgement is usually not completion. Synchronous builtin commands completing with `data.agentInvoked: false` have no later `prompt_result`; correlate other accepted prompts by that frame's request ID. Check `sessionSettled` or `session_settled` separately for quiescence.
6. OMP owns durable sessions and branch history. Do not create a second transcript database, edit OMP session files, or parse JSONL session files from the Host.
7. Do not equate OMP append order with the active conversation branch. The DSH Conversation projection must represent the active branch; the History view may represent the full tree.
8. Implement the current DSH Connection and Gateway Remote contract. Do not introduce a bespoke browser protocol or assume DSH streams are ordinary WebSockets.
9. Keep upstream DSH source and generated bundles out of Git. Pin exact commits in `upstreams.lock.json`; build them reproducibly under ignored `vendor/`.
10. If a required OMP capability is absent from public RPC, document the gap and prefer an additive OMP RPC protocol change. Do not bypass RPC through OMP internals.

## Process and Session ownership

- Model one concurrently active top-level OMP Session as one supervised RPC worker.
- Multiple browser viewers of the same Session attach to the same worker; they do not create duplicate writers.
- Subagents remain owned by their parent OMP worker and use OMP's native subagent RPC surfaces.
- Treat `get_session_lease` as an ownership probe, not a lease reservation API.
- A Session already owned by another OMP process must not be force-opened.
- Worker startup, shutdown, restart, and child-process cleanup must be explicit and observable.

## Protocol correctness

- Keep OMP RPC wire types and DSH Remote types at explicit adapter boundaries in `packages/contracts`.
- Preserve IDs, timestamps, ordering, errors, cancellation, and binary attachment semantics.
- The DSH Session contract includes snapshots, cursors, projections, durable event records, and transient assistant-stream frames. Do not reduce it to a list of chat messages.
- Buffer live events while opening a history snapshot, then reconcile by durable OMP entry identity to avoid gaps and duplicates.
- Rewind, fork, compaction, retry, and session switching require explicit projection/replay tests.
- Unknown ignorable upstream events may be ignored according to the source contract; unknown non-ignorable events must surface as compatibility failures.

## Security

- Default bind is `127.0.0.1`; remote binding is disabled until authentication, Host/Origin validation, WebSocket admission, and CSRF protections are implemented and tested.
- Never expose worker stdin/stdout, arbitrary RPC commands, or file paths directly to an unauthenticated browser.
- Spawn child processes with an argument array, never shell interpolation. Validate cwd, session identifiers, and filesystem paths.
- Keep secrets out of logs, fixtures, tests, and commits. Do not log full prompt bodies or credentials by default.
- Enforce request body, frame, attachment, stream, and per-session resource limits.

## Engineering conventions

- TypeScript strict mode; avoid `any`, unchecked casts, and implicit protocol assumptions.
- Use repository TypeScript for editor diagnostics and apply Oxlint and the strict typecheck to TypeScript changes.
- Prefer small modules with explicit interfaces and one responsibility.
- Target 120 characters per line, 50 lines per method, cyclomatic complexity <=15, and nesting depth <=4.
- Keep public types documented where their semantics are not obvious.
- Use structured errors with stable codes at process and protocol boundaries.
- Tests must cover success, failure, cancellation, reconnect, and out-of-order completion for stateful protocol behavior.
- Add or update an ADR when changing an architectural boundary or upstream compatibility decision.
- Do not commit generated DSH bundles, local vendor checkouts, logs, credentials, runtime state, or personal scratch files.

## Commands

~~~bash
bun run dev
bun run lint
bun run typecheck
bun test
bun run check
~~~

The initial Host is only a health-check scaffold. Do not describe the DSH Gateway or OMP RPC integration as implemented until the corresponding end-to-end tests pass.

## Agent skills

### Issue tracker

GitHub Issues in HowBoring/omp-webui. Before publishing specs, tickets or
wayfinder maps, read docs/agents/issue-tracker.md.

### Triage labels

Use the five canonical labels mapped in docs/agents/triage-labels.md.

### Domain docs

Single-context: CONTEXT.md and docs/adr/.
Before domain exploration or design, read docs/agents/domain.md.
