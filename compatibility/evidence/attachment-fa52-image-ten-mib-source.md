# 10MiB image boundary — SOURCE only

One new anchored public RPC case requires a **ready** 10,485,760-byte PNG, explicit
`image_transformed` acceptance, exactly one generated/committed prompt, returned
entry/content-index relations and same-entry public history links. Preparation
and missing consent must leave entries/provider effects unchanged. Exactly one
controlled model attempt/dispatch/request must witness the prepared image; the
repeat terminal query must add no effects. No complete model-layout claim.

The runtime-only generator starts from the existing 1×1 opaque-white PNG pixel.
SOURCE inspection found the historical fixture's stored IDAT CRC `efa34599`
differs from its correct `efa2a75b`; the new source repairs it. The unchanged
IDAT inflates to `01 ff ff`: Sub filter, white grayscale and opaque alpha. It
inserts 159 private ancillary `npAD` chunks of 65,536 zero data bytes and a tail
of 63,548 bytes before IDAT. The uppercase reserved bit is valid; the final
uppercase bit marks unknown data unsafe to copy after image modification. All
chunks have CRC32(type+data), IDAT remains consecutive, and IEND is the exact
end. The +1 variant increases only the last chunk to 63,549 bytes and recomputes
its CRC. Both are valid containers; no appended junk or format-corruption oracle.

Independent Python stdlib streaming hashes, CRC and empty-data JSON-envelope
arithmetic pin originals and frames in `png-ten-mib-boundary.json`; no large
payload/base64 is generated or written during SOURCE work. Both frames include
base64, the actual 36-character ID, metadata and newline: 13,981,386 and
13,981,384 bytes, respectively, below 50,331,648. Each has one image and a total
below 33,554,432. This is not an exact 48MiB frame edge test.

The unchanged Native image path has no fast path for 1×1 (minimum edge 200), so
both the historical tiny source and the padded source take the same decode and
200×200 resize/encode path. The 590-byte PNG and representation digest
`d39598a3…b8942ff` are historical known-output regression pins, not a new codec
prediction. A separate bounded zlib/PNG filter/CRC reader requires all prepared
pixels to equal independently known opaque-white RGBA: 160,000 bytes, SHA256
`cdbf6c08…1f8be33a`. The provider's encoded-image byte SHA is a delivery consistency
check constrained by that known representation and pixel witness; no new encoded
Native byte SHA is fabricated. Optional facts match only fields actually emitted
by unchanged prepareImage: raw/prepared sizes, source geometry, frames and decoded
bytes. Source decoded budget is 4 bytes, output 590 bytes; model/raw/RPC budgets
are separate. Any unexpected positive refusal or output change is a real HOLD,
never permission to lower the 10MiB target or weaken expectations.

**Known diagnostic gap:** receipt validation checks count/total/RPC, while the
isolated helper bounds stdin at 10MiB before prepareAttachment. For +1 it catches
`STREAM_BYTE_LIMIT` as generic `attachment_converter_error`; public prepare is
expected to return a failed receipt, and submit must refuse `ATTACHMENT_NOT_READY`
before reservation/admission/effects. The test pins that exact source-derived
behavior and preserves every caller draft object/base64/hash. It does not label
this generic converter diagnostic a clear public per-image budget reason. Full
Q6/MVP acceptance remains unmet, even if this isolated future case passes.

Before editing, all 854 inherited records and 14 additional current proof/raw/pack
references were checked. Only `public-rpc.test.ts` is overridden, by appending one
case and helpers; its 85,975-byte old preimage and twelve existing cases remain
exact. No documentation override or Native/schema/server/generated/build/provider
change. The new recursive freeze includes inherited raw/proofs, new SOURCE files,
small metadata, pure-check sources/results and the retained preimage.

The new retainer has fresh source/output/profile prefixes. It reuses the latest
actual-proven launch-owned retainer, capture and constructor-ownership helpers.
The five allocation/initialization/reader/capture/HOLD function ASTs are exact;
only case/prefix/event/metadata counts differ. Capture continuously counts/hashes
all bytes, saves at most 1MiB per stream and treats overflow/errors as FAIL. Release
still requires original wait, both reader joins and actual EOF. Uncertain launch
or lifecycle failures stay on the original retaining stack in HOLD; no new unsafe
Popen wrapper, timeout/retry/signal/census/PID fallback or extinction claim.

Pure checks cover CRC failure, geometry mismatch, five PNG row filters, non-white
pixels and trailing junk using tiny fixtures. They never generate the large
originals or import Native/provider. Public test SOURCE/retainer bindings use AST
only; TypeScript checks do not execute the runtime graph. Actual RED/GREEN remains
unrun under SOURCE-only authority. No retainer pre/run/post, Native/SDK/OMP/codec,
Rust FFI, Host/provider/browser, seed or kernel experiment ran.

Last read-only disk observation was 31,047,680 bytes free. Runtime originals,
base64 and JSONL exist only in RAM; expected prepared image is 590 bytes and top
capture is capped at 2MiB total. This is not a runtime-capacity proof. STOP after
SOURCE commit for fresh paired review, independent Root capacity/precheck and a
separate exact ONE. No integration merge, push or ticket closure; whole29/38/53/54
and Host upload/browser/original retention/product admission remain open.
