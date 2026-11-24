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

## Receipt preparation after worker reopen

The guarded Source38 fixture selected the same free Catalog reference and native identity before
and after replacing its StrictStart worker. It left the first ready preparation live through
stdin EOF. The replacement worker returned `cancelled: false` for that preparation ID with
297,494 ms remaining before its advertised expiry. It then issued a different ready receipt
for the same draft revision under the new authority generation, and cancelled the fresh
preparation successfully. The RPC allowlist admitted Continue, state, History, preparation and
cancellation. The old preparation observation comes from the public cancellation lookup.

The test closed and reopened the Host SQLite OriginalStore, then read the same original bytes
and metadata through the new authority. A foreign draft scope could not read that object.
The Host draft adapter restored the text and logical original reference using synthetic same-tab
storage. It rejected the prior authority scope. The public one-entry Tree and the synthetic
seed stayed unchanged. This checks separately composed Native and Host storage behavior.
Browser hydration and full Host restart acceptance remain pending. [Draft recovery #57](https://github.com/HowBoring/omp-webui/issues/57)

The two Catalog children and two StrictStart workers all exited zero with stdout and stderr
EOF and empty stderr. Each guard recorded zero denied calls. The Host transport, OriginalStore
and draft adapter matched `ed1ea07579793f3f3d86695864056fb49d801841`, using the same Source38
runtime and schema listed above and DSH patched tree `d05468939bcb06446ace47045d138f716406c788`.

Strict TypeScript and the guarded input check passed before run `414cbe` (session `52619`).
The driver SHA-256 is `451f06042096dc79bc7469c76a4859c6a923a8b910077ca00a950939603a6a48`.
The result SHA-256 is `f5b67e90a5217197073c380353c63acbff570330dfa45518d23b40a4f7114120`.
The driver and output are under `/dev/shm/omp-source38-attachment-reopen.r3le7NxZ` and
`/dev/shm/omp-source38-reopen-run.bUX4o6mq`, respectively.
