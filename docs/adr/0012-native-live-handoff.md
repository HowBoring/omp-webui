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

The #60 Host opening reads each Native page of the same complete cut and assembles one contiguous record
at a time. It verifies part IDs and measures the joined text’s UTF-8 JSON bytes before assembly. The active
rows must form the parent chain ending at the cut’s leaf. A streaming row must match the opening cut’s
prefix marker. The Host records each DSH event’s byte count once and uses it to size later group pages.
The complete derived journal still has a 32-MiB encoded-record budget and visibly invalidates at overflow.
An invalidated journal refuses reads. Detecting a reused numeric sequence at its successor depends on the
caller routing pages with the projection generation binding.

Older payload eviction requires asynchronous Host page and snapshot reads with an immutable DSH seq/group
index and a current-source check before publication. The opening hands off and closes its Native snapshot.
The existing forward-only cursors are scoped to that snapshot and depend on its expiration, shared snapshot
quota and retained observation coverage. Rereading under a fresh cut would require verifying the old active
prefix and its projected records before returning them. The admitted public API still has forward-only
history cursors.

The dormant Host archived reader uses the authored Native active history index at
`4b032a949cb40764dfa803b7d5ce1ba1f314f214`. The projection owner provides a trusted joint Native and
Broker Stop snapshot for the exact worker, Session and cut. A running or unverified opening refuses this
path. A Browser View supplies its own generation and authority check for each request. The reader
rechecks authority after I/O and requires the original snapshot, cut, expiry, contiguous ordinals and
matching part identities. Native authenticates request keys using an opaque digest of the source entry
for that handle. The contract provides no independent readable body hash or byte length. The Host checks
encoded bounds and assembles text from validated parts, preserving the existing DSH text representation.
Original verification stays at its public attachment boundary.

The index retains metadata and DSH sequence coordinates under the Native 8-MiB encoded index bound.
A page hydrates at most 128 candidate groups. Each read retains a bounded Native page, one assembling row
and the newest projected groups that fit the DSH page budget. Up to four reads per archived generation may
be in flight. The source may scan retained Native fingerprints on every call. Expiry or failed source
proof requires the projection owner to obtain a new protected cut and retire the prior generation.
Live appends, matched SDK/codec generation and product composition remain open. The current product and
fixture routes still use the eager journal.

The isolated Host fixture represents 10,000 rows with over 100 MiB of text and checks the initial and split
old page, exact DSH output at mixed-role and encoded-byte boundaries, and unsettled, cut-change and
revocation failures. Reference-hardware first-screen latency, old-page latency, full corpus reachability
and Host RSS remain open #60 acceptance work.

Evidence uses isolated synthetic profiles, an egress guard before native imports, genuine AgentSession/CLI
streams driven by legitimately registered deterministic providers/tools, and the actual DSH
Connection/Remote/controller/Conversation/Trajectory assembly. This is controlled-provider component evidence,
not real AI inference, full product rendering or private Session access. Windows delivery remains deferred.
