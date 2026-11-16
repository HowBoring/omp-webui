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
