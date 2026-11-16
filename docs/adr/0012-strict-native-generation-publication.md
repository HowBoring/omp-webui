# ADR 0012: Retain the selected inode for strict native continuation

Status: isolated prototype; acceptance/review and platform gates remain explicit. Related: #29, #31, #32,
ADR 0002/0003/0007/0008/0010/0011 and [format contract](../../compatibility/STRICT-CONTINUATION.md).

Strict continuation must preserve a selected physical Session through ownership and every write. POSIX pathname
check followed by rename/unlink cannot atomically compare the destination inode; adding a WAL does not close that
race. In-place body truncation destroys the previous valid native conversation during crashes.

Use an anchored carrier fd under a real native exclusive lease and native storage critical sections. Native
append remains append; whole rewrites prepare immutable native JSONL generations and append an authoritative
commit to the held inode. An fd xattr bounds discovery of the current/predecessor commit without scanning history.
A seven-byte native format discriminator survives common copy/export loss of xattrs and sidecars and makes legacy
readers refuse stale carrier history. The preannouncement preserves generation zero in the carrier before the first actual commit.

Matched native readers share logical resolution; Host consumes public RPC only. Complete committed missing/corrupt
controls are errors; partial conversion/publication is retained and unknown, never repaired/replayed automatically.
The implementation refuses unsupported OS/filesystem behavior and bounded retained-generation limits. There is no
power-loss, hostile same-UID, safe raw-carrier-copy, generic generation maintenance or multi-link publication claim.
Explicit native New/fork/branch is a fresh owned native backend, never an error recovery path.

Format introduction changes rollback: flatten-export complete logical state under ownership, prove the export on
the target baseline, and only then select the exported copy. Keep original carrier/controls until that validation.
No Host native-data rewrite or automatic conversion to a legacy pathname is permitted. Linux evidence does not
validate Windows, WSL2, other xattr implementations or older native binaries.
