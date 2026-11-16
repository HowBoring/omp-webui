# Live settlement and immutable-cut handoff candidate (#35)

This is the isolated S0 #35 component candidate. Product private Session admission stays blocked. The ordered
native source is 0001–0004 plus additive `0006-live-settlement.patch`; #32/0005 is not a dependency. Final #31,
#33 and #34 source and the current integration branch are merged. Linux Chromium is exercised. Windows
Chrome/WSL2 remains deferred by the owner. Independent coordinator review/acceptance is separate.

## Review correction: shared native context identity

The low Central Utilities finding is resolved by one pure `session/history-context.ts` helper, called by
`SessionManager.getHistoryMessageContext` and `RpcHistoryObservation.#capture`. Each caller passes its already
available source ID, context revision and context-content revision. The helper preserves the exact JSON envelope
and property order (`source`, `contextRevision`, `contextContentRevision`) and performs no capture, mutable reads,
or heavy imports. The helper is declared in `scripts/omp-source.ts` and covered by the narrow authored-native
strict check. Patch 0006 was regenerated against the exact 0001–0004 tree; 0005 is excluded.

Fresh evidence for this correction is [live-review-fix.json](evidence/live-review-fix.json). Native source is now
`4764ff2640a6caf4906c2c4d337e3cceda093f51b720911086cc196b7f1b4871`; schema remains
`dcc2efba3634fed2599bde4eb61730ec0ae2d3e47dd7bc55a7909097a443377b`. Regeneration changes only the Host generated
identity; all public schema/client/validator outputs and algorithms are unchanged. The original
[live-checkpoint.json](evidence/live-checkpoint.json) remains evidence of its earlier source, including the prior
full 194-test result; that result is not claimed for the new native hash.

Clean ordered native build/generated verification, eight authored native modules, Host strict TypeScript and
Host build pass. The focused 64-case run passed 63 cases and exposed one existing asynchronous overflow-test race:
the final after-settled poll could receive the same allowed explicit invalidation as the initial poll, outside
its specific catch. Both polls now use the existing `empty-overflow` / `live_projection_invalidated` handling;
other failures still throw, and the final invalidated journal must still reject snapshots. The complete settlement
suite then passes 6 cases / 21 assertions. All 19 native live, 19 coherent-history native and 9 actual public native
RPC cases passed in the focused run. Failure and rerun logs are retained with digests. No helper-formula mirror
test was added: existing lifecycle-to-cut equality, coherent capture, context-change fences and handoff tests
exercise the real boundaries. The initial default-sandbox native OS file-lock EPERM is also retained; that case
passes with the documented network-enabled execution permissions.

All six Chromium scenarios were rerun against the new native source tuple, using the unchanged canonical DSH
`c0b09e15c170a82894608c397a363a7a96e5d05c` source. The narrow live browser build reproduced all 667 input identities
and both browser assets exactly; no full unchanged DSH package build was repeated. Every scenario passes, each
guard reports 15 blocked / 0 dispatched, each syscall trace has zero INET connects/sends, and all owned workers
exit 0 without force before profile removal. New trace/screenshot/log digests are in the new evidence file. The
combined full suite remains the later merger gate; Windows and the component/product limits below are unchanged.

## Native public contract

The existing `history_observation_poll` now returns native source metadata and safe readable payloads, plus scoped
`message_start`, `message_update`, `message_final`, provisional `message_decision`, and final `message_settlement` facts. Every cut adds native mutation
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
The native public SDK helper `getHistoryMessageContext` uses exactly the same context digest as coherent cuts.
Host imports only matched public RPC modules. It never reads native Session files or imports the native runtime.

Empty-error skips are provisional because genuine terminal maintenance can append the original object later.
Exactly one final settlement follows that actual recovery decision. Lazy native error classification is
materialized before assistant entry publication; complete entry fingerprints still include the resulting field.
A late frame carrying the original native Symbol keeps its identity, and cannot restart a settled attempt.
Queued persistence captures its initiating lifecycle before yielding, so immediate reuse of the SAME original
object still settles each lifecycle correctly (a dedicated failing test preceded this correction).

The additive `history_snapshot_open({scope, handoff: 'live'})` retains one immutable cut while runtime prefix
progress and verified appends continue. Default #34 behavior remains strict. A fourth same-snapshot `live` cursor
contains exact unresolved ended messages and the actual streaming prefix. Prior header/entry fingerprints,
source/Session/context digests and contiguous bounded mutation records must all remain compatible. Runtime-message replacement/reorder also emits `native_runtime_replaced`; runtime append must carry exact
lifecycle/original-object authority and only pending finalization may change an existing runtime object. Only
leaf-preserving background appends or direct active-chain extension are allowed. Model/system/tool configuration,
branch jumps, retained/new-entry rewrites, delete/reparent, source/worker changes, compaction and gaps fail the
binding. No broad append exception bypasses a context fence.

## Derived DSH generation

`LiveJournal` reads one public native cut, groups lossless continuation parts, and derives immutable contiguous DSH
seqs with real native Session identity. Pages use inclusive `throughSeq`, exclusive `beforeSeq`, chronological
records and source-message group boundaries. Old cuts reproduce the same rows while live appends extend the
journal. The assistant baseline is mandatory even when idle. Live assistant revisions and chunk indices are dense;
final native content replaces temporary presentation through the stock controller's settlement machinery.
Derived chunks/times are presentation values, not original provider timing/chunks or a durable native journal.
Actual provider/model fields are retained from the safe native mapper. Structural records remain marked native
records. This candidate uses the stock Conversation/Trajectory assembly with a small JSON renderer, not the full
product shell or the final typed native/tool renderer.

