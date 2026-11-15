# DSH navigation and action-policy experiment

Completed isolated prerequisite for [DSH 导航与能力接缝：自动创建及动作门禁实证](https://github.com/HowBoring/omp-webui/issues/27), 2026-11-16 (Asia/Singapore). This branch is experimental evidence; it is not merged into the product runtime.

The public Client extensions are feasible on the fixed DSH source without rewriting Conversation, fabricating non-owner grants, hiding controls with CSS, or replacing private navigation instances. The [patch](dsh-public-client-policy.patch), [manifest](manifest.json), [source identity](evidence/source-identity.json), and [review](review.md) identify exactly what was tested. Production remains the health-only Bun scaffold.

## Observed comparison

Both runs use the same synthetic workspace, history and owner baseline, public module registry, real browser Client modules, Connection envelopes and Gateway mux. They never start DSH Agent Host, a model, OMP, or user Sessions; they never read user configuration/history.

| Path | Pristine DSH | Patched Client |
| --- | --- | --- |
| Startup with a workspace | Implicit `session/create` | Zero create/retain/history-open before explicit Open |
| Refresh with a stale saved selection | Standard automatic behavior | No fallback create or retain |
| Discover/select/register | Fixture commands are separate | No implicit directory grant or Session creation |
| Explicit Open | Fixture-gated identity | Requires fixture registration and explicit grant; opens existing history without create |
| Rename | Menu and configured physical shortcut remain actionable | Menu absent; title double-click and shortcut do not open dialog |
| Fork/archive/pin | Standard operation set | Built-in actions filtered; Controller executors refuse direct calls |
| Busy input | Queue prompt accepted | Queue, steer and real composer reject; draft restored and editable |
| Stop / idle input | Standard verbs | Cancel reaches Connection; idle send succeeds |
| Explicit New | Standard creation | Exactly one create, no prompt automatically sent |
| Startup UI before Session acquisition | Fixture overlay | Root overlay works with zero retained Sessions, across two pages, cancellation, stale replay and reconnect |

The final [baseline](evidence/baseline/browser.json) and [patched](evidence/patched/browser.json) reports both pass with no page or console errors. Traces contain requests, results and mux frames; screenshots show [root startup](evidence/patched/startup.png), [available menu](evidence/patched/supported-menu.png) and [busy draft](evidence/patched/busy-draft.png). These are fixture observations, not native OMP results.

## Public interfaces in the patch

- `WebBootEntry.config` is a JSON object delivered to the browser plugin through the real Cordis Loader. Omission preserves defaults. Configuration survives code replacement; a changed configuration for an existing entry rejects synchronization and requires reload. Host plugin Config is not forwarded implicitly, and graph `inject` edges do not sequence service activation.
- Session Controller Client Config accepts `disabledActions` (`create`, `prompt`, `rename`, `fork`, `queue`) and `allowPromptWhileRunning`. It freezes the selection and enforces refusal before Remote calls, including queued-message steering. Local refusal codes are `client/session-action-unavailable` and `client/session-busy`; these are newly added Client failures, not OMP RPC APIs.
- Workspace Controller Client Config accepts `disabledSessionActions: ['archive', 'pin']`. Its public archive/unarchive and pin/unpin verbs enforce the selection and expose a typed `client/workspace-action-unavailable` error.
- Workspace UI Client Config accepts `navigationMode: 'external'`. External activation requires the public `workspaceNavigation` service. Its `request()` receives separate `restore`, `workspace` and `new` requests with an `AbortSignal`. The provider owns target validation, errors and explicit creation; it must check the signal before opening or preparing drafts. Explicit navigation before catalog readiness supersedes startup restoration. Missing provider means no automatic fallback.
- In external mode, `openWorkspace()` completes dispatch, not the provider's asynchronous work; `connectWorkspace()` refuses automatic connection. Explicit `ctx.sessions.create()` and `uiWorkspace.openSession()` remain separate operations. Built-in menu, row-action, double-click and shortcut paths consume Controller availability without changing Remote owner permissions.

Client policy is not a security boundary. A malicious page or plugin can call Remote directly; production Host authorization, capability enforcement, busy admission and revocation remain required.

## Verification and limits

The affected upstream Client suites, artifact build, aggregate type checks, changed-source lint, typed UI copy, translation pairs and type-equivalent documentation checks are recorded in [evidence](evidence/). Regression tests first failed for busy prompt, disabled rename, external restoration, busy queued steering, early explicit navigation, boot configuration and public Workspace denial; the final suites pass.

The browser runs Linux Chromium 156 with an explicitly emulated `navigator.platform = Win32`, public `Shortcuts.edit()` preferences, and Playwright keyboard dispatch. The reports record effective bindings. This proves the tested configured Web profile, not native Windows OS/hardware delivery. Fixed upstream Linux Web has no Workspace shortcut defaults and admits only three limited combinations; Linux browser key support and the first supported browser matrix remain product gates.

The two-page test accepts one reply and then rejects a stale replay. It does not stress simultaneous replies. The test-only `probe/*` endpoints and root notification use public Connection/Gateway infrastructure with fixture-owned data; they are not proposed product Remote names or a validated OMP startup interaction schema. Production requires generated Remote contributions and the actual public RPC extensions/Broker contracts.

Directory authorization and native-reference registration are in-memory fixture flags. Their persistence, authentication, path containment and revocation are not implemented here. Stop uses the stock DSH cancel verb; it does not prove the accepted queue-withdrawal/quiescence/deadline/force-termination policy. Session running observations are Client mirrors; Host admission remains authoritative.

No attachments, native tree/rewind/navigation, actual global OMP compatibility build, native Session identity/readback, native-data upgrade/rollback, complete Interaction Broker, final plugin roster or Bun Host integration is certified. Full upstream `test:web`, full `test:gui`/Host suites and release CI were not run: this ticket authorizes isolated fixtures and excludes DSH Agent Host/model execution. This patch is not an upstream release certification.

## Reproduce

Prerequisites: Node 24.22.1, Corepack pnpm 11.28.5, Python with Playwright, and Chromium. Keep checkouts and evidence in disposable directories. The project itself continues to use Bun/TypeScript; pnpm belongs to this external DSH build.

1. Obtain DSH from `https://github.com/deepseek-ai/deepseek-harness` at `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`. Keep an unmodified built checkout for the baseline. Install with `corepack pnpm install --frozen-lockfile --ignore-scripts`, then run `corepack pnpm run build:artifacts --serial`.
2. In a separate checkout at that same commit, apply `dsh-public-client-policy.patch` with `git apply --index`, and verify `git write-tree` equals `be590b5411230c215158bb6359635d409a653523`. The patch changes one lock importer for a workspace dependency. A frozen install must remain successful.
3. Commit the patched tree locally, then build with the same install/build commands and run `corepack pnpm run build:check`. [Build environment records](evidence/patched/client-build-environment.json) and per-file [artifact digests](evidence/patched/artifacts.json) identify this experiment's outputs. A new Git build label can change output digests; record new digests and revalidate rather than reusing this run's identity.
4. Run `python verify-client.py DSH_CHECKOUT EVIDENCE_DIR` from this directory. It selects only the affected `.client.spec.*` files and writes the actual command and result. It never selects Host/model replay suites.
5. Run `node host.mjs DSH_CHECKOUT EVIDENCE_ROOT/patched` and, separately, the same command with the pristine checkout and `EVIDENCE_ROOT/baseline`. The HTTP servers bind loopback and print their owned PID/port. They supply synthetic fixture data only.
6. Run `python browser.py EVIDENCE_ROOT patched` and `python browser.py EVIDENCE_ROOT baseline`. Use new servers/empty evidence directories for each complete run. Stop each owned fixture server with SIGTERM afterward; it writes the final call trace.

No DSH source tree or compiled bundle is stored here. The patch retains DSH's MIT source provenance; [upstream LICENSE](https://github.com/deepseek-ai/deepseek-harness/blob/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/LICENSE) remains authoritative. Fixture code is covered by this repository's MIT license.
