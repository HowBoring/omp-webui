# Authenticated synthetic Workspace acceptance component

## Source reconciliation, 2026-11-17

This is an **unregistered source component**, reconciled with integration `acc50ff4b45ab5419f27211a5c483f9618c0d00f`.
The normal Host imports neither this executable nor its Workspace Remote contribution; authenticated private API
requests still return `PRIVATE_CAPABILITY_GATE_CLOSED`. Parent #29 Decision 26 permits this source-only integration;
it does not admit private Sessions, establish a global OMP installation or close #43/#29.

The browser/native records under `evidence/` are preserved historical results from the earlier `4764…` native source,
`dcc2…` schema and c0 DSH tuple. They were not rerun after reconciliation. Integration's generated identity and DSH
source patch set have since advanced; the old tuple is not current-combination acceptance or a current enrollment.
See [current source verification](../../docs/implementation/ticket-43-source-evidence.json) for pure filesystem/SQLite,
in-memory public DSH, strict TypeScript and normal Host compile results. No current Workspace browser/native build,
installation, listener or process acceptance is claimed.

## Historical fixture and procedure

This explicit executable uses real Linux Chromium, fixed DSH Connection/ClientRemote/Gateway/Peer/`$events`, Bun,
#42 owner login/CSRF and an external actual OMP readonly catalog candidate. It is separate from the product Host.
Only the fixed synthetic HOME `vendor/workspace-fixture` and locally fixed sources are available. Browser directory
grants cannot select a profile, native source, executable, argv, environment or arbitrary RPC method.

The browser builder uses shared `BuildIdentities`, `assetIdentities` and `sha256`, while independently verifying the
actual resolved DSH root against the complete c0 candidate. The authenticated event carrier remains local because
the shared carrier has no credential attachment/per-message revalidation hooks.

The public DSH `installConnection` fetch hook adds only the Host CSRF header; stock envelopes, schema validation,
correlation, HTTP, native browser Cookie/WebSocket and mux logic are unchanged. There is no private instance override.
The page presents canonical preview + explicit confirmation + revoke, durable grant status, native pages grouped by
cwd within that page, current cwd rights, native ownership and partial/error states. All content uses `textContent`.
The separate registered-reference panel is labelled synthetic metadata input and calls actual public descriptions;
real Session Index registration and protected open remain #44. The normal Host never imports this executable.

The earlier matched fixture used Bun 1.4.4 and fixed Node/Corepack tools from `compatibility/README.md` on PATH.
The following is its historical procedure, not a verified procedure for the reconciled combination or authorization
to build, enroll or launch an actual OMP candidate. Such work needs separate admission and freshly matched evidence:

```sh
bun run compat:prepare --reset
bun run compat:build
bun scripts/build-compatibility.ts --check
bun run dsh:prepare
bun run dsh:link
bun run diagnostics:build
bun run workspaces:fixture-data
bun run workspaces:build
bun scripts/enroll-candidate.ts --workspace-component
python3 tests/workspaces/browser.py
```

The browser script owns startup, graceful Host process restarts, an actual synthetic native lock holder and cleanup.
It obtains bootstrap links through the local `--print-bootstrap` control, never writes secrets to evidence, and checks
unchanged native inode/mtime/content manifests. The fixed listener is `http://127.0.0.1:3182`; do not run another
component on that port. Full startup closure hashing/preflight is outside usable-screen timing and may take minutes
on the shared development filesystem; the functional harness permits 180 seconds per startup. This is not S5
performance acceptance. Stop the Host before rebuilding or re-enrolling its source/assets/closure.

For manual use, `bun run workspaces:component` starts the same fixed executable. In a separate trusted local terminal,
`bun --no-env-file vendor/host-workspaces/workspace-component-main.js --print-bootstrap` emits a fresh one-use login
link. Never put that output into normal logs, a browser test trace, screenshots, repository files or a chat response.

`workspaces:fixture-data` replaces only the owned ignored synthetic profile: 40 generated native Sessions, two actual
SessionManager-authored files, custom unknown/missing/child/prefix/symlink cwd cases, corrupt metadata and an invalid
source. It deliberately authors a separate 35-record synthetic Session Index input from native public metadata,
including verified, replaced, missing, source-unavailable and invalid references. No transcript or tree is copied.

Historical and current scopes: [#43 component report](../../docs/evidence/ticket-43-workspaces.md).
Windows Chrome/WSL2 remains owner-deferred. Product admission and whole-ticket closure remain blocked on #41,
with registration, protected open and worker revocation composed in #44; source-only integration is permitted.
