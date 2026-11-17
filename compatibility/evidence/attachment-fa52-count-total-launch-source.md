# Retain original ownership before constructor initialization

SOURCE ONLY. The prior owned retainer publishes its child only after `Popen(...)`
returns. A constructor can create a child and then raise before returning. A missing
returned handle therefore cannot justify releasing the retaining parent.

The new `retainer_launch_ownership.run_owned` seam publishes launch-attempt state
before allocation and stores the exact allocated original object before invoking
its initializer. Production allocation uses `Popen.__new__(Popen)` without launching;
initialization calls `Popen.__init__` on that same retained object with unchanged
arguments. The initializer's return value is never used as a child or absence proof.

Any BaseException during allocation, initialization or subsequent lifecycle work
enters HOLD. This includes an unavailable/None object and a prelaunch constructor
failure: absence of creation is not proved. Partial initialization retains the exact
original object and available public stdout/stderr references; already retained
pipe references are preserved. No private Popen field proves absence or completion.
The original object, pipes, constructed readers, capture map and callback references
remain reachable in the live retaining parent's stack. Unknown original wait, EOF
or process domain grants no release, signal, discovery or relaunch authority.

Post-initialization behavior preserves the prior lifecycle rule: only original wait,
both original reader joins and both actual stream EOF flags allow final accounting.
Capture remains capped at 1MiB saved per stream, while counting and hashing every
observed byte. Overflow and write/flush errors fail accounting. A missing EOF holds.
Reporting and pause each catch BaseException; a returned HOLD callback cannot release
ownership. Finite pure fake tests escape with a sentinel outside the lifecycle catch.

The creation-before-constructor-return regression failed with the prior handoff and
passed with the new seam. The combined 25 pure tests include nine new tests with 36
constructor/unknown-return/lifecycle fault subcases, plus existing bounded capture
and historical ownership regressions. The old spawn-failure test remains immutable
historical evidence; its absence inference is superseded by conservative new HOLD.
AST checks bind production allocation/init to the new seam without executing either.

All 842 inherited input records, old helpers/retainers/Ready/freezes and the unused
819-input Root precheck remain byte-identical, with zero overrides. The new source
has distinct launch-source/retainer/output/profile prefixes. The eight-object case,
argv, env, guard, Native166/build290/archive41/addon15/HTML6 remain unchanged.

No retainer pre/run/post, actual case, thread/process/worker, Bun/Native/Host/SDK,
provider/browser/FFI/kernel action ran. Fresh paired SOURCE review, independent Root
precheck and separate ONE remain required. Whole tickets38/53/54 and product admission
remain open/blocked; this candidate grants no runtime window.
