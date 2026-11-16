# Ticket 32 review corrections

All five findings in the independent standards/spec reports are addressed in owned native patch 0005. This remains an isolated Linux component candidate; product Session admission, Windows/WSL, power-loss durability and hostile same-UID authenticity are not claimed.

The accepted seams remain actual public OMP RPC and native TUI/data contracts, complemented by synthetic-home OS faults. The native factory probes run in a live guarded process and observe real ownership reacquisition and `/proc/self/fd` cleanup before process exit can hide leaks. No Host Session-file parsing or provider inference was added.

| Finding | Correction and regression evidence |
| --- | --- |
| Physical carrier overrun | Serialize the complete commit before creating generation controls; reject an over-budget UTF-8 encoded commit as `GENERATION_CARRIER_LIMIT`. A native SessionManager opens a valid near-limit carrier with multibyte ID/cwd/title metadata. One byte over refuses with unchanged carrier hash, head and sidecar names, then reopens the prior title. The exact boundary publishes at 268435456 bytes and reopens the new title. |
| Duplicated lease acquisition | Move the existing central lease implementation into lightweight `session/session-lease.ts`, retaining its public re-export from session-storage. Strict acquisition, both creation paths and readonly catalog probes share native test-directory selection and untrusted-ID normalization. A genuine central native owner blocks strict RPC continuation under a shared test directory and an untrusted native ID; explicit native creation meets that same held lease. Probes retain read-only behavior. |
| Failed factory resource ownership | Reservation factories own every acquired fd/lease in disposable stacks until successful validation transfers them. The parent fd is acquired by the factory and passed into the constructor. Native SessionManager.open releases a backend it acquired when later initialization fails. Corrupt committed-body loading, actual RLIMIT-induced parent-open EMFILE and a kernel-boundary replacement after pinned carrier/cwd acquisition all reject and permit immediate real lease reacquisition with the same owned descriptor inventory. |
| Duplicated metadata authentication | Full and bounded-prefix resolution use one authenticated metadata reader with identical hash, token, offset, carrier and native-ID validation. |
| Missing current native cwd guard | The shared logical-header parser supplies ID and cwd. Every reservation guard compares the current header's resolved cwd with the reserved canonical cwd before extension startup or mutation. A same-inode/same-ID, equal-byte-length cwd replacement refuses title publication, preserves replacement bytes and latches unknown. The corresponding ID replacement remains covered. A relative recorded cwd is also refused even when it resolves to the reserved directory; this separate red→green RPC regression passes (1 test / 7 assertions). |

The original held ticket-32 native checkout was not changed. The new native checkout is an owned lightweight shared clone; package dependencies are read-only links. Native 0006 is byte-for-byte unchanged from the reviewed branch.

Focused regression matrix: `bun test tests/continuation/factory-cleanup.test.ts tests/continuation/carrier-budget.test.ts tests/continuation/ownership.test.ts tests/continuation/startup-order.test.ts`: **PASS, 19 tests / 75 assertions**, 94.97 seconds. Root strict TypeScript and focused authored native strict/live TypeScript checks: **PASS**. Ordered 0001–0006 compatibility build: **PASS**; schema unchanged. Broad suite, final matched TUI/browser and syscall evidence are pending the coordinator's serial validation slot.

Red evidence was observed for unsafe cwd title publication, unreadable post-publication carrier overrun, simultaneously admitted native owners under the shared test directory, leaked generation-open lease/descriptors, and leaked lease after real parent-open EMFILE. Restoring the original unowned-parent construction shape also makes the replacement regression fail with an extra owned parent descriptor. Initial replacement-fault attempts selected earlier metadata opens; selection was corrected to the OS directory open following writable-carrier and cwd acquisition. A tracee-exit ESRCH in the test controller is now handled. Two startup attempts under concurrent build/suite load timed out or produced an incomplete catalog result; the complete focused matrix above then passed. Those attempts are not acceptance passes.

Native build tuple:

- Base: `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`
- Source SHA-256: `2ead29a974d7b1a85d97e27575cacd80bc1f917d348012daa108ff3071192661`
- Aggregate patch SHA-256: `19821d6e2e340bcf52ee1d288f2f42a29998bc54e183c384a04557e2effb2286`
- Schema SHA-256: `ed446d360feb896fb5575ca9db5e982c31fd3aebd0cd1c4233881250e7553a1f`
