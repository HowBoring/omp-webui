# Live settlement candidate checkpoint (#35)

This is an isolated S0 implementation checkpoint, **not final #35 acceptance**. Product private Session admission
stays blocked. The coordinator requested a pause for review before the final #34 source tuple is merged. Current
ordered source is 0001–0004 + additive `0006-live-settlement.patch`; #32/0005 is not a dependency of this slice.
Linux Chromium is exercised. Windows Chrome/WSL2 remains deferred by the owner.

## Native public contract

The existing `history_observation_poll` now returns native source metadata and safe readable payloads, plus scoped
`message_start`, `message_update`, `message_final`, and `message_settlement` facts. Every cut adds native mutation
counter and retained-state revision alongside the complete content revision and shared observation watermark.
Same-count mutable source rewrites emit `native_untracked_rewrite`; indexed mutations retain actual entry/leaf,
revision and context counters. Append, rewrite/rebuild (including delete/reparent), leaf/source/context changes
and bounded gaps remain observable. Snapshot items carry exact retained process-local live associations.

AgentSession stamps native lifecycle identities before asynchronous display delivery. Scope includes worker,
source, native Session, context digest and initiating leaf. Actual append/no-append decisions return exact native
entry IDs or an explicit no-entry reason, using original object associations and the existing assistant Symbol.
The idle `sendCustomMessage` path has its own hook at the real append decision. No join uses text, timestamps,
hashes, next-entry adjacency or native append notifications. Native original-object re-emission after branching
still follows the original native append/dedup decisions. Reusable tool IDs retain an initiating assistant owner
inside their native context; unresolved duplicate IDs or evicted owners cannot be presented as an exact pair.

`observed` means memory visibility. Every settlement and cut says `durability: not_attested`. Native ordinary
append may be lazy or latch a failure; neither append notifications nor entry presence attest persistence.
Throwing decisions report `failed`; native dedup without an authoritative object link, one-run contexts and
other real no-append paths report `no_entry`. Recoverable durable submissions belong to #36. These native
symbol hooks are available for later ingress/provenance integration; they do not invent a durable request ID.

The source patch updates handwritten forwarding/handler, wire schema, generated clients and native package docs.
Host imports only matched public RPC modules. It never reads native Session files or imports the native runtime.

## Derived DSH generation

`LiveJournal` reads one public native cut, groups lossless continuation parts, and derives immutable contiguous DSH
seqs with real native Session identity. Pages use inclusive `throughSeq`, exclusive `beforeSeq`, chronological
records and source-message group boundaries. Old cuts reproduce the same rows while live appends extend the
journal. The assistant baseline is mandatory even when idle. Live assistant revisions and chunk indices are dense;
final native content replaces temporary presentation through the stock controller's settlement machinery.
Derived chunks/times are presentation values, not original provider timing/chunks or a durable native journal.
Actual provider/model fields are retained from the safe native mapper. Structural records remain marked native
records. This checkpoint uses the stock Conversation/Trajectory assembly with a small JSON renderer, not the full
product shell or the final typed native/tool renderer.

A source/context change, irreparable gap, unavailable association, old/out-of-order poll, or eviction fails the old
generation explicitly. The acceptance page hides its rows, releases the actual public controller reference, then
requires a manual full-view reopen. It never calls private resync, sends a second snapshot on the old physical
follow, uses surface replacement to delete branches, or changes the native Session ID to clear the view. Final
release obtains a fresh controller and Conversation binding. Coordinated multi-holder rebuild remains #40.
The fixture's independent textarea survives this local release/reopen. This proves **fixture DOM draft survival
only**, not integrated #39/#40 draft/attachment preservation. Native execution/Interaction ownership is separate;
this fixture does not claim an Interaction redelivery or integrated draft policy proof.

Fixed bounds: native journal/entry association and tool-owner tables 4096; native notification bytes 8 MiB;
per-live item 512 KiB; derived journal 60,000 records/32 MiB; per-follow queue 256 frames/1 MiB; source history limits
remain #34's limits. Oversized/unrepresentable observations emit an explicit live gap, and native/derived eviction
fails affected cursors/generations. No transcript or provider chunks are persisted by Host.

