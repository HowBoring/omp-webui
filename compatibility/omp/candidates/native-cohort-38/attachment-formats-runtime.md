# Source38 attachment preparation and cancellation

Eight ordinary synthetic fixtures reached READY over public RPC v2 on Linux x64 with Bun 1.4.4.
Each run used the same pinned, unregistered StrictStart stage with `bundle/worker.ts` and a fresh private
profile and working directory. This extends the [UTF-8 and PNG observations](strict-runtime.md#attachment-preparation).

After Catalog selection and StrictStart Continue, the driver read the public History tree, prepared one
Attachment Original, checked the receipt binding and digest, and cancelled by preparation ID. The matched
client verified the digest of the prepared representation. Every `attachment_cancel` returned
`{"cancelled":true}`. A second read returned the same tree cut and single seeded user entry.
The working directory remained empty in all eight runs.

| Attachment Original | Observed representation | Reported degradation |
| --- | --- | --- |
| `opaque-200.jpeg`, 1,723 bytes | JPEG, 200 × 200, exact original bytes, one source frame | None |
| `opaque-200.webp`, 38 bytes | PNG, 200 × 200, 594 bytes, one source frame | `image_transformed` |
| `animated-200.gif`, 2,263 bytes | PNG, 200 × 200, 594 bytes, two source frames | `image_transformed`, `animation_first_frame_only` |
| `minimal-text.pdf`, 706 bytes | 93 UTF-8 bytes with page 1 marker and all three expected text spans in order. OCR pages empty, encoding and empty-text flags false. | `document_structure_changed` |
| `minimal-text.docx`, 1,259 bytes | 28 UTF-8 bytes containing the exact fixture text | `document_structure_changed` |
| `minimal-slide.pptx`, 9,155 bytes | 47 UTF-8 bytes with slide 1 marker and text heading | `document_structure_changed` |
| `minimal-workbook.xlsx`, 2,372 bytes | 64 UTF-8 bytes with the Evidence heading and the fixture table | `document_structure_changed` |
| `minimal-chapter.epub`, 1,893 bytes | 79 UTF-8 bytes with title, language and chapter text | `document_structure_changed` |

The image checks read the dimensions from the returned carriers and compared them with the receipt.
The DOCX, PPTX, XLSX and EPUB extracted-text and serialized-representation hashes matched their
independent fixture sidecars. The four receipts also reported zero omitted images.

Catalog and the Session worker each negotiated v2 and reached exit 0 with both pipe EOFs, empty stderr,
and no termination or force signal. The separate Catalog and Session guard files each recorded zero
denials and zero dispatches. After negotiation, the worker commands were `get_strict_state`,
`strict_start`, History snapshot open/page/close, `attachment_prepare`, `attachment_cancel`,
and History snapshot open/page/close again.

## Artifact identities

| Input | Identity |
| --- | --- |
| Host integration parent | `4f6255b80ef09e83b1ddbc187548d957166a7f77` |
| Fixture and sidecar Git source | `c98b7a5cf61f58636decef1d9b8265df83262d24`, `tests/attachments/fixtures` |
| Native source tree | `b102d9db2b9b91e7baa1de484ca901705785993b` |
| Bun executable SHA-256 | `10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235` |
| StrictStart runtime receipt SHA-256 | `7e22b591a5f63dbeece7631e96f596f89e02b324f41ebae0e3d99957c15f0830` |
| StrictStart CLI SHA-256 | `5658c2d6991e86b66761b68c97779189509345c2177bbe04631b8a4494ec37e8` |
| Attachment worker bundle SHA-256 | `d17945e1c0f73bf9417769aaae337ff4472fbd7fb1b0aae0074e294c558feb3c` |
| Catalog inventory SHA-256 | `7810144736c74ae8e19d7b1981400183be94e5f1eb6f7409c6678adc2b55cea2` |
| Compiler receipt SHA-256 | `f6fe0fbaa86d596da52df2de94c4f1d8b4af404f1c343c222fcad3faf017ded6` |
| Public schema SHA-256 | `81a3ffc9ebcf5c929c39995cdc6350b56796782353f87a6a9c274153baffe958` |

The scratch driver `/dev/shm/omp-source38-attachment-formats.7Dvh4m57/prove-formats.ts` has SHA-256
`0f295b5903e70d6070471b1ba057a7fffea415585a353935bf9cd8e9e7043964`. Its audit preload has SHA-256
`5c8c3600dfa0061b68ade0604039f00e127644085861d29628e6706d8a961330`. Strict TypeScript and the eight static
input checks passed. The JPEG run `78c63d` (session `22577`) and the seven subsequent runs
(`b83635`, `b4d2ab`, session `92134`) reached EOF 0.

Each row gives the directory suffix for the sanitized result at
`/dev/shm/omp-source38-format-<suffix>/output/result.json`. Independent readback compared every result
with its stdout log, tracked fixture and sidecar, exact worker command sequence, and two raw guard files.

| Suffix | Sanitized result SHA-256 |
| --- | --- |
| `jpeg.qskaAkG9` | `03cfc9f658c936b5b7a5867d024a3f6bd5e54f2b51bb8fc446a3b5a6d2e3e369` |
| `webp.VgNqEPL9` | `e0120b775f83310b9fafb0a7351c720fc1e6cd6cac728943636b34747fb26a5b` |
| `gif.1F4un47Q` | `2d2709cf9b7a3382094bec450d2502042c42eda70570c6c36f5b947114aeee24` |
| `pdf.G6upKZUL` | `b8bfaf25378c1a882f5e9611f18671264fd5ad6a4903a2d8ed363a19cac85d02` |
| `docx.j2oyv3nu` | `e4a37a1f1653fe03c09cfd9e4cc0f8bdb4c8a6a8a48eed7b1d948582e8e739f1` |
| `pptx.n4Zi1TFm` | `5e7556ce2df98312f280a9c0bc8c66cd30ab79f122a2661701f43234fd73cb7e` |
| `xlsx.A77eIxgy` | `a8845cb0f7d8c569792616ccf6c9c4da57aef4ae37a3998065c1c7f857b2d416` |
| `epub.Tzujaeu4` | `70d7a10d9de9d96a1a97aff6d62ba7d51ba3eee693b588b523d73f3ac1e2f171` |

This evidence covers ordinary preparation and cancellation. Consent, submission and consumption,
failure and budget boundaries, Native TUI/history/data compatibility, actual global installation and
DSH Browser acceptance require separate evidence. [Attachment preparation #38](https://github.com/HowBoring/omp-webui/issues/38)
