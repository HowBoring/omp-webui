# ADR 0009: Preserve attachment originals independently of native model inputs

- Status: Accepted Q1–Q10 product policies; implementation and validation pending
- Date: 2026-11-16
- Decision: [图片与文件输入：格式范围、RPC 链路与存储边界](https://github.com/HowBoring/omp-webui/issues/28)

The MVP retains exact uploaded originals and minimal associations across Host restarts because native
history may contain normalized images or extracted/truncated document content rather than originals.
OMP remains the only conversation authority; Host storage is an attachment object/index, not another
transcript. This makes the attachment retention decision reserved by ADRs 0005 and 0006 explicit.

Confirmed originals linked to committed native inputs have no automatic time expiry. Unsent staging
may expire after 24 hours measured from explicit draft edits or active user recovery; reads, refreshes
and Host restart do not renew the clock. Execution and unresolved submission references protect objects.
The 10 GiB Host attachment budget refuses new storage when full, without automatic historical eviction.
Deletion affects the selected original and its known references, requires impact confirmation, and is
refused during related execution, known occupation or unresolved submission. It does not alter native
messages or previously stored model inputs.

Intake requires explicit New/Open with verified native identity. Per-tab, per-Session drafts recover
text and still-valid original references across same-tab reload or Host restart using fresh receipts,
without automatic submission; closing the page/browser has no recovery guarantee. This accepts extra
public draft-hydration work instead of browser-wide shared drafts or a durable draft library.

The selected formats and initial raw-input targets are recorded in the [attachment contract](../attachment-contract.md).
Numbers are acceptance targets, not evidence that the current native/browser combination can meet them.
Public RPC needs recoverable native submission/entry and persistence evidence; a process-local message ID,
ack or in-memory entry snapshot cannot supply that proof.

All attachments must pass validation and necessary OMP preparation before prompt admission. Failure
preserves the draft for retry or removal; content-affecting degradation such as truncation requires
explicit user acceptance of the actual prepared result. Admission waits until every item is accounted
for, accepting extra waiting and a public preparation/consumption guarantee in the pinned compatibility
build. Execution must consume the validated result; changes invalidate stale acceptance.
Model/tool execution can still have effects that cannot be rolled back. These guarantees are not yet implemented.

This trades bounded Host-owned storage, metadata and recovery work for original availability. Expiring
originals automatically would break historical downloads and possibly later file reads; keeping every
byte without an intake quota would allow unbounded growth. Source/schema/client, TUI/history/data and
actual global-install compatibility remain mandatory gates. No SDK or native Session-file bypass is approved.
