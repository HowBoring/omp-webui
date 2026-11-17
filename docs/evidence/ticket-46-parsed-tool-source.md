# Ticket 46: parsed Tool presentation source patch

Status: **SOURCE_PATCH_PREPARED; EMISSION/BUILD/ADMISSION BLOCKED; FRESH PAIR REVIEW PENDING**.
Tickets 46/29 remain OPEN. Normal/private Session admission remains blocked.

Historical source proof remains immutable at Host commit
`fa78f91b93c686d22d9ac977aea7a4adb869a892`, following implementation checkpoint
`879c1244adda2d83e531cf960b2d75d647af5adb`. Read the evidence paths at that commit
for their original patch/tree pins and checks. Its documentation-only numbering
correction assigned [ADR 0023](../adr/0023-dsh-parsed-tool-presentation.md), preserving
ADR 0022 for supervised Session Index work; ADR 0023 is unchanged by this follow-up.

The external Spec review found no blocking source-slice issue. Standards requested
one P2 correction under DSH client Export discipline §1/§3: `toolArgumentText` must
stay private to its only runtime consumer, Trajectory. This review-stage refactor
moves the identical formatter into Trajectory's layout module, removes its public
Conversation value export and the cross-plugin runtime import, and retains public
`ToolCallArguments` as a type-only dependency. Affected English/Chinese package
READMEs and local JSDoc describe that ownership. No new public runtime API or
private cast is introduced. Fresh focused review remains pending.

The clean ticket 46 worktree at `6a82eca5644e6e2ac393e03d2cd118c6288b622e`
was preserved as `preserve/ticket-46-before-parsed-arguments-6a82eca`, including its
existing source, empty index, ignored tool-preparation evidence and historical tuple
records. Integration `42769489183eedb20b371083c49f915fda2bb8cf` was merged only into
this owned branch as `8322179bb64f2ef292da3b7d803ce4ebdcb89ef1`; no reset or canonical
worktree write occurred. Existing evidence files are historical, unchanged and are not
claims about this patch.

The local implement-spec, TDD/tests/mocking and codebase-design guidance, actual pinned
DSH AGENTS/client/architecture/persistence/UI guidance and the external issues29/46 and
research notes informed this slice. Tests use the already accepted public DSH module seam.
No fresh test seam or user approval flow was invented.

## Public source change

Patch 6 adds a distinct required `tool/parsed-call` event carrying a JSON object.
Existing `tool/call.arguments: string` and `llm/llm` raw model blocks remain unchanged.
`ToolCallArguments` discriminates exact raw strings from parsed objects without `argsRaw`.
The public new-event envelope forbids `ignorable: true`. Chat and Trajectory preserve
that representation through start, final result, interruption projection and replay.
Trajectory privately formats text-only details, wrapping the new parsed arm in explicitly
labeled JSON. No formatted
object from `tool/parsed-call` is claimed to be original model text. Pre-existing PTC
dispatch projections still serialize their unknown arguments into legacy `argsRaw`;
those unrelated paths are unchanged. This slice does not repair their representation
semantics or claim original model spelling for PTC dispatch arguments.

The same existing Tool tree, slot ownership and GenericToolCard are used. Parsed calls
select its generic inert JSON path even when their tool name normally selects a keyed
business view; raw dispatch stays unchanged. The locale-owned expanded label identifies
parsed arguments. Parsed rows provide no argument file links/downloads or raw HTML.
Approval command extraction excludes parsed display calls; schedule's optional raw-title
fallback accommodates the union. Neither display path supplies execution authority.

Affected public package READMEs/JSDoc and translated README text accompany the patch.
Bilingual pairing records and generated persistence inventories/catalogs are deliberately
not regenerated; those are explicit later gates, not completed checks.

## Exact source and cohort

`compatibility/dsh/patches.json` pins release commit/tree and every ordered patch hash/tree.
Patches 1–5 were read/copied from the reviewed ticket45 manifest and their bytes preserved.
Patch 6 applies after tree `b7d45d6871e1b004df6d745738b8fc008c79b262`. All six ordered
patches were applied to a separate owned Git index; every declared intermediate tree
matched. After the export correction, the six patches were reapplied to a new owned
index and every intermediate tree matched again. Patches 1–5 remain byte-identical
to both the historical checkpoint and reviewed ticket45 exports. Patch 6 now ends
at DSH tree `2440ab8cdd85b85013aff36d3af60edb1b311e27`; its SHA256 is
`67556c5f17cd45491273513992646e2975727823db153d93ef50caff55db943d`.
All 25 owned affected source files hash to the new export, and the corresponding
read-only baseline files hash to the patch-5 tree. The JSON records the seven-file
DSH delta from the immutable historical tree and current source/export pins. The owned
source index now records the same final tree; its prior bytes are preserved locally.

