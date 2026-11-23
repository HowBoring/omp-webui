/**
 * Native History keeps a user image only as placeholder text plus a retained-content reference.
 * The stock conversation surface renders a real image from an `ImageAttachmentRef`, so the Host
 * replaces that placeholder with the stock image block. The reference is metadata: bytes still come
 * from the authenticated Original store through the Session binding's `readAttachment`.
 */
import type { SessionHistoryRecord } from '@deepseek-ai/dsh-api-session-controller/types';
import type { BrowserAccess } from '../access/index.ts';

/** Exact text the OMP runtime writes for an image whose bytes remain retained. */
export const retainedImageMarker = '[Retained native image available; original association unproven]';
const markerPattern = new RegExp(`\\n?${retainedImageMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');

export interface RetainedImage {
  entryId: string; objectId: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  bytes: number; width: number; height: number; name?: string;
}

/** Host port the stock Session service uses to turn a retained entry into image blocks and bytes. */
export interface SessionImages {
  /** Metadata for entries the exact Session still retains; no bytes are read here. */
  retained(identity: BrowserAccess, sessionId: string, entryIds: readonly string[]):
    ReadonlyMap<string, RetainedImage>;
  /** The stock `session/attachment` read: rechecks association and exact bytes, then returns them. */
  read(identity: BrowserAccess, sessionId: string, attachment: {
    attachmentId: string; mediaType: string; bytes: number; width: number; height: number }):
    Promise<{ data: Uint8Array; mediaType: string }>;
}

interface UserMessageData { id?: unknown; content?: unknown; [key: string]: unknown }
interface TextPart { type: 'text'; text: string }

function messageData(record: SessionHistoryRecord): UserMessageData | undefined {
  if (record.type !== 'event' || record.event.type !== 'user/message') return;
  const data = record.event.data;
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? data as UserMessageData : undefined;
}

function isTextPart(part: unknown): part is TextPart {
  return typeof part === 'object' && part !== null && (part as TextPart).type === 'text'
    && typeof (part as TextPart).text === 'string';
}

/**
 * Replace `marker` in the one content part that carries it and append the stock image blocks.
 * A different part of the same native entry never repeats the image: only the part that actually
 * held the image marker is decorated.
 */
export function applyHistoryImages(records: readonly SessionHistoryRecord[],
  images: readonly RetainedImage[]): readonly SessionHistoryRecord[] {
  if (images.length === 0) return records;
  const byEntry = new Map<string, RetainedImage[]>();
  for (const image of images) {
    const found = byEntry.get(image.entryId);
    if (found === undefined) byEntry.set(image.entryId, [image]); else found.push(image);
  }
  return records.map(record => {
    const data = messageData(record);
    const id = data?.id, original = data?.content;
    if (typeof id !== 'string' || !Array.isArray(original)) return record;
    const retained = byEntry.get(id);
    if (retained === undefined) return record;
    const index = original.findIndex(part => isTextPart(part) && part.text.includes(retainedImageMarker));
    if (index < 0) return record;
    const content = [...original];
    const text = (content[index] as TextPart).text.replace(markerPattern, '').replace(/\n+$/, '');
    if (text === '') content.splice(index, 1); else content[index] = { type: 'text', text };
    for (const image of retained) content.push({ type: 'image', attachment: {
      attachmentId: image.objectId, mediaType: image.mediaType, bytes: image.bytes,
      width: image.width, height: image.height, ...(image.name === undefined ? {} : { name: image.name }),
    } });
    return { ...record, event: { ...record.event, data: { ...data, content } } } as SessionHistoryRecord;
  });
}
