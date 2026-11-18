# #41 R18 actual current-C backpressure evidence

**One R18 current-C synthetic external backpressure window reached `PASS_DRAINED`.**
This covers the fixed synthetic broker and FakeDispatcher case only. Native authentication, real services,
public Host/FFI, private Session and global/product admission remain unestablished or BLOCKED.
[#41](https://github.com/HowBoring/omp-webui/issues/41) and
[#29](https://github.com/HowBoring/omp-webui/issues/29) remain open. External EPIPE is NOT IMPLEMENTED/NOT RUN.

The [JSON summary](ticket-41-current-backpressure-r18-actual.json) gives exact source export mappings,
manifest identities, selected protocol frames, bounded measurements and provenance SHA256. Provenance
paths resolve under `/workspace/work/mvp-implementation`; public stage journals remain outside Git.
No raw log, binary, key, vendor checkout or generated runtime file is included.

## Exact consumed window

Production base: `602f4988c7e09b8d3d7d708b07fc36e4516b560a`.
Original R17 fixture source: `b38e5a69caf1de8888ef36799740d1f021fafa30`.
R18 source packet: `recovery/r18-current-backpressure-source-v1`.
SourcePlan SHA256: `ec3a99da023046e9b974ecf159dbd2e39a894347db27aefb2396bdff1d68046b`.
Stage: `/tmp/omp-external-current-backpressure-r18-20261117`.
Marker: `external-current-602f498-backpressure-r18-v1`.
Generation: `c9e341885be6939f08db8d9d1336351af3f136a4fd4fcd76861fa3580fa11382`.
Manifest SHA256: `df31ccdbe3760b7bfa0a85f75fe2e2654b8c7d5cd8700831fa3926f3b76d84a6`.
This one-use scope is consumed; it must not be rerun or reset.

Root Source reviews were `reviews/ticket41-r18-current-backpressure-source-spec.md` and
`reviews/ticket41-r18-current-backpressure-source-standards.md`, both SOURCE GO. Separate exact unsigned
artifact reviews were `reviews/ticket41-r18-final-artifact-spec.md` and
`reviews/ticket41-r18-final-artifact-standards.md`, both GO for artifact suitability. Root separately
cleared one literal-manifest window. Preparation `da1c48`, root compilation `f48d6a`, protector compilation
`6b542d` and sealing `9553dc` each reached exit 0; those receipts alone were not runtime acceptance.

Original runtime tool `6be000` retained session `41136`. Fresh Root before-START inspection `021679`
matched original guardian `683817`, held fd `16`, PIDFS `5:693410`, controller `683813` and fixed broker
`683818`; business had not started and all 22 artifact pins matched. Root then supplied the emitted fresh
original-stdin challenge command. Final chunk `164822` reached original tool EOF/exit 0.

## Actual observation and cleanup

The public journals record exact HELLO/waiting/running frames, START intent, fixed broker X intent and
natural `ROOT_EXIT <generation> 0 0`. FakeDispatcher held completion acknowledgement while the fixture
filled the retained duplicate of the fd3 stream. Actual `EAGAIN` was errno `11` after **8,128 bytes**, using
4,096-byte write requests, below the strict 1 MiB bound. After fake completion ACK, 23 loop observations
plus the final check retained identical fence bytes, denied exclusive maintenance locking and observed
the original guardian live. The recorded interval was **0.25418936801725067 seconds**.

The pinned adapter then closed the exact fixture duplicate, checked all expected `!` filler bytes,
checked exact COMPLETE and empty control EOF, and collected original guardian wait 0. Filler read bytes
were not separately logged: this is adapter-checked drainage supported by the pinned code and subsequent
PASS journal, not an invented raw read transcript. Guardian stdout/stderr and controller stdout/stderr
all reached EOF and their reader threads joined. Controller and outer direct-child domains reached
ECHILD; original controller wait was 0. Final fence was absent and the exclusive maintenance lease was
free. No manual recovery was used. These are the fixture's bounded ownership/cleanup proofs, without a
claim of general descendant extinction.

Root post-preservation `e4f722` reached exit 0 and rehashed all 22 immutable manifest members plus all
137 Native files and Native HEAD/status/index/staged/worktree state as unchanged. This evidence commit
independently re-read all 22 public member hashes and clearance stat identities, packet/SourcePlan pins,
public journal hashes, individual/full tool-result equality and listed provenance hashes. It performed
no new Native measurement or action.

## Auditable source reference and limits

The [source delta](ticket-41-current-backpressure-r18-source.patch) is a public textual reference only.
Its `a/` paths name original b38 repository fixtures; its `b/` paths name the exact outside-Git R18 packet
relative to the evidence store. New public packet members use `/dev/null`. The JSON maps all 13 packet
files, including the unchanged fixed C root, with original/export hashes. The patch was not applied and
adds no executable entry point. Its embedded ROOT, paths, marker and generation identify this consumed
Root scope. Future reproduction requires a fresh reviewed generation/path, artifacts and Root clearance;
embedded historical commands grant no authority.

The three runtime Python modules add fd3 constructor metadata, scrubbed refusal codes, sticky pre-HELLO
byte/original-terminal observations, narrow startup-74 failure drainage and explicit reader joins. Outer
collection now preserves original wait/EOF/joins/ECHILD for explicit failure 3 even without business start.
The supporting delta includes R18 stager identity/proof closure, pure-test adaptation, new startup tests,
README, SourcePlan, public caps, startup proof, validation receipt and checksum inventory.

The retained source validation records 31 pure tests. **The actual startup-74 refusal case was not run**;
`FAILED_DRAINED_STARTUP74`/status 3 remains failure, never PASS. R17 remains its separate pre-START exit-74
FAIL with manual kernel-terminal disposition; its exact cause is unresolved. Successful self-exec and
exact-Popen diagnostics were prerequisites and establish neither the R17 cause nor a fix.

All eight original Source additions, the four production C inputs and fixed synthetic C root remain
byte-identical. No existing R17/R18 sealed input was rewritten. Historical SOURCE READY/NOT RUN and
manifest READY_NOT_RUN labels describe their sealing boundary and remain unchanged. This commit adds only
the evidence pair and source-reference patch. No tests, build/compiler, runtime/stager import, process or
proc observation, pidfd acquisition, signal, actor, Native, key, Bun/Node, old-tool control, push, merge or
GitHub operation ran during this evidence work.
