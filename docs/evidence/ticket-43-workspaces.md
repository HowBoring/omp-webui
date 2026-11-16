# Ticket #43 — isolated authenticated directory/Workspace component

Current component includes integration `d22a908b2b6b8a53093af70c347b92cc5e69869b` (#35 accepted), merged into the
isolated review-fix branch. #43 remains **unmerged/unclosed pending #41**. Protected open, real registration/index
persistence and Session-worker revocation remain #44 composition work. The default Host continues to deny private
Session capabilities. Windows Chrome/WSL2 remains explicitly owner-deferred.

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

## Current validation

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
  unchanged. [Current browser result](../../apps/workspaces/evidence/linux-browser.json).

DSH remains the immutable #39 c0 compiled closure (`c0b09e15c170a82894608c397a363a7a96e5d05c`), consumed through
owned per-package links. No eight-artifact/two-aggregate upstream rebuild, install or shared-source mutation was needed.
The 239-input browser build has byte-identical client JS `920c0f…` and index HTML `cfffdd…`; the public contract type
import changes consumed source/contract identities. The Host now includes the sanitizer and public error vocabulary.
Exact resulting source/build/schema/runtime/client/Host/installation identities are in
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
| Readonly safety and grant persistence | Actual native trace and process-restart browser evidence; supervised Session-worker revocation remains #44. |

The browser fixture retains 47 discovered rows and 35 explicitly synthetic readonly index references, including held,
replaced, missing, source-unavailable and invalid-reference states. The native inode/mtime/content manifest must stay
unchanged. No real profile, provider/model or global installation is used. Native source0005/0007 composition,
complete-product/private-Session/global-install acceptance, formal reference-hardware performance and Windows/WSL2
acceptance are not claimed. Current component evidence cannot unlock #41 or close #43.
