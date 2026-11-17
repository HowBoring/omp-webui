# Ticket 41: role-specific Host directory observations

Source-only correction to Host `3517c80a44d05104f089c889055adca005ea611e`.
Fresh paired review is required. The actual two-process plan remains **HOLD**;
helper/Native execution is **NOT RUN**, and global/private admission remains **BLOCKED**.

The production inspector previously retained size, link count and change timestamps for every ancestor directory.
Creating an unrelated sibling beside an owned `parent/release` therefore invalidated a held release even though
the manifest, release, platform members and control were unchanged. Interpreter traversal independently promoted
plain outside-release directories to the same full snapshot. Both counterexamples were reproduced through public
`inspectRelease`/`verify` and `resolveGlobalSelection`/`verify` boundaries with inert filesystem/ELF fixtures.

`ReleaseObservation` now distinguishes nonmember ancestor directories from full members. Ancestors retain device,
inode, UID, GID, full mode/type and canonical path, with bracketed lstat checks. Child-induced size, link count and
timestamps do not invalidate these directories. Interpreter traversal requests this directory role; links/files
still receive full observations. Release directories/files, platform aliases and canonical target files retain full
metadata snapshots, exact link text, directory roster hashing and the existing bounded O_NOFOLLOW descriptor/path
read checks. A full observation permanently dominates ancestor requests. Promotion checks the retained ancestor
identity before capturing a full snapshot; recheck uses the retained role without promoting or downgrading it.
This refines the earlier platform-alias prerequisite's overbroad ancestor-stamp requirement.

Vertical TDD captured both sibling cases failing with `RELEASE_UNVERIFIED`, then passing after their production fixes.
The focused suite now passes **58 tests / 73 assertions**, including the earlier **50 / 61** checks. Added controls
cover parent replacement, canonical-parent rename to a symlink, parent type/mode changes, a new release-member
directory and ancestor-to-member promotion. A transient child created and removed before the root is inventoried
is accepted; the same roster-preserving mutation after inventory permanently fails its full member snapshot.
Existing target/alias replacement, during-read mutation, owner mismatch, sticky failure, closure and traversal-budget
checks still pass. The ancestor-mode fixture now explicitly starts at 0755 so changing it to 0700 changes permissions
even under a restrictive umask. Full repository strict TypeScript passes.

Final tests used an allowlisted environment, synthetic HOME/XDG, TMPDIR=/tmp and the existing no-provider preload.
No Native runtime, FFI, helper, socket, kernel or execution probe ran; no packages, C or binaries were copied/built.
Native's 137 dirty path bytes, HEAD, index, index listing, staged/worktree diffs and exports match the paused producer's
baseline. All seven public package files match, including `index.js` SHA256
`868251d0086139ca00b3e85fcf8401da2a445f3f4b77b4b5c8d5422946fd9cef`; no public rebuild occurred.
The 15 paused producer drafts remain byte-exact, including its modified tracked two-process plan.

Exact source hashes, raw check hashes and preservation results are in
[the machine-readable evidence](ticket-41-host-ancestor-observation.json). Bounded preimages, the exact initial status,
producer manifest and raw logs are retained outside Git under
`research/restore8-41-host-ancestor-observation` in the implementation workspace.
Public-adapter reconciliation and reviewed rebuild remain required before any separately authorized actual proof.
