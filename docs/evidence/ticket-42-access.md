# Ticket #42 access component evidence

Status: Linux access component implemented and validated; private Session/native/DSH admission stays closed.
Parent spec #29 decision 26 permits isolated component development. Ticket #30's matched compatibility gate and
later resource/Session integration remain prerequisites for product private-data admission. No provider keys,
user history, global installation, real user browser profile or real OMP process were read or changed.

Seams recorded before implementation: root/status/logout through public HTTP, actual browser navigation and
cookies, real Host process restart and public Bun WS admission. The WS fixture models logical opens using the
same authority interface later Gateway composition must use. It does not masquerade as DSH or native execution.
Time is the only controlled system dependency; persistence, HTTP/TCP, WebSockets, browser and TLS are real.

## Reproduction

Use Bun 1.4.4, repository TypeScript dependencies, Python Playwright, `/usr/bin/chromium`, and `openssl`.
The managed environment requires network/loopback allowance even though tests use only loopback.

```sh
bun install --frozen-lockfile
bun run check
bun run test:access:browser
```

Here Bun is `/workspace/work/rpc-public-module-probe/tooling/bun/package/bin/bun`; prepend its directory to PATH.
The browser harness creates temporary synthetic data and browser profiles and cleans them afterward. It starts
only this checkout's Host, obtains bootstrap links through the explicit local command into private subprocess
pipes, and records sanitized result labels. No screenshots/traces/access logs contain bootstrap URLs or cookies.
On failure it deliberately suppresses raw Playwright exceptions, which could contain secret navigation URLs.

## Observed Linux results (2026-11-16)

Actual Chromium 156.0.8078.79; Bun 1.4.4. Windows Chrome/WSL2: **DEFERRED by explicit user delivery adjustment**;
no Windows PASS claim. Controlled-clock tests are separate from real process/browser restart tests.
`bun run check`: 20 tests PASS, 95 assertions, strict TypeScript and Host bundle PASS. The browser command:
seven scenario groups PASS. Final integration-tip/source identity will be added after ticket #30 lands.

| Acceptance | Evidence | Result |
| --- | --- | --- |
| AC1 root-only exchange/clean address/private independent material | Root HTTP tests and actual Chromium; one-use link rotates; private SQLite modes 0700/0600; no OMP imports/config reads | PASS |
| AC2 cookie/TLS/source/CSRF/WS admission | Real HTTP vs real Bun TLS Secure flags; HttpOnly script invisibility; exact Host/Origin, null/missing Origin, proxy/metadata/CSRF denial; public WS fixture | PASS for access slice |
| AC2 admission before body | Raw TCP sends 9,000,000-byte Content-Length with **no body** to Remote/raw/base64/history/download paths; gets 401/403 without waiting; Host HTTP/1.0 missing authority rejected | PASS |
| AC3 absolute 30 days/no renewal | Controlled clock accepts expiry-minus-one millisecond, rejects exact expiry; no Set-Cookie on ordinary status; real restart preserves original expiresAt | PASS |
| AC3 changed scope/material | HTTP old cookies rejected with changed origin/dataDir, on return to old origin, and after material loss, including live cached authority | PASS |
| AC4 server logout/tabs/peers/other browser | Actual Chromium pages share cookie and lose access together; separate credential remains valid; real Bun WS peers close; logical opens revalidate; idle expiry closes | PASS for access slice |
| AC4 existing native execution continues | Authority has no worker/execution control; actual native execution test requires later matched Session/worker composition | NOT RUN at gated native-product seam |
| AC5 real restart distinct from clock | Actual SIGKILL after successful login and logout, graceful Host restart, refresh, multiple pages, persistent synthetic Chromium profile/process restart | PASS |
| AC5 secrets/private-data gate | Routine logs inspected for bootstrap URL/cookie absence; all authenticated private APIs return explicit capability-gate 503 | PASS |

The real browser run produced seven PASS groups: root/cookies/private modes/API gate; SIGKILL restart/refresh/tabs;
logout/isolation/durable revocation; persistent browser profile/graceful restart; changed dataDir/origin; actual
TLS Secure flag; routine-log secret absence. The Bun suite adds live WS expiry/logout and headers-only denial.

## TDD/failure chronology

1. Root lifecycle test first failed because the access module did not exist, then passed after implementation.
2. Host composition test first returned scaffold 404 for root instead of 200; narrow composition made it pass.
3. Live material-loss test first returned 200 after unlinking private state; inode/presence checks made cached
   authority fail closed. Material generation checks also prevent an old Host from retaining changed-origin authority.
4. HTTP/1.0 without Host exposed a relative Bun request URL; guarded URL parsing now returns INVALID_HOST 403.
5. Bun's documented native WS client headers overload is hidden by DOM constructor typings; one documented
   test-only `@ts-expect-error` covers that verified Bun runtime overload without changing production types.

Native Session access, DSH Connection/Gateway, grants, revoke-all worker shutdown and full MVP acceptance are
separate dependent tickets. The access screen states that compatibility and resource admission are pending.
