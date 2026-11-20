# Persistent browser authority

This module implements ticket #42's access slice. It contains no OMP imports, Session lookup, provider
configuration, executable selection or worker control. Login alone never opens the private capability gate.

`openBrowserAccess({dataDir, origin, now?})` opens private durable material. `origin` must be the exact configured
loopback listener origin; its scheme must come from the actual listener, never Forwarded headers. `now` is an
optional wall-clock boundary for expiry tests. Production uses `Date.now`. `hostId` is a stable, non-secret namespace
for the canonical data directory, origin and material generation. It survives restart; it is not a browser or
Session identity. No transient worker/projection generation belongs in a durable draft namespace.

- `handle(request)` handles the root access screen, root bootstrap exchange, `GET /auth/status` and
  `POST /auth/logout`, returning `null` for other trusted paths. Run it before any fallback handler. Every path
  first checks Host, exact request URL origin, Origin when present, Fetch Metadata and untrusted proxy headers.
- `admit(request, "read" | "write" | "websocket")` returns an opaque `BrowserAccess` or a structured error `Response`.
  Call it **before** body consumption, sensitive query/ID parsing, resource lookup, storage or execution. Read
  admission permits GET/HEAD. Write admission requires the exact Origin plus `x-omp-csrf`, issued only in the
  authenticated no-store status response. Browser WS upgrades require GET, Upgrade, exact Origin and the cookie;
  exact Origin and strict cookies provide their CSRF protection without query credentials or a custom WS protocol.
- `revalidate(access)` checks durable, current, unexpired credential authority. A retained access object is never
  permission to skip this check. Revalidate before **every** WS logical open/message/reply and stream publication,
  then apply current source/directory/Session/object grants separately. The module does not grant resource rights.
- `attachPeer(access, invalidate)` registers live-stream/Peer cleanup; returns a detach callback. Logout commits
  revocation, then invalidates all of that credential's peers synchronously. A one-second sweep closes idle expired
  peers and observes external material changes. That sweep is cleanup, never a grace period for publication.
  There is no 30-day JavaScript timeout or sliding expiry. Invalidation callbacks must synchronously disable
  publication before beginning asynchronous transport teardown. Callbacks never stop execution or other browsers.
- `bootstrapLink()` is exclusively a trusted local operator operation; never expose it through HTTP/Remote,
  diagnostics or generic logs. A link exchanges once via root GET and rotates atomically. It cannot authorize an
  API, attachment, ordinary header/query token, or WS request. Retrieve another link explicitly for another browser.
- `close()` disables peer delivery and closes persistence; remembered credentials retain their absolute expiry.

Cookies are opaque random 256-bit values, host-only, Path=/, HttpOnly, SameSite=Strict, with an absolute 30-day
Expires. HTTPS listeners also set Secure. Cookie verification uses a private independent HMAC key and durable
credential digest, never OMP/provider keys. SQLite DELETE-journal/FULL synchronous transactions serialize bootstrap
exchange and commit logout before acknowledgement. The data directory is mode 0700 and state file mode 0600;
symlink targets are rejected. Missing/replaced material, another origin or another canonical data directory
invalidates old credentials and live cached identities. Startup corruption fails closed; runtime persistence errors
return bounded structured errors. The guarantee excludes malicious same-OS-user access, as the access contract states.

`tests/access/*.test.ts` cross HTTP/module/Bun WebSocket public seams using synthetic material and a controlled
clock. `tests/access/browser.py` separately starts actual Host processes and Linux Chromium, including SIGKILL,
persistent synthetic browser-profile restart and actual TLS. The peer test is explicitly a fixture, not DSH/OMP
Gateway evidence. Real Session/native execution integration remains closed pending compatibility/resource gates.
