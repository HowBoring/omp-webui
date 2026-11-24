# Ticket 39 catalog build integration follow-up

The catalog client builder now accepts only the declared complete DSH candidate through the same public
`verifyDshSource(resolvedPackageRoot, "candidate")` gate as diagnostics. The previous clean-HEAD check rejected
the accepted ordered patch tree. `dshBase`, lock identity, individual consumed-input digests and artifact hashes
remain present; the catalog manifest additionally carries the complete `dshSource` identity. `DSH_SOURCE` is
not a source-selection override for this build: verification follows the package the builder actually resolves.

## Approved seam and red/green evidence

The existing spec29 source/build seam is exercised by launching the shipped catalog build entrypoint in a
disposable workspace containing copies of the real app, contracts, source verifier and declarations. The tests
do not replace the builder or mock its verifier. The positive case uses actual resolved DSH packages and builds
the browser client; the negative cases replace only the workspace-owned gateway package link with an owned
lightweight Git checkout. These cases reject before either `client.js` or `manifest.json` is published:

- Unpatched pinned baseline and the first patch without the second.
- An unrecorded edit to the consumed Gateway client and an untracked authored module.
- An ignored startup `.env` file.
- The exact candidate tree committed without the required pinned ancestry.

The old builder fails the positive test at its `git diff --exit-code HEAD --` check. The retained
[initial failure](evidence/catalog-build-gate/initial-failure.json) identifies the expected candidate and the
full ignored log. After the fix, both build-boundary tests pass with 32 assertions; the manifest assertions
check the independently accepted source tuple, ordered patch hashes, a consumed-file hash and actual assets.

## Matched source and builds

The resolved DSH source is the immutable accepted `vendor/dsh-final` checkout in the ticket39 final-fix
worktree. Its base/head is `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`, candidate tree is
`c0b09e15c170a82894608c397a363a7a96e5d05c`, and source SHA-256 is
`d4790e8b7740b1541b9254a3e0802e959b49964ed58f08e4bf5a7d26f0000538`.

The [new catalog manifest](evidence/catalog-build-gate/catalog-manifest.json) retains all 238 consumed inputs;
its SHA-256 is `bf1cc8806482e3ec6529a35ace57fc37ffc7cd0b0c07f5711e91cb958a7269c7`.
[Build identities](evidence/catalog-build-gate/build-identities.json) also record the diagnostics client
(232 inputs), diagnostics Host (241), and catalog Host (248). The accepted DSH artifact path set, byte counts,
every file hash and aggregate hash were independently checked: 371 artifacts, aggregate
`1f7848987424b48a877fbeb03484f8253e712cdf2e3e355d2627a959016d8d35`.

## Commands and results

Using Bun 1.4.4, all commands in [validation.json](evidence/catalog-build-gate/validation.json) passed:

- `bun run typecheck` and `bun node_modules/typescript/bin/tsc --noEmit -p tsconfig.scripts.json`.
- `bun scripts/build-compatibility.ts --check`.
- `bun test tests/compatibility/catalog-build.test.ts`: 2 tests, 32 assertions.
- `DSH_SOURCE=vendor/dsh-reconstruction bun run check`, with network/loopback permissions enabled:
  111 tests across 23 files, 947 assertions, zero failures in 104.16 seconds, followed by the Host build.
- `bun run diagnostics:build` and `bun run catalog:build`: both actual clients and Hosts build.

This worktree owns its package links and lightweight OMP/DSH reconstructions. Existing source-mutation tests
operate on those owned checkouts; candidate/runtime/dependency and accepted built DSH inputs are reused
without authored-source or artifact mutation. Both source reconstructions verify after the checks. The current
integration head `9d5e5eb196e929086ae80bac965c4011f838d4f6` was merged before handoff (already included).

No upstream patch/API, product admission or browser behavior changed. The accepted full DSH build gates,
1488-test result and Chromium fixture evidence are reused because the complete source/artifact tuple matches;
they were not rerun. The existing optional global JSDoc navigation-prose baseline failure remains unchanged
and is not claimed green. Product/private/global-install admission remains blocked. Windows/WSL2 acceptance
remains deferred by the user's explicit delivery adjustment.
