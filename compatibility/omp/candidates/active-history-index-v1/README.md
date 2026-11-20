# Active history index v1

This dormant Native source candidate adds read-only public RPC commands for the active parent chain. It covers a prerequisite for lazy Conversation Projection under [#60](https://github.com/HowBoring/omp-webui/issues/60) and uses the verified live handoff from [#35](https://github.com/HowBoring/omp-webui/issues/35).

`history_active_index_open` returns a worker-local snapshot, its exact `HistoryCut`, expiry and entry count. `history_active_index_page` returns ordered metadata starting at a zero-based ordinal. Each request binds the snapshot handle to its original `contentRevision`. The entry digest is opaque and scoped to that snapshot. It authenticates the Native entry fingerprint without exposing a raw hash of hidden native state. Index pages contain no transcript text or retained image data.

`history_active_payload_range` accepts at most 128 consecutive `(ordinal, entryId, digest)` keys from that index and a zero-based `startPart` for the first entry. It returns the ordinary whitelisted Native `HistoryItem` parts under the original cut. A `next` position gives the ordinal and part index for the first unread part in the requested range. Resume with the requested keys from that ordinal onward and the returned part index. Every supplied key is checked before returning any body. Each response fits the existing 768 KiB page budget. `history_content_page` serves retained images from authenticated cursors tied to the same snapshot and entry. A content digest and MIME type identify the retained bytes, and Original association remains unproven. Retrying yields stable cursors within an entry. `history_active_index_close` releases the index and its cursors.

The reader saves compact metadata, entry fingerprints and the runtime handoff fence. It uses the shared two-snapshot quota, an 8 MiB encoded metadata budget per index and the existing ten-minute expiry. Payload reads materialize the requested page and use one Native item of rendering scratch at a time under the existing source limits. Source38 allows mutable entry access. The reader streams the bounded raw source fingerprints on reads to catch a rewrite anywhere in the retained cut, including outside the requested range. This scan avoids retaining a second set of record bodies. Verified active and background appends preserve the original cut. Rewrite, delete, leaf or context changes, lost observation coverage, expired handles and changed bindings fail explicitly. The caller must rebuild the Conversation generation when the Native fence no longer verifies.

At open, the reader validates the canonical Native graph before choosing the active parent chain. It checks categories, IDs, parents and cycles across retained entries, including abandoned branches. It decodes each record against its fingerprint and discards the body after extracting graph metadata. It can reread a selected record with long projection fields so the temporary graph stays bounded. Index and payload reads share the renderer's selection of message role, model identity and stop reason.

The overlay applies to Source38 `c98b7a5cf61f58636decef1d9b8265df83262d24` over Native base `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`. It adds the Native dispatch cases, command and response types, and canonical wire definitions. SDK generation, matched build, Host lazy journal and Native/Host/browser acceptance remain open. The candidate stays outside the active compatibility patch sequence. Indexing covers retained active history. Existing observation and live baselines remain the source of running and unresolved attempt state.

## Fixture replay

Use the Source38 checkout containing its exact `vendor/omp` composition and the pinned Bun runtime.

```sh
python3 -B compatibility/omp/candidates/active-history-index-v1/replay.py \
  --source38 /path/to/source38 --bun /path/to/pinned/bun
```

The replay verifies Native source preimages and the egress guard, applies the patch to four scratch files and loads the Native reader and schema from that overlay. It runs in a temporary synthetic profile with both compiler caches disabled. Add `--baseline` for the expected missing-API failure on the unpatched reader. Add `--volume` to check every record of the deterministic 10,000-entry linear corpus. The volume run checks body and cut integrity with a single in-memory Native reader. It provides source timings and encoded bytes. Formal #60 performance work also needs the mixed corpus, repeated samples, real stdio RPC, Host and browser timing, and OS RSS evidence.

The source-only volume replay used 107,278,884 bytes of serialized Native records. It read the index in five pages with 2,657,838 bytes of accounted metadata and reached all records through 137 payload pages. The largest encoded payload page was 780,980 bytes. The metadata figure is the index budget accounting, and runtime RSS is unmeasured.
