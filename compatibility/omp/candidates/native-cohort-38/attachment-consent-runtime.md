# Source38 PNG degradation consent and delivery

One unregistered Source38 Session completed the ordinary consent path over public RPC v2 on
Linux x64 with Bun 1.4.4. Public Catalog selected the synthetic Session and StrictStart Continue
opened it in a private profile and working directory. The matched AttachmentClient and
SubmissionClient issued preparation, submission and query. Public HistoryClient read the Tree
and its retained image. [Issue #38](https://github.com/HowBoring/omp-webui/issues/38)

- Preparation returned a ready receipt for a 72-byte 2 × 2 PNG converted to a 591-byte 200 × 200
  PNG. It reported `image_transformed` and a five-minute receipt lifetime. The Tree and local
  effect log were unchanged.
- Sending the receipt with an empty accepted-degradations list returned
  `ATTACHMENT_DEGRADATION_CONSENT_REQUIRED`. The same submission ID queried as absent, with no
  reservation or relations. The Tree and effect log were still unchanged.
- One explicit `image_transformed` confirmation used the same receipt and submission ID before
  expiry. The terminal query returned a committed reservation and persistence, a succeeded
  operation and generated input. The receipt retained the confirmation binding and image
  representation link. A read-only follow-up query returned the same terminal receipt.
- The committed input relation and Tree user entry `eb8b7df3` carried the same submission
  origin and image link at content index 1. The public History content page returned the
  prepared bytes. The fixture recorded one input event, one provider attempt and one delivery
  by the local `attachment-controlled/literal` model. Its sole image and retained History matched
  the prepared PNG SHA-256 `af099b1ebc4c79b7baaa7246e594dbf3c3c80a40a597bd4c6a161e1ccd64bf24`.
  The content descriptor reports `retained_native` with original association `unproven`.

Catalog PID `776498` and Session worker PID `776514` each reached exit 0 and both pipe EOFs
with empty stderr and no termination or force signal. Each process guard recorded zero denied
and zero dispatched network operations. The synthetic working directory remained empty.

## Artifact identities

| Artifact | Identity |
| --- | --- |
| Host integration commit | `263f8cfffd2db1437d877ab67c4f10984faac1f1` |
| Host stdio transport SHA-256 | `898aea6cb831dbd5b54e91f11b0fd4860a8f604a1728294f46e51f5ff35be8e6` |
| Complete-worker StrictStart receipt SHA-256 | `7e22b591a5f63dbeece7631e96f596f89e02b324f41ebae0e3d99957c15f0830` |
| Attachment worker bundle SHA-256 | `d17945e1c0f73bf9417769aaae337ff4472fbd7fb1b0aae0074e294c558feb3c` |
| Public schema SHA-256 | `81a3ffc9ebcf5c929c39995cdc6350b56796782353f87a6a9c274153baffe958` |
| Driver SHA-256 | `331662a5dc94391ff54fb8fa5747dedc04fbe15e7e801191bdf2f4b283d222c6` |
| Synthetic provider SHA-256 | `a0923e7e1455ed96877f359e3db5ef7e0c119652cfb89cd3e400159f5fdd9a5f` |
| Result SHA-256 | `0da2a42df9540af5f7ae103c132e7f920135f2cb03e1e3c0ddc4be9a1574a558` |

The result is 10,656 bytes at `/dev/shm/omp-source38-png-consent-run.eidIsM2R/output/result.json`
from guarded run `c9534a`, session `90337`. Independent readback matched the stdout result
identity, both process guard files and the local provider effect log. The driver and provider are
in `/dev/shm/omp-source38-attachment-consent.po3myr1Y`.

Lost replies, rejection after expiry, other failure conditions, Native data lifecycle and
TUI compatibility, global installation, and the DSH product path still require their own evidence.
[Preparation and cancellation evidence](attachment-formats-runtime.md)
