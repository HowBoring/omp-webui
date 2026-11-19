# Authenticated synthetic Workspace acceptance component

## Current acceptance, 2026-11-19

This remains an **isolated component**. The normal Host imports neither this executable nor its Workspace Remote
contribution; authenticated private API requests still return `PRIVATE_CAPABILITY_GATE_CLOSED`. Parent #29
Decision 26 permits isolated component integration; it does not admit private Sessions, establish a global OMP
installation or close #43/#29.

Against integration `2560f24c` with the current OMP 19 candidate (`57771ae5…`) and DSH c0 closure, the harness passed
12 real Chromium scenarios across three real Host process starts: catalog partial/error mapping, every native page,
canonical grant review/confirm/revoke, descendant/prefix/symlink/unknown/missing cwd rights, CSRF and origin denial,
closed history/open/execution entry points, SIGKILL restart credential and grant persistence, directory replacement
losing rights, and an unchanged native inode/mtime/content manifest. Current tuple, hashes and check results:
[current tuple](evidence/current-2560f24c/tuple.json) and
[browser evidence](evidence/current-2560f24c/browser.json). The affected suites reported 74 tests, 1058 assertions and
20 files with one `strace`-dependent skip. The full suite, performance and Windows/WSL2 were not run.
Source-only checks remain in [source evidence](../../docs/implementation/ticket-43-source-evidence.json).
`before-rebase-2842168/`, `before-review-fix-8157865/`, `review-fix/`, `tuple.json`, `linux-browser.json` and
`native-trace.json` are preserved historical `4764…`/`dcc2…`/c0 output, not current-combination acceptance.

## Fixture and procedure

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
The separate registered-reference panel is labelled synthetic metadata input and calls actual public descriptions.
The isolated Session carrier uses its SQLite Session Index for the same registered-page Remote. The normal Host
never imports this executable.

The verified run used Bun 1.4.4 and the fixed Node/Corepack tools from `compatibility/README.md` on PATH, starting from
the already prepared compatibility closure. The ordering below documents this combination; the preparation commands
were not rerun in this ticket, and changing the pinned candidate still needs separate admission and freshly matched
evidence:

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
