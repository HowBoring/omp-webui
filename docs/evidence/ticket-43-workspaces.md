# Ticket #43 — isolated authenticated directory/Workspace component

## Current acceptance (2026-11-19)

Against integration `2560f24c460085c6597cf76f973bf3c23a580008`, with the current OMP 19 candidate (`57771ae5…`) and
the DSH c0 closure, the isolated component passed its full acceptance harness. Exact identities and check results:
[current tuple](../../apps/workspaces/evidence/current-2560f24c/tuple.json); verbatim run result:
[browser evidence](../../apps/workspaces/evidence/current-2560f24c/browser.json).

- `bun run typecheck` and `bun run lint` passed (only pre-existing warnings).
- Affected `bun test tests/workspaces tests/access tests/catalog tests/compatibility/{catalog-build,dsh-source,preflight,assets,source}.test.ts`:
  **74 tests / 1,058 assertions / 20 files**. The single skip is the `tests/catalog/catalog.test.ts:155` real-syscall
  fault test, which requires `strace`; `strace` is absent here.
- `python3 tests/workspaces/browser.py`: **all 12 actual Linux Chromium scenarios** across three real Host process
  starts, 47 native rows, 35 labelled synthetic index references, 40 typed DSH Remote calls and zero page errors.
- Actual SIGKILL restart restores the absolute browser credential and the persistent directory grant; the readonly
  native child exits on Host loss. Canonical-root replacement loses rights and reports `changed`; explicit revoke
  persists through a second actual restart; native cursor errors and a labelled wrong-correlation fault stay explicit
  and typed. The native inode/mtime/content manifest is unchanged and routine logs contain no bootstrap or CSRF value.
- Readonly and budget scope: grants live only in Host-owned SQLite and the harness proves no native write; native
  scan/page/response/snapshot/deadline budgets remain those in `compatibility/CATALOG.md`; the Host adds a 16 KiB
  request body, eight Peers with one `$events` stream each, 32-item registered pages, 256 grants and 32 previews.

Not run in this ticket: the full repository suite, performance, and Windows/WSL2. The normal Host still does not
register this component and keeps `PRIVATE_CAPABILITY_GATE_CLOSED`. Synthetic profile/index rows are labelled and are
not product evidence. #43 and #29 remain OPEN; #44 owns real registration, protected open and worker revocation.

## Source reconciliation, 2026-11-17 (historical source-only record)

Superseded by the current acceptance above; retained for the source-only merge record.
The reviewed source fix `3357e89426350caf9c77ca166878d78b87ce324a` now includes integration
`acc50ff4b45ab5419f27211a5c483f9618c0d00f` via own-branch merge `9b4ad362211c8a39d62719f7dafb013a4228ef0b`.
The merge was conflict-free and preserves both explicit Workspace and continuation fixture enrollment branches.
Parent #29 Decision 26 permits source components to integrate while semantic/private-data gates remain closed.
The earlier hold pending #41 still applies to product admission and whole-ticket closure, not this source-only merge.

Source-only verification on 2026-11-17: **42 tests / 206 assertions / 6 files**, strict repository TypeScript and
normal Host compile passed. Those tests used temporary Host-owned filesystem/SQLite and public DSH in-memory
fixtures; no actual OMP imports, worker/Agent starts, sockets, listeners, browser, Native/FFI, global install or
upstream builds ran. The second index test and HTTP admission/error tests were excluded there because they require
Native or real listeners. The normal Host source remains identical to integration, with
`PRIVATE_CAPABILITY_GATE_CLOSED` independently checked after login. No Workspace Remote is registered in the normal
Host. See [exact source verification](../implementation/ticket-43-source-evidence.json).

The JSON/browser/native records under `apps/workspaces/evidence/` other than `current-2560f24c/` are preserved
byte-for-byte as historical evidence from the older native source, schema and DSH tuple. They are not current
identities. The current-tuple PASS is recorded above; complete product, private-Session and global-install admission
remain unclaimed. #43 and #29 remain OPEN; #44 still owns real registration/protected open/worker revocation
composition. Windows Chrome/WSL2 remains explicitly owner-deferred.

## Historical reviewed component evidence

