# Ticket #43 — isolated authenticated directory/Workspace component

This is component evidence on integration `2118454e02ac1e5db40847fec62f812308698309`, after merging the accepted
#31 native catalog and #39 DSH patches. Product admission, integration/closure and global installation remain
**BLOCKED on #41**. Protected open/registration persistence and Session worker revocation compose in #44.
The final integration refresh changes only catalog build/provenance tests; all consumed Workspace/Host/OMP/client
inputs are unchanged from the recorded build on `9d5e5eb`. Current strict typecheck and the new catalog provenance
tests are rerun after that merge. The default Host is unchanged and continues to deny private Session capabilities.

The implementation adds canonical directory preview, explicit single-use confirmation, durable grant/revoke,
current path-segment authorization, readonly native catalog mapping and a separately paged readonly Session Index
metadata input. Native metadata/history ownership remains OMP's; no Host Session-file parser, shadow transcript,
private OMP SDK/runtime, DSH private instance, raw RPC tunnel or new Agent is introduced. See
[the component contract](../../packages/workspaces/README.md) and [runbook](../../apps/workspaces/README.md).

## Boundaries and safety

- Browser grant operations never configure native sources/profile/executable/argv/environment. The isolated entry
  fixes a synthetic HOME and custom Session Sources locally. Source IDs and profile remain unchanged by grants.
- Directory identity includes canonical path, device/inode/birth time, with fresh realpath/stat checks. Descendants
  use path segments. Prefix siblings, escaping symlinks, missing/unknown cwd, preview replacement, root replacement,
  stale preview, repeated confirmation and durable-state loss are explicit failures or denied permission states.
- Private SQLite uses owner-only modes, FULL synchronous transactions and atomic statement/transaction commits.
  Grants/revokes survive actual process restart. Credentials remain #42's absolute 30-day authority. Revocation
  during a pending body is checked again before invocation; a concurrent revoke during native descriptions is
  reflected across the entire published page. Connection generation loss rejects delayed client render results.
- Authentication/Host/Origin/CSRF admission occurs before Remote body parsing. Each HTTP method uses the real DSH
  ClientRequest/ServerResponse envelope, typed Remote descriptors/results and Gateway invocation. Public Connection
  fetch hooks add only CSRF; stock Cookie/WebSocket, Peer and `$events` mux remain unchanged. One frame/body is
  bounded at 16 KiB; 32 concurrent Remote requests, eight Peers, one event stream per Peer, 32 native/index page items,
  32 previews with 60-second absolute expiry and 256 persistent grants are explicit caps. Native scan/snapshot/page/
  cursor/error budgets remain the accepted [catalog bounds](../../compatibility/CATALOG.md).
- Discovery never registers/opens/creates a Session. Cwd headings are explicitly page-local observations, not global
  Workspace counts. All open/history/execution actions remain blocked even with a valid grant. A separate readonly
  SessionIndexReader lets #44 supply real retained references later; only explicitly authored synthetic metadata is
  used to exercise its browser panel here. Errors never appear as an empty successful index.

## Executed checks

The confirmed seams are spec #29 Testing Decisions 1–3: real authenticated browser/DSH/Bun/public native RPC,
plus public module/RPC fault boundaries. Initial grant persistence and replacement cases were red before green.
No new seam approval was needed.

- `bun run check`: PASS, 116 tests, 944 assertions, strict typecheck and normal Host build on the combined tree.
- `bun test tests/workspaces`: PASS, seven tests/32 assertions after final mapping/request hardening, including
  actual native descriptions across a concurrent revoke and a public HTTP body/credential revocation fault.
- `bun scripts/build-compatibility.ts --check`: PASS; accepted OMP source/schema remain unchanged.
- `bun run workspaces:build` and `bun run diagnostics:build`: PASS against the complete accepted DSH source identity,
  reusing the immutable reviewed #39 compiled artifacts. Workspace has 239 browser source inputs; Host has 256.
- `BUN_EXECUTABLE=... python3 scripts/trace-catalog.py`: PASS on actual SessionManager-authored isolated native files.
  Final trace has 229 lines, zero writes/ordinary runtime imports, zero listener binds, zero non-Unix connects,
  two readonly native lease observations and one exec. Actual framing is ready + three correlated responses.
- `python3 tests/workspaces/browser.py`: PASS, 12 scenarios, 47 discovered rows, 35 explicit synthetic registered
  references, 38 real DSH Remote calls and zero page errors. Actual Linux Chromium 156.0.8078.79 + Bun 1.4.4
  passes SIGKILL Host restart with unchanged absolute credential/grant, native readonly child exit, canonical-root
  replacement denial, explicit revoke + second process restart, unchanged native manifests, actual native cursor
  error and a separately labelled wrong-correlation carrier fault. All owned processes are stopped. See
  [the complete browser result](../../apps/workspaces/evidence/linux-browser.json).
- After merging latest integration `2118454`, strict typecheck and its added catalog provenance/build tests PASS
  (two tests/32 assertions). That merge changes no enrolled component runtime/client input.

Exact source/patch/schema/runtime/client/Host/installation identities are in
[tuple.json](../../apps/workspaces/evidence/tuple.json); the [native syscall summary](../../apps/workspaces/evidence/native-trace.json)
records the raw ignored trace digest. Raw bundles, installation manifest, per-input build manifests, screenshot,
logs and native trace remain under ignored `vendor/`. No provider/model or real profile/global installation was used.

## Scope and reproducibility notes

The native fixture has 47 discovered rows, including two actual SessionManager-authored files and explicit
unknown/missing/descendant/prefix/symlink cwd cases, malformed native metadata and an invalid custom source.
The separate 35-record synthetic Session Index input is metadata only: valid/held, replaced, missing,
source-unavailable and invalid-reference native description outcomes are exercised without pretending that
registration/open/persistence is already implemented. All successful discovery pages remain reachable.

Initial harness runs exposed an overly short 60-second full-closure startup wait, repeat-run grant state assumptions,
unsupported `/proc/.../children` insufficient UI waits before asynchronous revoke completed, and a string predicate blocked by strict CSP. The harness now
permits 180 seconds for first-start verification, explicitly revokes prior synthetic grants through the owner UI,
uses `ps` for owned-child discovery and function predicates to wait for rendered rights/list outcomes while preserving CSP. No identity check was relaxed.
These failed runs are not counted as acceptance passes.

An unnecessary owned upstream build attempt passed native/Typert/Host compile/bundle gates, then failed the Desktop
bundle's symlinked pnpm task-state check. Earlier restricted IPC/cache configuration attempts also failed. Final
component builds consume the already reviewed exact #39 compiled closure, independently checking the complete
candidate source and rebuilding the changed component; no fresh full upstream artifact gate pass is claimed.
The owned unused DSH clone has no unique authored changes; its exact c0 source is retained for negative provenance
tests. After checking final imports/build manifests/processes, 331 unused generated directories were removed,
preserving all final assets/evidence/manifests and every shared source/dependency/store/symlink target.

Formal reference-hardware scale/performance, real providers, global product installation and complete MVP workflow
acceptance are NOT RUN here. Windows Chrome/WSL2 remains explicitly owner-deferred. Worker cleanup on directory
revocation is BLOCKED on #44; the only native child here is the readonly catalog process, never an active Session.
