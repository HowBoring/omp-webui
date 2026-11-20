# #51 public contract prerequisite — SOURCE only

Base: `49c437cc69ecfb1e7f83ea234dc054baf9dc4ecf`; isolated sparse worktree
`/workspace/work/omp-webui-ticket-51-contract`, branch `mvp/ticket-51-contract-source`.
No integration merge, push, ticket closure, registration or runtime action.

The accepted complementary public schema/callback-client seam is #29 Testing
Decisions 2–4,8–9 and the #51 source-frontier recommendation. These checks observe
the actual public generated validator and callback client against synthetic DTOs.
They do not claim the public Remote-to-Host seam, which belongs to a later component.
The existing TDD seam authorization applies; no new private seam was introduced.
Architecture/ADR0001 and ADR0010 remain the governing boundaries; no new ADR is needed.

## Checks

- **PASS:** initial missing candidate module failed the first public command test;
  exact public validator and wrapper made it pass. Final suite: 5 tests, 24 assertions.
  Success and refusal include exact command envelopes, legacy/extra-field refusal,
  invalid target/revision/outcome, public inspect/navigate/query with distinct
  transport IDs, wrong echoed identities, malformed replies, and failed-with-committed
  effects/reference-only draft preservation.
- **PASS:** pure AST closure, public schema command-table consistency, exact AJV
  reproduction of all three validators, artifact hashes, active schema/type hashes,
  and complete candidate runtime import closure. Type output SHA256:
  `e5d988b2744f1da4ddadf5075c1c8f8fa2a52993b2aaaa22fa228557c019112f`.
- **PASS:** strict scoped TypeScript against actual installed dependencies and
  original project strictness options; no stub, `any`, or unchecked cast.
  An earlier CLI invocation required TypeScript 6's `--ignoreConfig`; the next
  run found and corrected an unchecked tuple inference in the checker. Both failures
  are retained in tool accounting.
- **PASS:** public bytes matched #37 and its native generated wire/client/validators
  after the existing client import transform. Native schema formatting differs:
  `721a14e4e3ee5630a40e6a35cf09e4ad085b5901c89ec84f14e62687a428facc`;
  normalized public schema:
  `0cde2405878c052df5ba4766182e25016990f5b1024cdb84bbd119fd451fa9aa`.
  JSON values and exact existing public serialization match. Two exploratory
  byte-equality assertions failed before distinguishing schema formatting and an
  inert `require(...)` string in AJV's helper from an actual AST import. Final
  checks use the correct serialization and AST import inventory.
- **PASS:** immutable #37 ready SHA
  `9bb1c85d437dc4efe6e1f92c78b3280540a9dbdbf12465f984fae622e9bb140c`,
  all 6110 recursive input records and Native123/index/staged/working/status exact.
  Only AST-extracted `frozen_inputs`/`verify_inputs` metadata functions were
  evaluated, with `GIT_OPTIONAL_LOCKS=0`; no runtime entry was imported or called.
- **NOT RUN:** broad `bun run check`, Native imports/generation/builds, OMP,
  SDK/Agent, provider, FFI/kernel, process/listener, Host, Bun worker, browser,
  persistence/crash/reopen, integration or product acceptance. The Root-authorized
  pure/static scope supersedes the broad check instruction for this slice.

The exact Bun executable was
`/workspace/work/rpc-public-module-probe/tooling/bun/package/bin/bun` (1.4.4).
Commands ran from the isolated worktree with `env -i` and:

```text
HOME=/tmp/ticket51-contract-pure TMPDIR=/tmp PATH=/usr/bin:/bin LC_ALL=C.UTF-8
PI_CODING_AGENT_DIR=/tmp/ticket51-contract-pure/.omp/agent
XDG_CONFIG_HOME=/tmp/ticket51-contract-pure/config
XDG_CACHE_HOME=/tmp/ticket51-contract-pure/cache
XDG_DATA_HOME=/tmp/ticket51-contract-pure/data
BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 NO_COLOR=1
```

Focused tests use `bun test --no-env-file
--preload=./tests/preferences/no-provider.ts
tests/history-navigation-contract/public.test.ts`. Checker and tsc use
`bun --no-env-file --preload=./tests/preferences/no-provider.ts` followed by
`./scripts/check-navigation-contract-candidate.ts` or
`./node_modules/typescript/lib/tsc.js`. The latter uses `--ignoreConfig --noEmit
--target ESNext --module Preserve --moduleResolution Bundler --lib ESNext,DOM
--types bun --strict --skipLibCheck --noUncheckedIndexedAccess
--exactOptionalPropertyTypes --verbatimModuleSyntax --allowImportingTsExtensions`
and exactly the new test and checker entry files. Existing `no-provider` guard
bytes were unchanged. Dependencies are a symlink to the existing integration
installation, not a copied or installed dependency tree.

Full check-tool objects are retained externally in
`/workspace/work/mvp-implementation/research/ticket-51-contract-source-tool-results.json`;
the conversation also retains completed metadata reads and their complete tool
objects. No check returned a running tool session. No old evidence manifest was
copied or changed, and no source/runtime/key/stage was removed. The candidate is
under 1 MiB of checked-out source, below the 3 MiB budget.

Current source readiness does not repair historical actual failures or authorize a
new cohort. Host capability stays unavailable until a future separately reviewed
matched public transport port exists. Stop here for fresh paired review.
