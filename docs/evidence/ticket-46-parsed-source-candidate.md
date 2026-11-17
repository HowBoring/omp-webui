# Ticket 46 normalized parsed Tool source candidate

Status: **UNREGISTERED_SOURCE_CANDIDATE; FRESH PAIRED REVIEW PENDING**.
Whole tickets46/29 remain OPEN. Private/global Session admission remains BLOCKED.

This candidate starts at integration `42769489183eedb20b371083c49f915fda2bb8cf`.
It extracts the authored parsed Tool slice from original Host source
`429994a10872c9d090e967e3d1ec9a83f3bbd4c7` (tree
`2d7d61f3155acec304de0df603ac45b648e18eec`), whose authored fixed base is
`8322179bb64f2ef292da3b7d803ce4ebdcb89ef1`. The original worktree and its source,
raw evidence, assets, sparse DSH index/source and dependency state are preserved.

A full merge of the original ticket branch would also import208 inherited non-slice paths,
including historical Host/session modules, generated contracts, Native patch0007 and assets
changes. Those are excluded. This candidate records only source proposals, fixtures and docs;
it does not mark that unrelated history as merged or imply review of those product modules.

## Selected source and active boundary

The authored slice has15 paths. Fourteen are copied, with only the compatibility README
adjusted to describe this normalization. The fifteenth, the ACTIVE
`compatibility/dsh/patches.json`, is deliberately excluded: integration's patches1–3
manifest remains byte-identical. The upstream lock, normal Host entrypoint, assets,
package scripts, HTTP gating and current generated/public contract admission are unchanged.

The separate [candidate descriptor](../../compatibility/dsh/parsed-tool-source-candidate.json)
records all six exact source patches under `UNREGISTERED_SOURCE_ONLY`. No current code
reads it. The unchanged `scripts/dsh-source.ts` consumes only the unchanged active manifest.
Source patches4–6 are inert proposals. Patch4 is the additional source prerequisite absent
from integration; patch5 was already part of the authored parsed slice. Neither introduces
its corresponding historical Host/Native runtime modules into this composition.

Patch6 contains the parsed public event and `ToolCallArguments` source definitions, plus
Chat/Trajectory/generic inert JSON presentation. The formatter remains private to Trajectory.
No new event is emitted or admitted to the generated known-event catalog. Old readers must
still refuse an unknown required event. Complete persistence/catalog generation, compatibility
acknowledgement, bilingual pairing, consumer checks, matched builds and runtime admission
remain later gates. No generated allowlist, missing-contract stub or Host registration is added.

The original [source evidence](ticket-46-parsed-tool-source.md) and accompanying JSON are
copied byte-for-byte from the original source commit. Their status text, source locations,
review-pending statements and logs describe that historical source worktree. This document
and its [JSON inventory](ticket-46-parsed-source-candidate.json) describe the new composition.
Existing reviews cover the original slice; they are not approval of this normalization.

## Fresh checks and limits

Fresh static reconstruction verifies every patch SHA256 and all six declared intermediate
DSH trees. It uses a separate temporary Git index/object directory with original sparse Git
objects borrowed read-only; it writes no original source, vendor index or object store.
The final source tree is `2440ab8cdd85b85013aff36d3af60edb1b311e27`. This is a source
composition check, not a complete DSH checkout or a build. The JSON inventories selected
bytes and verifies protected active inputs against the integration base.

No DSH source, vendor tree, dependencies or generated output is copied to this worktree.
The retained fixtures therefore require future explicit preparation of exact source before
running here. No new test seam or runtime shim is introduced. The earlier source evidence
records a clean scoped public-contract compile and one SSR test with17 assertions. They are
historical, not rerun acceptance of this candidate. The broader89-baseline/89-candidate
strict result was not rerun and is not a whole-source strict pass. Known-key dispatch,
Trajectory and interruption remain source-inspected coverage limits.

No imports, Bun tests, full typecheck, generation/build, Native/FFI, Host/OMP/provider,
browser, sockets/listeners, process inspection or runtime admission ran for normalization.
Native owner association after reopen remains unimplemented. Fresh paired Spec/Standards
review of this exact candidate is required before a source-only merge. No ticket was closed,
no PR was marked ready, and no merge or push was performed.
