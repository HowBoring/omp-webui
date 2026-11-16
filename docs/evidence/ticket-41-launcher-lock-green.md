# Existing C launcher to real Bun: scoped lock proof

Status: **PASS, owned child domain DRAINED**. This records the single already-completed run on Host
`6db8025890e74e452ac2c8e433e8c3c715299b93`; this restoration did not rerun it.
Structured observations, exact input identities and raw artifact hashes are in
[ticket-41-launcher-lock-green.json](ticket-41-launcher-lock-green.json).

The unchanged public C entry directly execed the actual pinned Bun 1.4.4 in its retained child PID 480301.
The retainer checked the live child's actual executable inode and SHA256
`10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235` through its held pidfd and `/proc`.
Both observations, before and after the live exclusive probe, found exactly one inherited control fd 3:
`FLOCK ADVISORY READ`, device 27/inode 337520, flags `0500000`, CLOEXEC false after Bun startup.

Independent finite probes acquired the same control before launch (480300, exit 0), refused exclusive acquisition
while Bun was live (480309, exit 73), and acquired after Bun's stdin EOF, actual exit 0 and central reap
(480310, exit 0). Bun emitted its frozen ready/EOF frames and raw provider-guard counters denied 0/dispatched 0.
All four child statuses are actual `waitid` observations (`CLD_EXITED`), not deadlines or PID absence.

Python parent 480297 closed admission and reached actual `P_ALL/ECHILD` in its sole central wait loop before
writing `result.json`: PASS, signals 0, interrupted false, post-inputs unchanged true. The original top-level
Python tool completion/exit status is **NOT_CAPTURED**; no parent exit code is inferred. Root's separate fresh
presence census and this restoration's exact-five-PID check found the parent and all four known children absent.

Read-only restoration revalidation matched all 20 input SHA256s, sizes, exact integer device/inode values,
modes and link counts, plus the immutable fixture SHA256
`76bc93ab5d1a360b3a783dc87e8c4e0a72e514d327b35139d27d3eb60cb1b46f`.
Raw logs/result/fixture/scripts and their hashes remain at `/tmp/launcher-lock-tracer-CarLw9` and in this evidence.
After proof was saved and exact file identity/drain rechecked, Root-authorized reclamation removed only its
107,308,936-byte copied `release/runtime/bun` (device 27/inode 337519). Source Bun was rehashed unchanged;
other fixture artifacts, old fences and source files were preserved. The immutable preparation manifest retains
its original pre-run fields; ignored ready/run-plan records now say `USED_ONCE_PASS_DRAINED_DO_NOT_RERUN`.

This proves the existing launcher's shared-lock retention across direct exec to this actual Bun process.
Actual owner-selected global installation, final release/platform closure, descendants/shared service lifetimes,
private helper REGISTER/START/extinction, Native/Agent/TUI/browser behavior and product admission remain **BLOCKED**.
