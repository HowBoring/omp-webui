import { isDeepStrictEqual } from 'node:util';
import type { HistoryItem } from '../contracts/generated/omp-wire.ts';
import { MAX_ITEM_BYTES } from './history-records.ts';

/** Opening pages contain contiguous Native record parts, including across page boundaries. */
export class HistoryRecordParts {
  readonly #parts: string[] = [];
  #textBytes = 0;
  #trailingHighSurrogate = '';
  #nextPart = 0;
  constructor(readonly first: HistoryItem, readonly count: number, readonly keepText: boolean) {}

  append(item: HistoryItem, index: number): HistoryItem | undefined {
    const entryId = item.entryId;
    const expectedId = index === 0 ? entryId ?? item.id : `${entryId}:part:${index}`;
    if (index !== this.#nextPart || (item.partCount ?? 1) !== this.count || item.id !== expectedId
      || (this.count > 1 && !entryId)
      || (index > 0 && !isDeepStrictEqual(this.#metadata(this.first), this.#metadata(item)))) {
      throw Error('live_open_parts');
    }
    this.#nextPart++;
    if (this.keepText) this.#appendText(item.text);
    if (this.#nextPart === this.count) return {...this.first, text: this.#parts.join('')};
  }

  #appendText(text: string): void {
    let measured = this.#trailingHighSurrogate + text;
    this.#trailingHighSurrogate = '';
    const lastUnit = measured.charCodeAt(measured.length - 1);
    // Native can split a surrogate pair between parts. Measure the trailing high unit with the next part.
    if (this.#nextPart < this.count && lastUnit >= 0xd800 && lastUnit <= 0xdbff) {
      this.#trailingHighSurrogate = measured.slice(-1);
      measured = measured.slice(0, -1);
    }
    this.#textBytes += Buffer.byteLength(JSON.stringify(measured)) - 2;
    // An unfinished pair will cost at least four bytes. The final DSH envelope is checked separately.
    if (this.#textBytes + (this.#trailingHighSurrogate ? 4 : 0) > MAX_ITEM_BYTES) {
      throw Error(this.first.livePhase === 'streaming' ? 'live_attempt_evicted' : 'live_event_bytes');
    }
    this.#parts.push(text);
  }

  #metadata(item: HistoryItem) {
    const { id: _id, partIndex: _partIndex, text: _text, ...metadata } = item;
    return metadata;
  }
}
