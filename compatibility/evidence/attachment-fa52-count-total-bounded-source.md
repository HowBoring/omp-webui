# Count/total retainer capture — SOURCE only

The existing eight-object/32 MiB public case is unchanged. A failure assertion can print a roughly 44 MiB encoded
draft, so the new independent retainer saves at most 1 MiB from each original stdout/stderr pipe. Both readers
start before the original Popen wait. They continue draining after overflow or write failure, counting and
SHA-256 hashing every observed byte through actual EOF. Overflow, read/write/flush/close errors, missing EOF,
or disagreement between confirmed writes and saved file size disqualifies PASS even if the child exits zero.
The original wait and both reader joins are required. No timeout, kill, process discovery, recovered PID,
retry, or descendant-extinction claim is added. Capture files use unbuffered writes. Saved-file hashes cover
the bounded prefixes; observed-stream hashes cover the entire stream only when `streamEof` is true.

The approved test seam is the existing binary process stdio boundary. Nine synchronous pure I/O tests cover
success at the cap, overflow, full observed count/hash, write/disk/flush/read faults, short writes, zero progress,
and empty streams. They use finite fake I/O and start no processes or threads. A read failure prevents an EOF
claim and leaves the original stream handle open. Persistent read failure can prevent the child from completing;
the retainer has no timeout or recovery authority. Root must retain the original tool session and handles.

The new READY and additive freeze inherit the immutable 819-record count/total freeze without overrides,
preserving Native166, build290, archive41, addon15, HTML6, the exact case, guards, environment, and prior proofs.
The old precheck `/tmp/ticket-38-public-count-total-20261117-fb0_pygm/precheck.json` is unused historical source
evidence: no used-once file or actual run occurred. It is neither reused nor rewritten. The old READY, freeze,
retainer, tests, Native source/schema/assets/build, and precheck remain immutable.

The new retainer is only parsed statically, never imported or executed. No Bun worker, seed, preflight,
Native/OMP/Host/provider/browser/FFI/kernel action runs here. SOURCE is NOT RUN. Fresh exact-source paired
review, a new independent Root precheck, and Root's separate ONE are required before any actual case.
Whole tickets38/53/54 and product/global/private admission remain open or blocked as before.
