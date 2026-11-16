# S0 diagnostic shell

This is a diagnostic-only composition of the pinned DSH Cordis, Connection,
TypertRegistry and Gateway Client. It mounts only `ompDiagnostics/preflight`;
it never starts stock Chat, workspace initialization, or a Session controller.
The Host alone chooses the launcher. No browser execution controls exist.

Run `bun apps/diagnostics/build.ts` after the repository's pinned dependency
setup. The build verifies the DSH source checkout's exact pin and absence of
tracked changes, compiles public export-map source entrypoints into one realm,
and writes ignored `vendor/dsh-diagnostics/{index.html,client.js,manifest.json}`.
The manifest records the lock, actual consumed source bytes, contract and served
asset hashes, retaining each package/version/relative input file and its digest. This shell has no DSH source patch. Upstream source and built
assets are never committed. Resolve all three DSH foundation packages and Cordis
from the same fixed source checkout; do not substitute npm's different latest.

`packages/contracts/diagnostics.ts` owns the strict sanitized report schema and
inferred type. The public `createTypertRemoteInfo` factory generates mounted
method descriptors and strict no-argument named-input codecs from its method
specification. The same descriptors are exported in `diagnosticsHostContribution`
for Host registration. Result decoding validates every nested field; both report
variants retain `sessionAdmission: blocked`. A verified report requires complete
identity. Unknown fields, paths in codes and unbounded strings are rejected.

The Client uses actual Connection HTTP envelopes and Gateway mux `$events`.
Only an established Connection generation can publish preflight. Generation loss
clears prior identity, and a late report cannot republish after loss or disposal.
Page suspension clears rendered identity; a persisted-page restoration reloads
the shell and obtains a fresh Connection and preflight.
The page renders safe static codes for transport/module/schema faults and never
renders Remote error messages or details. If JavaScript fails, the static HTML
continues to show blocked asset status.

Accepted test seams are spec29 Testing Decisions 1–3: real browser → DSH → Bun →
public native RPC, supplemented by public Remote/schema faults. No seam approval
is pending. Initial schema red was missing contract import, followed by green.
Public Remote tests are explicitly synthetic carrier fixtures, not native proof.

```
bun test tests/browser/diagnostics-contract.test.ts tests/browser/diagnostics-remote.test.ts
bun apps/diagnostics/build.ts
python tests/browser/diagnostics-browser.py http://127.0.0.1:PORT/ \
  --evidence vendor/diagnostics-browser-evidence --expected-code EXPECTED_CODE
```

The browser harness's first case must use the real owner Host and candidate.
Later cases are explicitly intercepted carrier/asset failures; they cannot prove
native preflight. Keep screenshots/logs under ignored `vendor/`. The actual Host
and native source/runtime verification belong to ticket30's carrier slice.
