# Source38 attachment budgets and mixed preparation failure

One Linux x64 run used the full Source38 attachment worker, the public RPC v2 decoder and generated
clients, and a fresh synthetic OMP profile. The Catalog selected the seed and the worker opened it via
StrictStart Continue. The literal provider recorded any input, attempt or delivery. Original bytes
were generated in memory. The isolated transport allowed one command at a time up to the candidate's
48 MiB JSONL limit so the Native limits could be exercised through public RPC.

| Case | Accepted | Refused |
| --- | --- | --- |
| Object count | 8 UTF-8 originals all ready | 9, `ATTACHMENT_INPUT_BUDGET` |
| One UTF-8 original | 5,242,880 bytes, 51,193 prepared bytes with `text_truncated` | 5,242,881 bytes, `attachment_original_budget` |
| One image Original | A 10,485,760-byte PNG prepared as 591 bytes with `image_transformed` | 10,485,761 bytes, `attachment_original_budget` |
| Total original bytes | 33,554,432 bytes over 8 UTF-8 originals, all ready | 33,554,433 bytes, `ATTACHMENT_INPUT_BUDGET` |

A two-item draft combined a valid PNG with a second item declaring JPEG for the same PNG bytes.
The receipt was `failed` and contained both a ready image and `attachment_format_mismatch`.
Submission carrying that receipt returned `ATTACHMENT_NOT_READY`. The public query reported
an absent reservation with no relations. Each returned preparation receipt was explicitly cancelled.
The public Tree cut and its sole seeded entry were unchanged. The input and provider effect log
was empty. Catalog and Session worker each exited zero on stdin EOF, with both pipe EOFs and
zero stderr bytes. Both egress guard reports recorded zero dispatches and denials.

An independent worker tested the exact image edge using a valid PNG with an ancillary chunk and CRC.
Its 10 MiB Original retained the same pixel data as the 72-byte PNG and produced the same prepared
image hash. The +1 byte Original returned the size refusal. Both receipts were cancelled and the
worker and Catalog closed cleanly. Decode and output-frame limits, Browser upload, draft and
persisted-original budgets still need evidence through their corresponding paths.
[Attachment preparation #38](https://github.com/HowBoring/omp-webui/issues/38)

## Artifact identities

| Input or observation | Identity |
| --- | --- |
| Host transport source commit | `263f8cfffd2db1437d877ab67c4f10984faac1f1` |
| Host transport SHA-256 | `898aea6cb831dbd5b54e91f11b0fd4860a8f604a1728294f46e51f5ff35be8e6` |
| Native source tree | `b102d9db2b9b91e7baa1de484ca901705785993b` |
| StrictStart runtime receipt SHA-256 | `7e22b591a5f63dbeece7631e96f596f89e02b324f41ebae0e3d99957c15f0830` |
| StrictStart CLI SHA-256 | `5658c2d6991e86b66761b68c97779189509345c2177bbe04631b8a4494ec37e8` |
| Attachment worker SHA-256 | `d17945e1c0f73bf9417769aaae337ff4472fbd7fb1b0aae0074e294c558feb3c` |
| Public schema SHA-256 | `81a3ffc9ebcf5c929c39995cdc6350b56796782353f87a6a9c274153baffe958` |
| Scratch driver SHA-256 | `50a97338a4b667852ce1f28778623411251c0e168f76de7f290e94f12e73aa97` |
| Sanitized result SHA-256 | `f1db30f0446674c23f026613467ca73288e1325c15f17e4890b94cecdf98b9d6` |
| Exact PNG edge driver SHA-256 | `a8f7fd1c823dfc472d03217ed1b6aa0cff05fd135e48d2ab2d1ffcf72041113b` |
| Exact PNG edge result SHA-256 | `903e6caeb171bb94c08c6123b5fdea311913ebe08843a05e24cdde101a44efd2` |

Strict TypeScript and the guarded input check passed before execution. Run `e88110` (session `16182`)
exited zero. The result and both guard files are under
`/dev/shm/omp-source38-attachment-budget.of1u4lkw/run.U0rKe5Sz`. The exact PNG edge run
`20aaf3` (session `78601`) exited zero with artifacts under
`/dev/shm/omp-source38-attachment-budget.of1u4lkw/image.tlvtt1RS`.