The earlier component included integration `d22a908b2b6b8a53093af70c347b92cc5e69869b` (#35 accepted), merged into
the isolated review-fix branch. Its recorded results below apply only to that matched component tuple.

## Error boundary review fix

The single P2 standards finding is repaired: authenticated, valid Workspace requests no longer turn domain/runtime
failures into malformed HTTP 400 responses. Envelope, endpoint, payload and method-argument validation finish first;
only decoded invocations produce correlated DSH `server-response` results. Known grant, directory, catalog, bounded
RPC, index and filesystem/storage codes use declared public `RemoteErrorDetailsMap` codes and the existing public
DSH `RemoteError` / Gateway failure serializer. Every error has a fixed sanitized message and empty details;
unclassified failures use `gateway/internal` / `Workspace request failed.`. Thrown messages, stacks, paths, native
output and arbitrary details are never serialized. No new browser protocol, private SDK cast or upstream patch exists.

Malformed envelope/endpoint/arguments remain HTTP 400, media type HTTP 415, invalid credentials HTTP 401 and
Origin/CSRF rejection HTTP 403. Malformed/admission failures never echo an untrusted `rpcId`. Authentication remains
before body parsing, with credential revalidation before invocation and before response publication. Both explicit
pre-invocation revalidation checks are retained; automatic approval review rejected removing the redundant check.
The existing catalog page business-error value contract is unchanged.

Tests use actual authenticated HTTP → public DSH Connection → typed Remote → Host Gateway, with controlled clocks,
owned real filesystem changes and public native/index fault fixtures. The initial red test showed a consumed valid
confirmation surfacing as generic `HTTP 400`; green reads `GRANT_PREVIEW_EXPIRED` from the typed client and checks
matching request/response correlation. Expanded evidence covers real 60-second expiry via the controlled clock,
same-path replacement, the actual 256-grant transaction limit, native/catalog and index faults, replaced grant
storage, EIO sanitization, unknown Error/string/forged-Remote objects and all malformed/admission statuses.
[Red/green evidence](../../apps/workspaces/evidence/review-fix/error-boundary.json) retains exact results and logs.

## Historical validation on the recorded tuple

- Fixed native 0001–0004 +0006 prepared in an owned source clone, built and generated-artifact checked: PASS.
  Source `4764ff2640a6caf4906c2c4d337e3cceda093f51b720911086cc196b7f1b4871`, patch
  `fac7c05f152284344e0aab2946a96a897e1766b74a62352d3a2c1b09846f8cb8`, schema
  `dcc2efba3634fed2599bde4eb61730ec0ae2d3e47dd7bc55a7909097a443377b`.
- `bun run typecheck`, `bun run build`, `bun run workspaces:build`, `bun run diagnostics:build`: PASS.
  Authored native catalog and live/history strict checks: PASS; unrelated upstream diagnostics are outside those checks.
- Affected `bun test tests/workspaces tests/access tests/catalog tests/compatibility/{catalog-build,dsh-source,preflight,assets,source}.test.ts`:
  PASS, **67 tests / 1,014 assertions / 19 files**. The final added raw-wire no-secret/no-stack assertions separately
  pass **5 tests / 55 assertions / 2 files** (`remote-errors` + `admission`). Source mutation tests use owned clones only.
- `BUN_EXECUTABLE=... python3 scripts/trace-catalog.py`: PASS, 231 trace lines, two actual SessionManager-authored
  synthetic native files, zero writes/ordinary runtime imports, zero binds/non-Unix connects, two readonly ownership
  observations, one exec, zero stderr and ready + three replies.

- `python3 tests/workspaces/browser.py`: PASS, **all 12 actual Linux Chromium scenarios**, 47 native rows,
  35 synthetic index references, 40 DSH calls and zero page errors. Actual SIGKILL restart restores absolute
  credentials and grants, readonly child exits, canonical-root replacement loses rights, revoke persists through a
  second restart, native cursor errors/correlation faults remain explicit, and native inode/mtime/content stays
  unchanged. [Historical browser result](../../apps/workspaces/evidence/linux-browser.json).

DSH remains the immutable #39 c0 compiled closure (`c0b09e15c170a82894608c397a363a7a96e5d05c`), consumed through
owned per-package links. No eight-artifact/two-aggregate upstream rebuild, install or shared-source mutation was needed.
The 239-input browser build has byte-identical client JS `920c0f…` and index HTML `cfffdd…`; the public contract type
import changes consumed source/contract identities. The Host now includes the sanitizer and public error vocabulary.
Exact historical source/build/schema/runtime/client/Host/installation identities are in
[tuple.json](../../apps/workspaces/evidence/tuple.json). Prior native `8960…`/`8345…` evidence is archived in
[before-review-fix-8157865](../../apps/workspaces/evidence/before-review-fix-8157865/tuple.json); the still earlier
116-test full-suite result remains historical, with **no entire latest-suite claim**.

## Acceptance scope retained

| #43 criterion | Component evidence and scope |
| --- | --- |
| Grants separate from Session Sources | Fixed local profile/source configuration; grants and forged source arguments never expand discovery. |
| Canonical descendants/replacement/unknown cwd | Segment checks and device/inode/birth-time revalidation; explicit missing, inaccessible, unknown and changed states. |
| Unauthorized cwd metadata only | Discovered/registered metadata and held/unknown observations; protected history/open/execution remain blocked. |
| Real pagination/partial/errors | Native catalog pages and separately labelled synthetic Session Index input use actual public descriptions; no implicit registration. |
| Readonly safety and grant persistence | Current tuple: unchanged native inode/mtime/content manifest, SIGKILL restart credential/grant recovery and second-restart revoke; supervised Session-worker revocation remains #44. |

The browser fixture retains 47 discovered rows and 35 explicitly synthetic readonly index references, including held,
replaced, missing, source-unavailable and invalid-reference states. The native inode/mtime/content manifest must stay
unchanged. No real profile, provider/model or global installation is used. Native source0005/0007 composition,
complete-product/private-Session/global-install acceptance, formal reference-hardware performance and Windows/WSL2
acceptance are not claimed. Historical component evidence cannot unlock #41 or close #43.
