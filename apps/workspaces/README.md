# Authenticated synthetic Workspace acceptance component

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

With Bun 1.4.4 and the fixed Node/Corepack tools from `compatibility/README.md` on PATH:

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

Current evidence: [#43 component report](../../docs/evidence/ticket-43-workspaces.md). Windows Chrome/WSL2 remains
owner-deferred. Product admission/integration/closure remains blocked on #41, with worker revocation composed in #44.
