# Ticket 51 History Navigation Remote SOURCE

Base: integration `5b769eec69e8fe6d22c69336deb4bd0ad24ff503`, tree
`11b6f059badf9312c34e72021d9cf8c53f0a06a9`. Uses only the reviewed candidate public
`packages/contracts/candidates/durable-navigation-v1` (descriptor SHA256
`32ec3ac4d5b585fd0aa9fdee78daa57be7e3f2bdda1cb8d42c2662dedba4f306`), with exact
Source37 `c8efeced4b6f59bc686a90fe48f4ee4ea72d5180` provenance retained by that descriptor.

This slice adds only the unregistered public SOURCE contract, coordinator/ports, focused public Remote
tests and documentation. No existing tracked path is edited. Active Root wire/schema, decoder, capabilities,
patch lists, dependencies, upstream pins, Host entrypoints and product routes remain untouched.

The agreed seam is a real public DSH Client Remote over in-memory Connection/Gateway, through the service
to the actual generated candidate `NavigationClient` and validators. Native DTOs and external authority,
Stop, clock, metadata and projection ports are synthetic. The no-provider preloader denies network,
process/worker launch and listeners before tests. There are no private DSH mocks, aliases or type stubs.

TDD retained initial missing-module RED, native inspection RED→GREEN, explicit confirm RED→GREEN,
query RED→GREEN, revocation-during-rebuild and predispatch-busy RED→GREEN, bounded revision RED→GREEN.
Tool objects including all running TypeScript session IDs and terminal results are retained externally at
`/workspace/work/mvp-implementation/research/ticket-51-history-source-tool-results.json`.
Static runtime import audit and its complete file hashes are retained beside it. Earlier broad document reads
remain in the task conversation; verification objects are retained without replacing earlier failures.

Focused commands use the existing immutable Bun 1.4.4 at
`/workspace/work/rpc-public-module-probe/tooling/bun/package/bin/bun`, `env -i`, synthetic
`HOME=/tmp/navigation-source-fixture`, `TMPDIR=/tmp`, `--no-env-file` and
`--preload ./tests/preferences/no-provider.ts`:

```sh
bun --no-env-file --preload ./tests/preferences/no-provider.ts test ./tests/history-navigation-source/remote.test.ts ./tests/history-navigation-contract/public.test.ts
bun --no-env-file --preload ./tests/preferences/no-provider.ts ./node_modules/typescript/bin/tsc --noEmit -p tests/history-navigation-source/tsconfig.json
```

The strict selected graph inherits the unchanged root tsconfig and resolves actual public dependency types.
Focused checks pass 25 source Remote tests plus five preserved public-contract tests (30 tests, 224 assertions).
The static audit resolves 238 runtime files, no nonliteral/dynamic imports and no Native runtime imports.
It is not a full-project typecheck. Full `bun run check`, broad tests/builds, actual Native/OMP/SDK/Host,
listeners, Bun workers, browser, FFI, kernel/proc, staging, keys and experiment execution are outside this
SOURCE slice and were not run. Shared node_modules is a link to existing dependencies; nothing is installed
or copied. No runtime input, fence, canonical artifact, seed, enrollment, signed stage or cleanup is touched.

See the component README and ADR0025 for port requirements, metadata-only storage, no-replay recovery,
structured generation proof, unsent draft offers and exact remaining limitations. Whole #51 remains OPEN;
this is not actual restart/all-View/draft-conflict evidence or product capability admission.
