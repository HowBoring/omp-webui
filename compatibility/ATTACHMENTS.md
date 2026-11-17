# Attachment preparation component (#38)

This isolated S0 work extends the native ordered patch stack with `0009-attachment-preparation.patch`.
It is under implementation. It does not open private product Sessions and is not an attachment
consumption acceptance claim. #36 durable native reservations and exact causal associations are required.

The already-confirmed seams are native conversion/data contracts, public stdio/schema, then actual
Bun Host + public typed DSH Remote + browser. No Host SDK imports or native Session-file reads are used.
Native converter checks run with a synthetic HOME/profile and a pre-import egress guard:

```sh
python3 scripts/test-attachments-native.py
python3 scripts/test-attachments-native.py compatibility/omp/fixtures/attachment-isolated.test.js
python3 scripts/test-attachments-native.py compatibility/omp/fixtures/attachment-receipt.test.js
```

The native helper currently fixes original targets at 10 MiB/image, 5 MiB/text/document, eight objects,
32 MiB/input; decoded images at 16,777,216 pixels/64 MiB RGBA; prepared images at 500 KiB/1568 px;
inline text at 50 KiB/3,000 lines; converter text at 2 MiB; archive declarations at 32 MiB total,
8 MiB/member, 512 KiB index, 2,048 entries/1,024 path bytes; conversion at eight CPU seconds,
ten wall seconds and 512 MiB process data allocation; input preparation at sixty seconds.
Prepared JSON representations are limited to 8 MiB/input, staged receipts to 16 MiB/two receipts,
prose to 128 KiB and full UTF-8 JSONL commands to 48 MiB. Receipt lifetime is five minutes.
These limits refuse excess; raw limits do not replace complete encoded-frame accounting.

No model, tool, extension input or conversation append belongs in preparation. PDF OCR/encoding facts
and document image omissions are structured; document conversion itself requires consent because
it does not preserve original structure. GIF/APNG/WebP animation is converted to its first frame only
with an explicit loss fact. PNG/JPEG are staged to avoid downstream WebP fallback/drop behavior.

See [ADR 0017](../docs/adr/0017-native-attachment-preparation.md). Structured final source/build/schema
and browser/fault evidence will be recorded after the entire combined stack passes. Current source
and native fixtures are component work, never product/global-runtime or Windows PASS evidence.

The browser integration uses an exact-content gate after Enter inside the existing typed DSH Session prompt Remote.
DSH first persists its local pending checkpoint and performs its own quote/reference-codec serialization. The adapter
then prepares the exact resulting Native prose plus controlled originals and awaits explicit acceptance of every actual
result. That acceptance continues only this frozen Send attempt; it creates no retry/new attempt. No DSH business-flow
patch or pre-Enter serializer is required. A local DSH echo/checkpoint is visibly pending preparation/consent, not a
committed Native message. Lost or aborted Native dispatch remains unresolved until authoritative Native facts settle it;
query absence alone cannot authorize replay while a request might still be in flight.

Prepared admission currently declares `attachment-input-policy-v1`: idle `prompt` only, with no streaming-behavior hint.
Steer/follow-up/abort-and-prompt refuse before receipt claim and durable reservation. Known native builtin/extension/custom
handler routes that cannot safely consume new attachments refuse before their side effects. Unknown slash text retains
Native routing, and actual skill/file-command/prompt-template expansion paths carry explicit input/prepared object origins.
The post-Enter public Remote/provider/slot integration and its failure/reconnect coverage remain under implementation.


Current isolated format evidence uses Native source
`9f33ec9a6e6ad0c2f5d8f105da5e59f29f45eb8aa4780bd0ad010ccf40a996d9`, patch
`5e3153a05b95c8474971ee221a005ad7d9eeccbe197322ea3bcc6abed42d1bad`, and public schema
`8f9c3a086dade38eee57fdb535f1d5b66e81a1f770a2f44e9bc077f41b0e5566`.
The [current matched build](evidence/attachment-fa52-matched-build.json) identifies this tuple.
Each row below is one separately authorized isolated public-RPC run on its recorded synthetic input.
These are sample-specific outcomes, not full-format fidelity, combined-suite or product acceptance.

| Selected input | Current tuple evidence | Assertions |
| --- | --- | ---: |
| PNG + UTF-8 text | [PASS](evidence/attachment-fa52-public-png-text-runtime-success.json) | 47 |
| JPEG | [PASS](evidence/attachment-fa52-public-jpeg-runtime-success.json) | 33 |
| WebP | [PASS](evidence/attachment-fa52-public-webp-runtime-success.json) | 49 |
| Animated GIF | [PASS](evidence/attachment-fa52-public-gif-runtime-success.json) | 55 |
| PDF | [PASS](evidence/attachment-fa52-public-pdf-runtime-success.json) | 49 |
| DOCX | [PASS](evidence/attachment-fa52-public-docx-runtime-success.json) | 45 |
| PPTX | [PASS](evidence/attachment-fa52-public-pptx-runtime-success.json) | 45 |
| XLSX | [PASS](evidence/attachment-fa52-public-xlsx-runtime-success.json) | 45 |
| EPUB | [PASS](evidence/attachment-fa52-public-epub-runtime-success.json) | 45 |
| Mixed valid image + invalid UTF-8 | [PASS: entire input refused](evidence/attachment-fa52-public-mixed-refusal-runtime-success.json) | 13 |

Successful runs check public preparation, receipt-bound consent where required, public submission/query,
and exact causal saved-part/history associations. Provider capture checks the bytes described by each
proof. For document/text cases, its known `Controlled prepared document` witness covers 28 bytes;
full prepared-text equality at the receipt and indexed saved part does not establish full provider-wrapper
delivery. Each proof records its own containment, cleanup and observability limits.

The next [5 MiB UTF-8 boundary slice](evidence/attachment-fa52-text-budget-source-ready.json) is
**SOURCE READY / RUNTIME NOT RUN**. Its independently authored single-line multibyte literal is exactly
5,242,880 bytes; the worked 50 KiB UTF-8-safe head is 51,199 bytes and requires actual `text_truncated`
consent. The same literal plus one ASCII byte must fail preparation before admission/effects and retain
the caller's complete draft. Raw-original, prepared/model and fully encoded RPC budgets remain separate.
Only the small [independent manifest](../tests/attachments/fixtures/utf8-5mib-boundary.json) is stored;
the test generates the original in memory. Actual red/green awaits fresh Root review and a separate
exactly ONE anchored runtime grant. Browser draft persistence is outside this public Native seam.

Historical checkpoint: common7 `a6408bb`, navigation8 `e9573a3`, and its own9 compose in ordered1–9.
The [historical matched build](evidence/attachment-a640-e957-matched-build.json) records its source,
build/generation/`--check`, TypeScript and pure-suite checks (51 tests/160 assertions across11 files).
Its previous “runtime NOT RUN” statement belongs to that historical tuple; it does not describe the
current9f33 sample runs above.

Remaining refusal/budget/locator/lifecycle/stale/cancel/expiry faults, history/restart/copy/branch/restore,
actual DSH serialization/browser workflow, coherent full-stack checks and independent reviews remain open.
Linux evidence does not establish WindowsChrome/WSL2 acceptance (owner-deferred). Global runtime selection,
private product Sessions, whole38 and MVP admission remain blocked/open.
