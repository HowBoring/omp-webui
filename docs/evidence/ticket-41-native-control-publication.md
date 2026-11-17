# Queued Native response publication barrier

Status: **source-only, inactive0010; fresh Standards and Spec reviews pending**. Signed Native composition and the
new C argv handoff remain **NOT RUN**. Global/private admission remains **BLOCKED**; no #29/#41/#61 closure is claimed.

The owner review found one P1: `#respond` authenticated a reply before queueing, but later `#advance` poll ticks wrote
it without rechecking authority. A second request could invalidate the owner or fence the dispatcher while the old
success or partial-frame tail remained queued.

The actual server write path now uses an extracted pure reply queue. Immediately before every `bridge.write`, with
no intervening await, it synchronously checks the exact nominal loaded owner/selection/approval and current connection,
server and deadline state. Admission-bearing replies also check dispatcher admission, known system uncertainty and
fence state. Failed checks clear the entire pending remainder and drop the connection. Signed negative inspection
responses and trusted helper COMPLETE acknowledgements retain separate drain semantics; an invalid owner refuses all
output. Bytes already sent cannot be retracted, and these barriers claim no discovery of undetected external changes.

The production loader and public module lifecycle stay unchanged. The pure queue supplies no loader, nominal owner or
RPC authority. Any committed prepare still prevents clean generation disposal without the Host's original helper reap;
no generation release closes/unlocks the process-owned C descriptor. Normal dispatcher entry and broker backend remain
unavailable.

Meaningful RED/GREEN tests exercise the existing pure lifecycle and dispatcher transport boundaries: queued owner
invalidation via a second readiness check, helper uncertainty detected by a second helper-status request, both initial
and partial-tail refusal, live multi-chunk output, stopAdmission, and a real Ed25519-signed negative inspection reply.
Final affected checks passed **37 tests / 156 assertions / 5 files**, **46 strict type-checked files**, and a
**73,259-byte build-only bundle with zero eager FFI imports**. Only the final negative-response test literal changed
after that check; its owner test file passed again (**10 tests / 49 assertions**). The earlier 76-test owner suite is
historical and was not gratuitously repeated. Initial fixture-controller/scope errors are preserved explicitly in the
[TDD stages](ticket-41-native-control-publication.json), alongside the corrected meaningful RED and passing results.

Host and Native HEAD/index/staged/working/untracked changed bytes were preserved before edits, and final changed
Native authoring bytes before the sole final export. Native HEAD/index/staged bytes remain exact; **122 of 129** original
changed files remain byte-identical. Exactly **8** intended source/doc/test paths differ, including the new pure queue.
The old inactive tree `e68927bf88110913b1bc7902293454eb194823af`, patch `c7459977…` and source `74d1b9d4…` are preserved as
**superseded, NOT RUN**. A private index reconstructed that preimage exactly, then replayed base + patches1–6 + the new
inactive0010 to the exact final tree. The actual Native index was never used for staging this fix.

Final inactive tree: `12f724d5f69471f2e91317475caac3bb911b50d2`.
Patch SHA256: `a14b65661d079f668352fb60ef21713bd2789ae8579704769f991d59e5395f7b`.
Source SHA256: `0cbb8454f6ba4dd686025d6445d63a441f0afcc18df98e1806700bbb1f16cabd`.
See [export metadata](ticket-41-native-control-publication-export.json) and [checks](ticket-41-native-control-publication-checks.json).

Public JS `868251d0…` and library `d97a49a0…` remain byte-identical and were read only. No Native CLI/SDK/Agent/Host,
FFI/library/listener/kernel/browser/runtime fixture ran. Active patches, consumer delta, patches7–9, final1–10 composition,
global keys/path, historical evidence, orphan444480 and old fences were untouched. Fresh review and a separate exact
Root runtime window are required before any actual signed Native composition test.
