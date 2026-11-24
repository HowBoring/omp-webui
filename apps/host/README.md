# Host application

This is the Bun process that will serve the DSH Web Client and supervise OMP RPC workers.

The Host currently provides:

- Loopback-only HTTP binding, with optional locally configured TLS.
- `GET /healthz`.
- A root browser access screen and persistent 30-day browser login/logout.
- Explicit private capability gating: unauthenticated APIs fail admission; authenticated APIs return
  `503 PRIVATE_CAPABILITY_GATE_CLOSED` until the native/DSH/resource gates are implemented and validated.

Set `OMP_WEB_DATA_DIR` to a dedicated private Host data directory (default `.data`), then start with `bun run start`.
Get a single-use bootstrap link through the **explicit local** command below, using the same data directory,
host, port and TLS settings as the listener. Its output is a secret; use a private terminal and do not pipe it
into generic logs, diagnostics or evidence:

```sh
bun apps/host/src/main.ts --print-bootstrap
```

Open that link in the browser. It exchanges only on root GET, redirects to `/`, and sets a host-only HttpOnly
SameSite=Strict cookie with an absolute 30-day expiry. Ordinary visits do not renew it. Use Log out to revoke
that credential on the server and invalidate its tabs/peers. Other valid browsers remain authorized. A restart
does not restore old worker/UI operations. Retrieve a fresh link for another browser or after expiry/revocation.

Changing origin, data directory or losing private material requires bootstrap again. Do not select a provider
configuration directory as Host data storage. Browser APIs cannot select Host paths/executables/provider config.
`OMP_WEB_TLS_CERT` and `OMP_WEB_TLS_KEY` optionally select a real Bun TLS listener; both must be provided together.
Secure cookies are emitted only with this actual TLS configuration. No reverse-proxy/Forwarded trust is supported.
The default remains plain loopback HTTP with no Secure claim. Host startup logs contain the listener origin only.

See [the access interface](../../packages/access/README.md) and [ticket 42 evidence](../../docs/evidence/ticket-42-access.md).

Do not add OMP SDK imports here. OMP integration belongs behind the RPC transport boundary described in [the architecture](../../docs/architecture.md).
