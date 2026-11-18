# Native durable branch publication

This unregistered source candidate for [ticket #52](https://github.com/HowBoring/omp-webui/issues/52) adds
`publishDurableNewFile` to the existing Native anonymous-file publisher. A future branch transaction supplies
complete serialized destination and receipt bytes together with an already-durable trusted parent directory fd
and a synchronous check of its identity and publication authority.

The helper writes the private inode at mode `0600` and syncs it before the final authority check and
fd-bound `linkat`. The link preserves any incumbent pathname. The helper verifies the named regular file's
exact identity, syncs the held directory, then rechecks authority and identity before returning success.

Preparation failures and a definitive `EEXIST` report `not_published`. A link attempt that might have taken
effect reports `outcome_unknown` if the helper cannot verify success. It leaves the destination in place for
observation. The existing artifact publisher still uses its original publication behavior.

## Verification

`native-branch-publication.patch` applies to the byte-identical publisher from Source38 and
`0005-strict-continuation.patch`. The fixture copies only that preimage into an owned temporary directory,
applies the patch, and loads it after the existing no-provider guard.

```sh
BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 NODE_DISABLE_COMPILE_CACHE=1 bun --no-env-file \
  --preload ./compatibility/omp/fixtures/no-provider.ts \
  ./compatibility/omp/candidates/branch-publication-v1/branch-publication.fixture.ts /path/to/Source38/vendor/omp
```

On Linux the fixture verifies complete synthetic destination and receipt bytes, file permissions, occupied
file and symlink preservation, lost authority during private preparation, parent-directory `fsync` failure, and
destination replacement during final verification. The branch transaction's source-owned intent, receipt
format, recovery query, verified Native reopen, and end-to-end crash and browser acceptance remain open.
