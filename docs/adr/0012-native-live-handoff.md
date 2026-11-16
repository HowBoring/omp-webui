# ADR 0012: Observe exact native decisions and hand off one immutable live cut

- Status: Implemented isolated S0 component; private product admission remains closed
- Date: 2026-11-16
- Ticket: [#35](https://github.com/HowBoring/omp-webui/issues/35)

The Host receives source snapshots, source changes and live decisions exclusively through public native RPC.
Native original-object associations and the existing assistant entry Symbol establish the exact entry at the
actual append decision. A duplicate without an authoritative link reports no new entry; matching content,
time, hashes, reusable raw tool IDs or adjacent appends cannot establish identity.

Memory visibility and a successful append notification do not attest recoverability. Cuts and settlements
say `not_attested`; decisions distinguish observed, failed and no-entry. Empty-error skips are provisional
until real terminal maintenance either appends the original object or ends with no entry. Durable submissions
and native persisted provenance remain #36.

Default #34 snapshots remain strict. The additive public `handoff: live` option preserves one immutable native
cut while verifying append and runtime-prefix progress. Full retained payload fingerprints and context digests
remain fences, including model/tools/system-prompt changes, branch jumps and mutations hidden by later appends.
Fingerprints verify consistency; they never join lifecycle messages to source entries. A same-snapshot live
cursor supplies exact unresolved/runtime-prefix identities for a legal derived DSH assistant baseline.

The derived bounded journal is disposable. Seq, assistant revision/attempt/index and pages describe that one
presentation generation, not a durable native journal. Source discontinuity, gap, missing exact association or
budget eviction explicitly fails the view. The pre-#40 acceptance page uses public final retain/release and a
manual same-native-ID full-view reopen. It sends one snapshot per physical follow and preserves only its
independent DOM draft. Coordinated multi-holder rebuild, Interaction ownership and integrated draft/attachment
preservation remain #39/#40 integration obligations; no private resync or surface replacement implements them.

Evidence uses isolated synthetic profiles, an egress guard before native imports, genuine AgentSession/CLI
streams driven by legitimately registered deterministic providers/tools, and the actual DSH
Connection/Remote/controller/Conversation/Trajectory assembly. This is controlled-provider component evidence,
not real AI inference, full product rendering or private Session access. Windows delivery remains deferred.
