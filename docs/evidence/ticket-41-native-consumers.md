# #41 Native consumers — source-only preparation

[中文](./ticket-41-native-consumers.zh-CN.md)

This is a separate consumer delta for the prepared Native `0010`, based on Host `df21a34570f35f919d395eadafa55b14e4de970f`
and Native prepared tree `a2d6f32d2978d31be1c859d6c3c2183dc50b379a` (stable patches 1–6 plus that ownership checkpoint).
It does not replace the lead's cumulative `0010` patch, change the active patch list, compose final patches 1–10,
or enable private/global admission. Later Host checkpoint merges do not change this delta's declared Native base.

The [delta](../../compatibility/omp/0010-execution-ownership-consumers.delta.patch) contains 16 Native source files,
the upstream package README/CHANGELOG, and paired consumer documentation. Exact paths, file hashes, upstream AGENTS
identity, tree and evidence identities are in the [manifest](../../compatibility/omp/execution-ownership-consumers.preparation.json).
Resulting prepared tree: `9052be8a474f01bbeca8ff2e3b568bdbb6e3a5a8`.

Project/global broker consumers no longer create token/runtime files or spawn a broker on connection/reconnection.
They obtain public dispatcher grants before construction and revalidate cached clients, requests, cancellation and
completion acknowledgements. A changed grant closes the client with a typed error. Child endpoints, service logs,
Chromium profiles and durable browser target registries use the dispatcher-selected directory. The broker smoke
function probes the independent broker; it no longer claims to test client-owned startup. CLI/ps metadata, broker
publication, transport/backend and worker-realm bootstrap remain the lead's source scope.

SDK and legacy factories initialize ownership first, before inference registration or resource reload. Shared named
services, browser/relay/health replacement, IDA and text prediction refuse before shared effects. Prediction refuses
before old-daemon shutdown or SmolLM prefetch. Registered private LSP bypasses automatic lspmux and shared transport;
registered private blob use selects the existing local backend before shared factories. Unavailable never selects
either fallback. Generic bash, background jobs, parent-owned subagents, Source7 and AgentCore were not edited.

| Check | Actual result |
| --- | --- |
| Existing public ownership decision/wire/owned-FS suite | 21 PASS, 1 kernel SKIP, 0 FAIL, 76 assertions; 18 files typechecked |
| Test isolation | Egress guard before imports; synthetic HOME/profile/cwd/XDG, allowlisted environment; no kernel fixture opt-in |
| Consumer source identity/application | 20 exact file hashes; private-index delta application equals the declared tree |
| Consumer syntax compilation | 16 TypeScript files transpiled; no Native module import |
| Host scripts typecheck | PASS, 56 files |
| Whole SDK source typecheck, same files/dependency topology | Both baseline and candidate FAIL with the same 77 diagnostics; zero added/removed or changed-file diagnostics |
| Consumer runtime red/green, SDK/CLI/worker/model/provider/browser/service/LSP/attachment tests | NOT RUN |
| Actual global installation, lifecycle capability and private admission | BLOCKED |

Commands from this owned worktree:

```sh
bun --no-env-file scripts/check-ownership-preparation.ts vendor/omp-consumers
bun --no-env-file scripts/check-ownership-consumer-preparation.ts vendor/omp-consumers
bun --no-env-file check --no-script -p tsconfig.scripts.json
```

The compiler comparison used an owned temporary config with exactly the 16 changed source files, mapped the public
Native self-imports to this source, and imported no runtime modules. It compiled the candidate, temporarily restored
those files from the exact prepared baseline, compiled again, then restored and verified the candidate bytes. The
77 shared diagnostics include absent generated RPC contracts and baseline ambient const-enum/dependency errors.
This is not a complete SDK build PASS. The owned dependency symlink ultimately resolves to the existing ticket-30
runtime cache through ticket-36's dependency link; TypeScript is 6.0.3. No dependencies were installed or modified.

The previously agreed seams remain public Native ownership/RPC and actual browser/Host workflows. No consumer
behavior test was substituted with source-text assertions or a fabricated successful runtime. Runtime TDD remains
pending the coordinator's safety clearance and authenticated dispatcher/backend. Existing tests that self-start
brokers or fabricate old browser scope records require migration to the new public dispatcher fixture.

Remaining mandatory proof includes nested ordinary `env -i` denial, missing/legacy dispatchers, SDK first-effect
refusal, external TUI/service preservation, private LSP, all image/text/document formats and budgets, actual tool
failures/cancellation/background/subagents, crash/fence faults and extinction. No process signals, private-profile
reads, orphan recovery or fence changes were performed. Linux remains current; actual Windows Chrome/WSL2 is
owner-deferred. This preparation is not an OS sandbox or an external-effects rollback guarantee.
