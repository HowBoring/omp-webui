> Historical/source selection from external `bcbc30e9532e404fb27fc63ceb85c07de335c46f`. Results and review claims below apply only to their original artifacts. This new H/P/external composition is unregistered and requires fresh paired review; see [ADR 0027](../adr/0027-unregistered-external-protector-composition.md). No actual runtime or admission proof is supplied.

# Ticket 41 clean control EOF review repair

Status: **SOURCE/PURE/TYPES ONLY**. Actual external OS, Native, global installation and private/product admission
remain unproved. This report addresses the latest external-root reviews: Standards 0, Spec 1 P2.

The external controller previously accepted verified ROOT_EXIT and COMPLETE followed by an unterminated printable
tail, close without end/error, and successful direct protector reap. The public `completed` promise incorrectly
fulfilled because close bypassed decoder finalization. The new public controlled-OS regression genuinely failed:
30 pass, 1 fail, 165 assertions; its promise resolved where rejection was required.

Only an observed `end` now permits successful terminal processing. It queues decoder finalization behind received
frames; incomplete trailing bytes fail. Close without prior end immediately retains an unresolved lifetime, even
with an exact COMPLETE and zero direct reap. Duplicate end/close notifications do not queue another terminal path.
Error and explicit disconnect stay sticky through direct reap. No controller interface, timeout, C source or cleanup
policy changed. Receipt-known START fences and independent ROOT_EXIT readiness/completion outcomes remain covered.

Brief inspection of `PrivateHelperController` found the same Host promise-validation bug. A separate public
regression genuinely failed: 6 pass, 1 fail, 31 assertions, again observing fulfilled completion with a truncated
close-only stream. The matching TypeScript terminal check is repaired; Native stdin stays fenced on failure.
The private C EOF cleanup policy is unchanged. No owned-control-io shim code or interface was imported or modified.

Final seven-file pure supervision selection: **62 pass, 0 fail, 277 assertions, 60 ms**. It covers close-only exact
COMPLETE and partial tails, partial clean EOF, normal end plus duplicate close/end, error/disconnect before reap,
retained direct reap, all prior receipt-known startup failures and successful verified terminal completion after
ROOT_EXIT rejects readiness. Full Host TypeScript checking exits 0; `git diff --check` passes.

Integration `4024c4084173c102764e0c1e42efa183ba8810d4` was explicitly merged (already up to date); ancestor check passes.
Source/test/docs commit `812e74d9af91431eac89007bb4d59ea341c64cda`, tree
`6fad89b1a6e7187e140cff9c5e08ab3173deba3a`. Exact RED/GREEN commits, commands, log SHA256 and source identities are
in [the machine-readable evidence](ticket-41-external-clean-eof.json). All nine previous C/build/fixture files were
byte-compared with base `32fe293c25bf727bb9679726273780765673f4fb` and retain their recorded SHA256. No fresh C build
was performed. Dependencies use an ignored symlink to integration's existing node_modules; no installation occurred.

Controlled adapters are not kernel, authentication, service-lifetime or global provenance proof. No actual C/helper,
Native/CLI, listener/UDS, FFI/dlopen, probe, signal, browser or strace run occurred. Old orphan and all fences were
neither inspected nor touched. No GitHub/push, other-worktree edits or global changes occurred. Coordinator must
arrange fresh independent two-axis review of the clean final tree before separately authorized OS proof/integration.
Whole #41/#61/MVP and global/private admission remain BLOCKED; Windows Chrome/WSL2 remains owner-deferred.
