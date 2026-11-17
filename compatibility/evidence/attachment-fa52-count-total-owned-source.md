# Original child ownership across retainer lifecycle failures

SOURCE ONLY. The existing bounded retainer starts its original Popen before constructing/starting
readers, printing its start record, waiting and joining. A failure at any of those steps can exit
the parent while its child remains live. This candidate adds an ownership seam and a fresh retainer;
the 831-record bounded freeze, its Ready, original retainer and unused old precheck remain immutable.

`retainer_ownership.run_owned` retains the original Popen, both original pipe objects, every
constructed reader and the capture map. It catches BaseException from the entire spawn/reader/start
notification/wait/join lifecycle. If an original child was returned, unresolved ownership enters
HOLD permanently. No exception grants release, restart, cleanup, timeout or numeric recovery.
Only the original Popen wait, both original reader joins and both actual stream EOF flags permit
return for final PASS/FAIL accounting. A read fault therefore remains HOLD even after wait/joins.
A write or flush fault with complete drain/EOF can return for an ordinary FAIL result.

HOLD rewrites one bounded `ownership-hold.json` report and pauses. Reporting, disk and pause
interruptions preserve the in-memory owner. An unsuccessful report is not proof of completion.
There is no automatic cleanup PASS, descendant-extinction claim, signal, process discovery or
alternate PID authority. The owner and original references remain reachable on the live stack.
Fake HOLD callbacks exit with a BaseException sentinel outside the lifecycle catch; no fake
unbounded loop, thread, process or sleep runs during validation.

Pure fake tests preserve RED→GREEN for a second Thread.start RuntimeError, missing EOF after
wait/joins and failing HOLD persistence. The lifecycle matrix covers both reader constructors,
both starts, start notification, wait and both joins under RuntimeError, KeyboardInterrupt and
SystemExit. Completion, spawn failure and a returning HOLD callback are also checked. The existing
nine bounded binary I/O checks still verify complete byte counts/SHA, a 1MiB production cap per
stream, write-fault draining and false EOF on read faults. The retainer is parsed as AST only.

The eight-object/32MiB case, test title, argv/guard, environment allowlist, Native source/schema,
assets and matched build are inherited unchanged. Only fresh output/profile prefix names change.
The additive freeze has no overrides and preserves all 831 inherited input records, including
the 819→781→745→703→667 chain, Native166/build290/archive41/addon15/HTML6 and old precheck.

No retainer pre/run/post, actual case, thread/process/worker, Native/Host/SDK/provider/browser,
FFI/kernel action or runtime cleanup ran. Root remains HOLD pending a fresh exact paired SOURCE
review, independent new precheck and separate ONE. Whole tickets38/53/54 and product admission
remain open/blocked; this source evidence grants no runtime window.