No owned DSH checkout existed initially. Disk availability was 94 MiB, so this slice
created only an ignored sparse source/index and exact changed Git objects, borrowing
baseline objects/dependencies read-only from ticket45. No full clone, installation,
ELF/vendor copy, upstream float or shared45/34 source/index/dependency mutation occurred.
The sparse preparation is not eligible for the complete-source gate or a build.

The owner-reported ticket45 NativeDA/schema0b7/DSH3d81761 cohort is a historical runtime
reference only. This work does not attest those built bytes and does not enroll patch 6
under that identity. The upstream release lock and Native wire/schema are unchanged.

## Verification

The existing meaningful tests were reused for this refactor; no new test seam or
implementation/export-shape test was added. Fresh results are the same 17-assertion
pure fixture and clean strict public contract fixture. The strict source overlay
was rerun against the same patch-5 baseline source with all 15 affected TypeScript
modules as roots: baseline 89, candidate 89, introduced 0. Fresh baseline/candidate
logs are byte-equal. One historical TS2367 message enumerated equivalent union
members in a different order; the fresh comparison uses full diagnostic messages
without weakening compiler flags. Historical logs remain untouched; new logs use
`vendor/tool-preparation/export-fix-*` names and are hashed in the JSON.

The current checks use Node 24.22.1, existing TypeScript and the retained Bun 1.4.4
executable with the original no-env-file, tsconfig and preimport guard arguments.
An initial `bun` invocation failed before loading the fixture because Bun was not
in PATH; the retained absolute executable then passed. No tools or dependencies
were installed or copied. Original RED and presentation-source typecheck evidence
below remains historical; no new RED is claimed for this behavior-preserving move.

- Meaningful RED: the actual public ConversationNodeAssembler emitted no Tool row for
  `tool/parsed-call`; the expected parsed public record assertion failed. Earlier harness
  setup failures (missing public built export/dependency resolution) were not counted as RED.
- GREEN: one public module/React static-rendering fixture, 17 assertions. It checks exact
  raw spelling, parsed objects without a raw field, explicit expanded label, escaped
  HTML-like text, no argument anchor/download, final text and native-style `isError` replay.
  This is controlled DSH replay, not Native reopen or durable ownership evidence.
- Strict public contract fixture compiles cleanly. Expected compile failures cover ambiguous
  raw/parsed material, wrong event payload representations and making the new event ignorable.
- The strict no-emit source overlay reads the exact same read-only patches1–5 source for
  baseline and candidate; only owned changed source substitutes in the candidate. Compiler
  strictness is unchanged. All introduced diagnostics were resolved. The fresh baseline and candidate each report 89 diagnostics, with zero introduced
  diagnostics by normalized file/code/message comparison. Counts are recorded in JSON; a baseline failure is not a clean full typecheck.
- The fixture directly exercises GenericToolCard, not known-key ToolCallTree dispatch,
  Trajectory or interruption; those paths remain source-inspected coverage limits.
- The guarded fixture denies network, processes, listeners, Native packages/FFI and native
  binary module loading before composing pure DSH/React source. No actual tool executed.

No full upstream build, generation, browser, Native, OMP, Host/listener, SDK, credential
lookup/download, serializer, kernel/helper/probe runtime or runtime acceptance ran.
No full repository suite ran because it includes out-of-scope runtime fixtures.

A scope deviation occurred: one read-only `ps -o pid,etime,rss,args -C node | head -4`
command was inadvertently used while checking TypeScript completion. It returned only
`PID ELAPSED RSS COMMAND` and no process rows. No process was signaled or changed; no
further process census was performed. This is recorded rather than claiming none occurred.

## Required later gates

Before emission: fresh independent Standards/Spec review; upstream persistence/catalog
and public descriptor generation plus compatibility acknowledgement; bilingual pairing;
complete exact-source consumer/type/build checks; new frozen cohort identities and admission.
The current generated vocabulary intentionally has no parsed event entry, so unsupported
readers must refuse this unknown required event. No manual generated allowlist bypass exists.

Native durable owner/context association after reopen remains UNIMPLEMENTED. No Host
projector was registered and no call-ID-only association was promoted to Native authority.
Real NativeRPC → Host → DSH browser tool/reopen, reused IDs, errors/cancellation/batches,
background results and special messages remain untested and blocked. SOURCE preparation
cannot clear whole46/29/MVP, global-runtime or private-admission gates.
