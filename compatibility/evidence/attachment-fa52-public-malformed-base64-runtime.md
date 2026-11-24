# Public malformed-base64 whole-input refusal — actual PASS

Root's anchored run passed: **1 test, 17 expect calls, 0 failures**, with 13 cases
filtered; 3.85s (case 3758.18ms). The actual controlled Native worker executed
public preparation and submission refusal using the existing literal-provider
harness. This negative case admitted no input or model dispatch.

Raw `worker.request(attachment_prepare)` bypassed client original-byte validation
and returned a receipt accepted by the public receipt schema. The valid 28-byte
UTF8 original was ready with its exact text, pinned original/prepared hashes and
no degradation. The schema-valid second UTF8 object with raw data `%%%%` failed
with `attachment_invalid_base64`, an empty prepared hash and a failed overall
receipt. Its all-zero SHA remains a declaration: malformed base64 has no decoded
original, and no decoded-byte hash is claimed.

Submission returned `ATTACHMENT_NOT_READY`; public query showed no reservation,
admission or relations. Entry snapshots and controlled-provider effects remained
exactly equal to their before snapshots after both preparation and refusal. The
complete caller draft, including object order, message, malformed raw string and
declaration, remained exact. Browser/editor/durable draft retention is unproved.

Public preflight PID 658160 reported the exact additive d8d/069e/8f9/base7c49
tuple on Bun 1.4.4 Linux x64. Its original narrow transport drained with code 0,
forced false and zero stderr. The physical generated Native identity remains
distinct and unchanged; global Host identity and product admission are unclaimed.
Original Bun 658147 returned wait 0 with both reader joins and actual EOF; exact
stdout 621B/stderr 240B and guard 0 dispatch/0 denied were retained.

Root pre/post verified 992 source records, 10,715 Native files, the Native index,
dependencies and old artifacts; per-case homes remained empty and unchanged.
The postcheck's inherited `NATIVE_RUNTIME_NOT_RUN` label describes that metadata
checker only. The preceding controlled Native public test actually **PASSED**.
Top wait/EOF and preflight transport observations do not establish P_ALL or
general descendant extinction. Other helper identities and individual wait/forced
outcomes are not separately exported; top synthetic HOME remains retained.

The [proof](attachment-fa52-public-malformed-base64-runtime-success.json) and
[consumed-window record](attachment-fa52-malformed-base64-public-v1-window-usage.json)
pin eight raw files and six complete Root receipts in a 15-member external pack,
including its manifest. Ordered regular names, sizes, hashes and full bytes match
without extraction. No runtime/ELF/cache/keys/Session/history/profile or raw
receipt/provider payloads were archived. Dynamic receipt IDs and full counter
snapshots were asserted by the pinned test and are not separately exported.

Retention ran no consumed mode, checker or test and changed no Source/test/code,
Native index/schema/build or generator. Root's Native window is NONE; this scope
is consumed. Unsupported input, mismatch/corruption, stale/expiry/cancellation,
replay/restart and Host/browser/storage matrices remain open. Whole #38, #53,
#54 and #29 remain open; no Windows/global/private/product support claim.
