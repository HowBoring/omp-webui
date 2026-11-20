# Source38 write refusal before durable submission reservation

A real Source38 StrictStart worker opened one synthetic Session over RPC v2. The fixture owned
the profile and its empty generation directory. The driver verified that its worker had the same
non-root user and group and lacked permission-bypassing capabilities. The driver temporarily removed
write permission from the held generation directory using its original descriptor, preserving read
and traversal access. A standalone control beforehand observed `EACCES` from exclusive file creation
under the same permissions. This run did not trace the worker's kernel syscalls.

| Observation | Public result |
| --- | --- |
| Query before submit with restricted directory permissions | Absent reservation, unresolved persistence |
| One `submission_submit` | `STRICT_WRITE_OUTCOME_UNKNOWN`, with a matching persistence error notice |
| Query on the original worker | `SUBMISSION_SOURCE_UNREADABLE`, unknown reservation and persistence |
| Query-only successor after restoring permissions | Absent reservation, unresolved persistence, same as before submit |

Both queries on absent state reported no relations. The controlled model recorded zero attempts,
and the original worker emitted no input or execution-start observations. The successor loaded the
same native identity and one-entry public Tree under a fresh worker ID. The synthetic carrier's
bytes and identity were unchanged, the generation directory remained empty, and its original mode
was restored before the original worker's stdin closed.

The original worker exited 1 on stdin EOF with 290 bytes of stderr and both pipe EOFs. Catalog
and successor each exited 0 with both EOFs and empty stderr. The three guard files reported zero
dispatches and denials. No termination or force signal was needed. This run covers pre-reservation
refusal on the isolated candidate. Persistence faults after reservation, first-write delay and
production Browser delivery require separate evidence; post-reservation short writes and delayed first writes are
covered by [submission-fault-runtime.md](submission-fault-runtime.md). [Durable submissions #36](https://github.com/HowBoring/omp-webui/issues/36)

## Artifact identities

| Input or observation | Identity |
| --- | --- |
| Native source tree | `b102d9db2b9b91e7baa1de484ca901705785993b` |
| StrictStart runtime receipt SHA-256 | `7e22b591a5f63dbeece7631e96f596f89e02b324f41ebae0e3d99957c15f0830` |
| Public schema SHA-256 | `81a3ffc9ebcf5c929c39995cdc6350b56796782353f87a6a9c274153baffe958` |
| Fixture driver SHA-256 | `2df3c86d89e23645b2ce0b690eaacacfaebf7983f706928b63bde1c74adc56c4` |
| Standalone launcher SHA-256 | `03a0e1319655e197103a0d51468085fba90cdb6cf2e784e17d3e3d6cf5751cef` |
| Sanitized result SHA-256 | `0e6fa308282f2c399a8e8bcd62238d2f53e78a1718faf5130f49cd8a16cc42e6` |

Guarded input and permission checks, strict TypeScript and Oxlint passed before execution.
Run `f67764` (session `15782`) exited zero. The result and guard files are under
`/dev/shm/omp-source38-submission-write-fault36.QuVBFAuH/run.YA4NIP`.
