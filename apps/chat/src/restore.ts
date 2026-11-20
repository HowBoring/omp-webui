import type { StopSnapshot } from "../../../packages/contracts/stop.ts";
export interface RestoredDraft { readonly text: string; readonly note: string }
/** Only the browser decides whether recovered text becomes the composer draft; it never overwrites one. */
export function restoredDraft(snapshot: StopSnapshot, current: string): RestoredDraft | undefined {
  const restored = snapshot.restored;
  if (!restored) return;
  const value = [...restored.steering, ...restored.followUp].map(item => item.text).join("\n");
  const images = [...restored.steering, ...restored.followUp].filter(item => item.images?.length).length;
  const losses = [images && `${images} queued input${images === 1 ? "" : "s"} had images that could not be restored as drafts`,
    restored.imagesDropped && "attachments were dropped", restored.truncated && "the restored text was truncated"]
    .filter(Boolean).join("; ");
  if (value === "") return { text: "", note: losses ? `Stop restored no text: ${losses}.` : "" };
  if (current.trim() !== "") return { text: "", note: `Stop returned queued input that was not inserted because this draft is not empty.${losses ? ` ${losses}.` : ""}` };
  return { text: value, note: `Stop restored queued input as an unsent draft.${losses ? ` ${losses}.` : ""}` };
}
