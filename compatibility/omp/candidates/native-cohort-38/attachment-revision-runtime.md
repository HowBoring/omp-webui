# Source38 attachment consent binding and cancellation

One synthetic Session opened through Catalog and StrictStart on the complete Source38 worker.
The Host exercised public RPC v2 with the matched wire validators and a trusted local fixture
provider. Native prepared the 72-byte PNG and returned a ready receipt with `image_transformed`.

| Action before natural expiry | Public result |
| --- | --- |
| Confirm with only `draftRevision` changed | `ATTACHMENT_CONSENT_STALE` |
| Confirm with only `authorityGeneration` changed | `ATTACHMENT_CONSENT_STALE` |
| Confirm with only `resultDigest` changed | `ATTACHMENT_CONSENT_STALE` |
| Confirm the same receipt without its required degradation consent | `ATTACHMENT_DEGRADATION_CONSENT_REQUIRED` |
| Cancel the preparation by ID | `cancelled: true` |
| Confirm the cancelled receipt with the original matching consent | `ATTACHMENT_RECEIPT_STALE` |
| Repeat cancellation of that preparation | `cancelled: false` |

The public submission query remained absent with no relations. The worker stayed settled and
its one-entry Tree stayed identical to the pre-preparation snapshot. The fixture observed zero
input, provider attempt or delivery effects. The Catalog and worker exited zero on stdin EOF,
both pipes reached EOF, and both guards reported zero denials and dispatches.

The authority-generation case checks the Native receipt binding. Browser grant revocation and
cross-layer draft and object lifecycle require their own acceptance. [Attachment preparation #38](https://github.com/HowBoring/omp-webui/issues/38)

| Input or observation | Identity |
| --- | --- |
| Host transport source | `0ffc83ccd62824f6d0c32f05eb148228a11fffa2` |
| Host transport SHA-256 | `f538b56c5be838c969b645383b1c5f1af09b5a8d1274d8401e33da5906c8f744` |
| Native source tree | `b102d9db2b9b91e7baa1de484ca901705785993b` |
| StrictStart runtime receipt SHA-256 | `7e22b591a5f63dbeece7631e96f596f89e02b324f41ebae0e3d99957c15f0830` |
| Public schema SHA-256 | `81a3ffc9ebcf5c929c39995cdc6350b56796782353f87a6a9c274153baffe958` |
| Fixture driver SHA-256 | `cbac1e6fd690d887f12e4931d46b92838c68e485dc3bab1277691a082c23a302` |
| Sanitized result SHA-256 | `2aa3b1fa61edbf7e882a8d345a027bec9e1e8534553296aef2927aad4470051b` |

Strict TypeScript, guarded input checks and standalone matched RPC schema checks passed before
launch. Run `cf193f` (session `45876`) exited zero. The driver and results are under
`/dev/shm/omp-source38-attachment-revision.SZDzRS07` and
`/dev/shm/omp-source38-png-revision-run.sbea2lvg`, respectively.
