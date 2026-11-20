import { expect, test } from "bun:test";
import type { StopSnapshot } from "../../packages/contracts/stop.ts";
import { restoredDraft } from "../../apps/chat/src/restore.ts";
const snapshot = (restored: StopSnapshot["restored"]): StopSnapshot => ({ generation: "g1", workerGeneration: "w1",
  scope: { kind: "session", sessionId: "s1" }, status: "stopping", nativeSettled: false, acceptingWork: false,
  pending: { interactions: 0, history: 0, queued: 0, other: 0 }, failures: [], forceAvailable: false,
  restored, draftConflict: false });
test("restored native queue becomes an unsent draft with losses explained", () => {
  expect(restoredDraft(snapshot({ steering: [{ text: "first" }], followUp: [{ text: "second", images: [{ type: "image", data: "AA==", mimeType: "image/png" }] }],
    imagesDropped: true, truncated: true, unsentOnly: true }), "")).toEqual({ text: "first\nsecond",
    note: "Stop restored queued input as an unsent draft. 1 queued input had images that could not be restored as drafts; attachments were dropped; the restored text was truncated." });
});
test("a non-empty draft is never overwritten by restored queue input", () => {
  expect(restoredDraft(snapshot({ steering: [{ text: "queued" }], followUp: [], unsentOnly: true }), "my draft"))
    .toEqual({ text: "", note: "Stop returned queued input that was not inserted because this draft is not empty." });
});
test("no restored queue leaves the draft untouched", () => {
  expect(restoredDraft(snapshot(null), "my draft")).toBeUndefined();
});