## Evidence and reproduction

The accepted seams are the real browser → DSH Connection/typed Remote/controller/Conversation → Bun → actual
matched OMP CLI `rpc-ui`, complemented by native AgentSession/data/schema and labelled adapter contract faults.
No seam interview or OpenSpec workflow was added. Native idle custom delivery has a recorded failing test before
its persistence hook, followed by passing public native behavior. Initial lifecycle association likewise failed
before the native observation API existed. Equal content/timestamp dedup is an explicit no-entry outcome, never
an inferred old-entry join.

The provider extension registers through native `registerProvider` and `registerTool`. It returns deterministic
in-process fixture streams and tool results; these are **controlled-provider evidence, not real AI inference**.
The egress preload runs before any ordinary native import. HOME/profile/cwd/environment are explicitly synthetic,
provider selection is verified by public `get_state` before every prompt, and no real key is supplied. `--offline`
still attempts metadata discovery: the final shutdown guard reports 15 blocked attempts in each browser worker,
zero dispatched requests. Independent `strace -f -e trace=network --kill-on-exit` reports zero INET connects/sends.
Counters are read after worker exit, never from the guard's initial zero-valued file. Each owned worker drains with
exit 0, no force, before its synthetic profile is removed.

```sh
export PATH=/workspace/work/rpc-public-module-probe/tooling/bun/package/bin:$PATH
bun scripts/prepare-compatibility.ts --reset --source-only
bun scripts/build-compatibility.ts
bun scripts/build-compatibility.ts --check
bun run check
bun test compatibility/omp/fixtures/live-native.test.js
bun test compatibility/omp/fixtures/live-public-rpc.test.js
bun test tests/live/projection.test.ts
bun apps/live-fixture/build.ts
bun scripts/verify-live-browser.ts
```

The browser verifier covers a stable persisted-source opening, same-content distinct native entries, dense DSH
seq/assistant revision/index and exact final settlement without duplicate rows; navigation invalidation/manual
same-ID reopen; and a **separate** native first-materialization source/context transition that explicitly fails
and then manually reopens. Each old physical follow receives one snapshot. Both paths preserve the independent
fixture textarea. Native tests cover nested external/custom messages, no-entry dedup/one-run contexts, background
append, same-shape rewrite, delete/reparent, scoped reused tool IDs, original-object branch re-emission, 4096-association
eviction and a real native ~36 MiB source that explicitly exceeds the 32 MiB derived journal budget. The actual CLI
also exercises genuine controlled tool execution and native live-buffer overflow with event filtering enabled.

Current verification: ordered native build and generated `--check` PASS; `bun run check` PASS with 151 tests /
1,279 assertions across 32 files and Host build; both Chromium scenarios PASS. Exact checkpoint source, schema,
asset, owned-source and retained strace digests are in `evidence/live-checkpoint.json`.

## Genuine unfinished gates at this checkpoint

- Final #31/#33/#34 canonical source tuple and current integration merge/reverification are pending coordinator
  reactivation. Current evidence/build identities describe the checkpoint's declared ordered patches only.
- Full #35 AC1–5 review/acceptance remains pending. The native `failed`/classifier-refusal/empty-error/rewind and
  replaced-prompt no-entry branches need dedicated positive/negative settlement evidence beyond implemented
  decisions; current tests do not turn untested branches into PASS.
- Opening a derived view during an active native prefix explicitly refuses/requires reopen. The native same-cut
  running cursor exposes exact prefix identity, but this checkpoint does not yet build an active-attempt opening
  baseline. Unknown/unrepresentable live categories fail explicitly; final typed native/tool rendering is not claimed.
- Full multi-holder reset, integrated drafts/attachments/Interactions and private product admission remain later
  integration gates (#39/#40 and dependent product slices). A manual fixture reopen is not that public reset API.
- No durable submission/commit receipt (#36), immediately persistent navigation (#37), full product browser, real
  provider inference, or Windows support PASS is claimed. Formal latency/RSS acceptance remains #60.
