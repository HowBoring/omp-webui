# Source38 elapsed attachment receipt expiry

One Linux x64 run used the complete Source38 StrictStart worker and matched public RPC v2 clients.
The synthetic Session was selected through Catalog and opened by StrictStart Continue. A 72-byte
PNG produced a ready receipt that disclosed a 300,000 ms lifetime and `image_transformed`.

The first submit omitted the required degradation consent and returned
`ATTACHMENT_DEGRADATION_CONSENT_REQUIRED` before expiration. Starting at receipt observation,
the driver waited 300,288 ms of real monotonic time. The second submit used the same client
submission ID and the exact receipt, preparation, digest, draft revision, grant generation and
degradation codes. It arrived 291 ms after the published expiry and returned
`ATTACHMENT_RECEIPT_STALE`. The same worker processed both requests.

After both refusals the public submission query was identical, with no reservation or relations.
The Tree cut and its one seeded entry stayed identical to the pre-preparation snapshot. The fixture
observed zero admitted inputs, model attempts or deliveries, and the native Session stayed settled.
The Catalog and Session processes exited zero after stdin EOF, with both pipe EOFs and empty stderr.
The pre-import egress guards recorded zero denials and dispatches.

This evidence covers elapsed Native receipt expiry with a synthetic profile and controlled time
measurement. Browser draft restoration, Host authorization changes, production admission and
the selected global OMP combination have their own acceptance paths. [Attachment preparation #38](https://github.com/HowBoring/omp-webui/issues/38)

## Artifact identities

| Input or observation | Identity |
| --- | --- |
| Host transport source commit | `263f8cfffd2db1437d877ab67c4f10984faac1f1` |
| Host transport SHA-256 | `898aea6cb831dbd5b54e91f11b0fd4860a8f604a1728294f46e51f5ff35be8e6` |
| Native source tree | `b102d9db2b9b91e7baa1de484ca901705785993b` |
| StrictStart runtime receipt SHA-256 | `7e22b591a5f63dbeece7631e96f596f89e02b324f41ebae0e3d99957c15f0830` |
| Public schema SHA-256 | `81a3ffc9ebcf5c929c39995cdc6350b56796782353f87a6a9c274153baffe958` |
| Scratch driver SHA-256 | `0bcb6d945eb277bcc0236e1159f3099a3e63faad4f32317f8caa1ded3a7f5ab9` |
| Sanitized result SHA-256 | `41649f22a255b9ad436f9e56ecf026d9f3ba94ab413351143c1bd4afbc78f611` |

Strict TypeScript and guarded input verification passed before the real wait. Run `571227`
(session `33512`) exited zero. The result and both guard files are under
`/dev/shm/omp-source38-attachment-expiry.KxaW5YCG/run.5N2vkxhb`.