A source/runtime/context change, irreparable gap, unavailable association, old/out-of-order poll, or eviction fails the old
generation explicitly. The acceptance page hides its rows, releases the actual public controller reference, then
requires a manual full-view reopen. It never calls private resync, sends a second snapshot on the old physical
follow, uses surface replacement to delete branches, or changes the native Session ID to clear the view. Final
release obtains a fresh controller and Conversation binding. Coordinated multi-holder rebuild remains #40.
The fixture's independent textarea survives this local release/reopen. This proves **fixture DOM draft survival
only**, not integrated #39/#40 draft/attachment preservation. Native execution/Interaction ownership is separate;
this fixture does not claim an Interaction redelivery or integrated draft policy proof.

Fixed bounds: native journal/entry association and tool-owner tables 4096; native notification bytes 8 MiB;
per-live item 512 KiB; derived journal 60,000 records/32 MiB; per-follow queue 256 frames/1 MiB; source history limits
remain #34's limits plus live fingerprints (scanItems 40,004). Native polls cap 128 events / 768 KiB. Opening stage is
bounded to 60,000 parts / 256 MiB, pending associations/attempt chunks 4096 / 8 MiB; snapshot baseline must fit 768 KiB. Oversized/unrepresentable observations emit an explicit live gap, and native/derived eviction
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
# Full-suite source-fault tests need an OWN writable source-only DSH clone at vendor/dsh.
# Recreate it from the local canonical candidate; do not point these tests at shared source.
git clone --shared --no-checkout /workspace/work/omp-webui-ticket-39-final-fix/vendor/dsh-final vendor/dsh
git -C vendor/dsh checkout --detach 38a6a5c965aa99ab525161efb7cc5cf1fe62fced
bun scripts/dsh-source.ts vendor/dsh --apply
bun run check
bun test compatibility/omp/fixtures/live-native.test.js
bun test compatibility/omp/fixtures/live-public-rpc.test.js
bun test tests/live
bun scripts/check-live-native.ts
bun apps/live-fixture/build.ts
bun scripts/verify-live-browser.ts
```

The source-only negative-test clone was removed after acceptance to reclaim 258 MiB; unique native source,
served assets and raw evidence remain. Recreate that clone with the commands above before rerunning the full suite.

The browser verifier covers a stable persisted-source opening, same-content distinct native entries, dense DSH
seq/assistant revision/index and exact final settlement without duplicate rows; navigation invalidation/manual
same-ID reopen; and a **separate** native first-materialization source/context transition that explicitly fails
and then manually reopens. Each old physical follow receives one snapshot. Both paths preserve the independent
fixture textarea. Native tests cover nested external/custom messages, no-entry dedup/one-run contexts, background
append, same-shape rewrite, delete/reparent, scoped reused tool IDs, original-object branch re-emission, 4096-association
eviction and a real native ~36 MiB source that explicitly exceeds the 32 MiB derived journal budget. The actual CLI
also exercises genuine controlled tool execution and native live-buffer overflow with event filtering enabled.

Final verification: clean native build/generation and authored native TypeScript PASS; full suite 194 tests / 1,619 assertions / 42 files plus Host build PASS; six Chromium scenarios PASS. Exact reproducible identities are recorded in `evidence/live-checkpoint.json`.
The file retains its checkpoint name for continuity; its status distinguishes the final component candidate.

## Coverage and limits

The additional active-opening browser case adopts a real native prefix as a legal DSH baseline, then renders
its later exact final once. A public HistoryClient latency fixture sustains native prefix progress and a genuine
extension append across multiple immutable native pages, proving one native snapshot and no gap/duplicate.
Public native abort settles an adopted attempt without replay. Real classifier refusal/sensitive, provisional
empty error with/without later recovery, native write exception, latched backing failure, sealed drop, replaced
prompt, genuine checkpoint/rewind and late original-object delivery have dedicated settlement proofs. The real
extension input transformer adds equal-content custom/user messages; handled input invokes no fabricated live
lifecycle. Native display deobfuscation produces an unequal-content copy while settlement still names the exact
original stored object. DSH component tests cover final/abandoned attempts and explicit maintenance/rewind failure. Actual Chromium
also covers refusal abandonment, terminal empty-error recovery and genuine checkpoint/rewind using the stock
DSH controller/Conversation/Trajectory components. Six final traces show zero INET connects/sends; each native guard
reports 15 blocked / 0 dispatched and every owned worker exits 0 without force.

An opening with unresolved earlier runtime finals whose order cannot yet be legally represented, missing
native identity or ambiguous reusable tool owners fails explicitly. Oversized sources/prefixes, old/out-of-order
polls, overflow and eviction also fail within declared limits. This candidate does not claim unbounded recovery.
Native source-only records with no lifecycle are projected directly from their authoritative public entry;
source notifications alone never produce a durable receipt or a guessed live association.

Full multi-holder reset, integrated drafts/attachments/Interactions and private product admission remain later
integration gates (#39/#40 and dependent product slices). The fixture proves DOM draft survival only. No durable
submission/commit receipt (#36), immediately persistent navigation (#37), full product browser, real provider
inference or Windows PASS is claimed. Formal latency/RSS acceptance remains #60.
