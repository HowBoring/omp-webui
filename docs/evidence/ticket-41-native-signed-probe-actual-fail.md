# First signed probe: actual bootstrap failure

Root built, independently reviewed, signed and froze the synthetic attempt at
`/tmp/native-signed-probe-restore7-a`, then authorized one actual run. That consumed
attempt **FAILED before the first Native-bearing import** with
`PROBE_LAUNCH_CLOSURE_CHANGED`. It must never be reused.

The original C entry reached the canonical Bun in PID 565394. The retainer observed
actual exit1, original pidfd kernel exit, both original output EOFs and authoritative
`P_ALL/ECHILD`, with no signals, helpers or prepare. `exclusiveControlAvailableAfterExit:false`
means **NOT PROBED ON FAIL**: the clean-success predicate short-circuited that check.
It is not evidence of a retained lock. No Native fd handoff, module/FFI load,
server/client work or EOF close phase passed. Private/global admission stays BLOCKED.

Before source edits, independent preservation verified all 102 frozen input byte
digests and original stat pins against the consumed READY. The bounded archive holds
the signed approval, unsigned request, operator pins, inventories, source graph,
raw stdout/stderr/result and one-run marker, plus 130 unchanged Native preimages and
exact Native head/status/staged/working comparisons. The prior exact Native index
snapshot is referenced by digest. The 107MB Bun bytes remain represented by their
verified canonical-provider pins; no private key is archived or committed. An accidental
redundant tooling-Bun archive copy was deleted; both original Bun files were untouched.
Root's original tool metadata is explicitly labeled transcription.

Root's independent post-run check found all 45 roster members semantically equal.
Source inspection identifies a likely insertion-order defect: producers emit row
keys `path,kind,mode,identity`; strict schema parsing emits
`path,kind,identity,mode`; JSON string equality rejects those identical values.
This diagnosis still needs focused public-authentication RED/GREEN source checks.

Exact identities and preservation pointers are in
[the actual FAIL record](ticket-41-native-signed-probe-actual-fail.json).
This evidence commit changes no source and authorizes no retry. Any corrected attempt
needs fresh configuration/build, independent final review, signature, frozen READY
and a separate Root one-run authorization.
