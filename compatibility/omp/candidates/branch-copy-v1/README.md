# Native branch copy preparation

This unregistered source candidate for [ticket #52](https://github.com/HowBoring/omp-webui/issues/52) adds a private Native copy intent on top of [branch inspection v1](../branch-inspect-v1/README.md). Preparation checks the full confirmed cut, protected Session identity, and idle state through `inspectBranch` before and after collecting entries. It uses the Native SessionManager's indexed parent and resolved label lookups. The source RPC Worker retains its Session and lease. The intent stays inside Native code.

## Copy semantics

- The selected user entry is excluded. The walk includes exactly the root-to-immediate-parent path, even when the source's current leaf is on another branch. A null parent produces an empty retained path and a null retained leaf. A cycle, missing ancestor or unexpected Native control row fails preparation.
- Each retained row keeps its exact source entry ID, immediate parent, timestamp and per-entry submission origin. The lineage distinguishes exact copies from rows that remove an `activeLeafId` override or clear a cross-branch label effect. The removed override can explicitly be `null` when the source cleared the active leaf. Source rows stay intact.
- Historical label rows keep their original positions in the parent chain. Native replay uses that sequence for rewind reports, compaction boundaries, model fallback and provider rewrite timing. A label row that references an off-cut target keeps its archival target ID and has its effective label cleared. The plan includes destination-authored label changes where the copied path's labels differ from the source's currently resolved labels. These descriptors include both a parent and an active-leaf override equal to the retained leaf. Native applies their label effects globally while the branch path still ends at the immediate parent of the selected user entry. A cleared label descriptor uses `null` and is authored as a Native label record with the `label` property omitted.
- Each row records the SHA-256 revisions of its Native source encoding and its planned destination encoding, without a trailing newline. The copy revision commits to the protected source and confirmed cut, source and retained leaves, resolved label changes and ordered lineage facts. Entry bodies, IDs, labels and lineage are detached from the source index. The limits are 10,000 ancestor entries, 64 MiB per serialized row, 16 KiB UTF-8 per authored label value and 128 MiB for planned entry lines plus label descriptors. A publisher must also account for the destination header, authored label lines and transaction records.

Per-entry submission causality retains its original source identity. Source headers, submission and navigation operation records, and reservation tombstones stay in the source. Destination reopen requires an explicit inherited-origin format that validates the copied carriers without treating their source operations as admissions to the destination. Referenced Native blobs and artifacts also require validation under the eventual publication design.

## Durable transaction follow-up

Reserve a source-owned intent before hooks or publication using the exact protected source identity, operation ID and immutable request fingerprint. Revalidate the cut and relevant idle fences after any awaits. Keep the destination descriptor and copy revision bound to a stable publication target. Publish the complete destination with immutable lineage and its commit receipt, then verify both identities through protected readback. A read-only query must resolve the original source key across a crash between destination publication and the source terminal receipt. Later destination appends must preserve the original lineage independently of the destination's current history. A separately opened destination can acquire its own worker after verified registration.

Native `utils/file-new-publication.ts` provides anonymous Linux `O_TMPFILE` preparation and fd-bound no-clobber `linkat`. Durable branch publication also needs file-data and parent-directory `fsync`, plus failure and readback proof. `StrictReservation.create` exposes the final pathname during writes and is unsuitable for publishing a branch. The existing legacy RPC mutates the current worker's Session. Public commit, query, verified reopen and browser activation remain pending.

## Verification

`native-branch-copy.patch` adds the two exact Native modules against Source38's composition and the branch-inspect candidate at `5b92a900`. The Native base is `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`.

```sh
BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 NODE_DISABLE_COMPILE_CACHE=1 bun --no-env-file compatibility/omp/candidates/branch-copy-v1/branch-copy.fixture.ts
BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 NODE_DISABLE_COMPILE_CACHE=1 bun --no-env-file compatibility/omp/candidates/branch-copy-v1/branch-copy-native.fixture.ts /path/to/Source38/vendor/omp
```

The Native fixture uses synthetic data under a temporary directory and the read-only Source38 checkout. It acquires the real Linux local lease, opens the source through protected storage, prepares the cut and feeds the resulting rows to Native replay in memory. It verifies rewind provider context, snapcompact transcript dividers, resolved label updates and clears, and a label as the actual retained leaf. It also checks the source file, worker identity and leaf after preparation. The fixture requires permission to bind an abstract Unix socket. Durable publication, process-crash recovery, Native TUI continuation and browser acceptance remain pending.
