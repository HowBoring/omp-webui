import type { SessionHistoryRecord, SessionPageRequest } from '@deepseek-ai/dsh-api-session-controller/types';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type { HistoryItem } from '../contracts/generated/omp-wire.ts';

export const MAX_EVENTS = 60_000;
export const MAX_ITEM_BYTES = 512 * 1024;
export const PAGE_BYTES = 768 * 1024;
export const PAGE_OVERHEAD = 1024;
export type PageRequest = Pick<SessionPageRequest, 'throughSeq' | 'beforeSeq' | 'maxMessages'>;

export function pageCoordinates(request: PageRequest, cursor: number) {
  const through = request.throughSeq ?? cursor;
  const end = request.beforeSeq ?? through + 1;
  if (!Number.isSafeInteger(through) || through > cursor || through < -1 || !Number.isSafeInteger(end)
    || end < 0 || end > through + 1) throw Error('live_stale_page');
  const maximum = request.maxMessages ?? 32;
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw Error('live_page_limit');
  return { end, maximum: Math.min(128, maximum) };
}

export function historyEvent(seq: number, type: string, data: JsonValue, surface = false): SessionHistoryRecord {
  return { type: 'event', event: { type, seq, time: 0, data,
    ...(surface ? { surfaceOp: 'append' } : { ignorable: true }) } };
}

interface Counters { turn: number; step: number }

export function settledCoordinates(role: HistoryItem['role'], { turn, step }: Counters) {
  if (role === 'user') return { turn: turn + 1, step, length: 2 };
  if (role === 'assistant') return { turn, step: step + 1, length: 3 };
  return { turn, step, length: 1 };
}

type EmitEvent = (type: string, data: JsonValue, surface?: boolean) => SessionHistoryRecord;

export function historyMessage(item: HistoryItem, id: string, { turn, step }: Counters,
  emit: EmitEvent, continuingAssistant = false): SessionHistoryRecord {
  const content = [{ type: 'text', text: item.text }];
  if (item.role === 'user') {
    emit('turn/start', { turn });
    return emit('user/message', { id, role: 'user', source: { kind: 'user' }, content }, true);
  }
  if (item.role === 'assistant') {
    if (!item.provider || !item.model) throw Error('live_missing_model_source');
    if (!continuingAssistant) emit('step/start', { turn, step });
    const message = emit('assistant/message', {
      turn, step, message: { id, role: 'assistant',
        source: { kind: 'model', provider: item.provider, model: item.model }, content },
      stream: [], ...(item.stopReason === 'aborted' ? { interrupted: true } : {}),
    }, true);
    if (!continuingAssistant) emit('step/end', { turn, step });
    return message;
  }
  return emit('omp/native-record', { id, kind: item.kind, text: item.text, role: item.role ?? null });
}

export function settledHistoryRecords(item: HistoryItem, id: string, start: number, position: Counters) {
  const records: SessionHistoryRecord[] = [];
  historyMessage(item, id, position, (type, data, surface) => {
    const record = historyEvent(start + records.length, type, data, surface);
    records.push(record);
    return record;
  });
  return records;
}
