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
Before integration, `bun run check`: 20 tests PASS, 95 assertions, strict TypeScript and Host bundle PASS.
After integration: **68 tests PASS, 192 assertions**, both TypeScript projects PASS, generated-contract check PASS,
candidate/diagnostics/Host builds PASS, and all seven actual access-browser groups PASS again.

## Final combined source and build

Access implementation: `a1c6700dd375e16d5579c73bdc0a217bdabd2866`. Reviewed ticket #30 integration tip
`0ab18e55b0640a944c318d688a7db4c60ed72a0f` merged without conflicts as
`11b8706798c1fb1bb394f5f9258d55070f8f530a`. This evidence-only follow-up changes no tested runtime source.
The integration check reused ticket #30's unchanged, validated fixed DSH source/artifacts at
`/workspace/work/omp-webui-ticket-30/vendor/dsh-clean` through the public linking script; it did not claim
a new cold DSH build. An owned clean OMP clone in this worktree was reset to the fixed base and rebuilt
through the complete currently ordered patch set (`0001-safe-preflight.patch`). There is no access-specific
upstream delta. Exact commands after merge:

```sh
bun install --frozen-lockfile
bun run compat:prepare --reset
bun scripts/link-dsh.ts /workspace/work/omp-webui-ticket-30/vendor/dsh-clean
bun run compat:build
bun scripts/build-compatibility.ts --check
bun run diagnostics:build
bun run check
node_modules/.bin/tsc --noEmit -p tsconfig.scripts.json
bun run test:access:browser
```

For a standalone cold checkout use `compatibility/README.md` to prepare/build an owned DSH source and link it
instead of the explicitly reused checkout above. Node 24.22.1 and Bun 1.4.4 were on PATH for this integrated run.
Unchanged public OMP source identity: `033536e540a0681755e4543e5990d3c40360d5747bf94482a94668869468604e`;
patch: `6e7f1e147324a468e80a938abe6db0db760cc1aa5a7c8f0c862b83fe890cc550`;
schema: `fde59ea50240a6c9e7450d838883f335c1bf52af67d21e8a982a6c2a9a6b67d9`.

| Rebuilt artifact | SHA-256 |
| --- | --- |
| Access Host `dist/main.js` | `bc1d36be9d0091a7b5dff16d7405b60e470eed5ea8bfcd5feb9ca48aa24f1424` |
| OMP candidate `vendor/omp-candidate/cli.js` | `972beb452c063c743c064ba645073521aa42109991f354aa1154f38a4caf535a` |
| Diagnostic browser `vendor/dsh-diagnostics/client.js` | `693e42659effe1dae4d9885804c738782c3e9d742500a3134321a3a5859fc04e` |
| Diagnostic Host `vendor/host-diagnostics/diagnostics-main.js` | `def574a501737cc879b62d6d6a4357394f1704f3097d80d93867dd3a43219bde` |

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
