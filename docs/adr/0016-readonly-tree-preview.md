# ADR 0016: Keep read-only Tree preview separate from native position and Conversation

- Status: Isolated source component; product registration and acceptance remain closed
- Date: 2026-11-17
- Ticket: [#50](https://github.com/HowBoring/omp-webui/issues/50)

The opt-in `ompTree/read` public Remote and `omp.history` public React slot consume
only the existing candidate public native history snapshot/page/close contract.
Tree selection is disposable presentation state. It has no write-capable native
port and never changes the Session's native position, Conversation or model input.

Native pages and all active flags must share one full source cut. Completion
requires verifying every parent chain and the actual leaf across all pages;
partial pages do not enable preview or become a complete history claim. Preview
revalidates a strict native cursor, and all reads require current Host broker
and browser authority. A product owner must invalidate the public slot on current
binding changes and unmount it on revocation; DSH owner identity is insufficient.

Native source remains the only durable tree/transcript authority. The adapter
uses bounded disposable memory and explicit budget/staleness failures. Known
internal state receives fixed safe text, unknown content/continuity blocks the
read, native pruning notices remain explicit and displayed history makes no
per-entry provider-input assertion. No raw JSON or original download is exposed.

This narrows the implementation of [ADR 0010](0010-native-history-projection.md)
and does not replace its Native/DSH integration, immediate durable navigation,
rebuild or acceptance obligations. The current DTO's flattened text and lack of
typed pruning metadata do not complete ticket 46. Fixture traces do not establish
Native, browser, private admission or final supported-tuple evidence.
