import type { SessionHistoryRecord, SessionPageRequest } from '@deepseek-ai/dsh-api-session-controller/types';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type { TurnEndReason } from '@deepseek-ai/dsh-session/types';
import type { HistoryError, HistoryItem } from '../contracts/generated/omp-wire.ts';

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
    ...(surface ? { surfaceOp: 'append' } : type === 'tool/parsed-call' ? {} : { ignorable: true }) } };
}

interface Counters { turn: number; step: number }

export function settledCoordinates(role: HistoryItem['role'], { turn, step }: Counters, toolCalls = 0,
                                    turnEnds = false) {
  if (role === 'user') return { turn: turn + 1, step, length: 2 };
  if (role === 'assistant') return { turn, step: step + 1, length: 3 + toolCalls + (turnEnds ? 1 : 0) };
  return { turn, step, length: 1 };
}

type EmitEvent = (type: string, data: JsonValue, surface?: boolean) => SessionHistoryRecord;

/** Native call ids are ordered; an unanswered call may not silently change owner. */
export class ToolCallLedger {
  readonly #calls = new Map<string, number>();
  readonly #results = new Map<string, number>();
  call(callId: string, _owner: string): void {
    const calls = this.#calls.get(callId) ?? 0, results = this.#results.get(callId) ?? 0;
    if (calls > results) throw Error('live_tool_owner_unavailable');
    this.#calls.set(callId, calls + 1);
  }
  result(callId: string, _owner: string | null): void {
    const calls = this.#calls.get(callId) ?? 0, results = this.#results.get(callId) ?? 0;
    if (results >= calls) throw Error('live_tool_owner_unavailable');
    this.#results.set(callId, results + 1);
  }
}

/** Native kinds that carry conversation text and therefore map onto a stock user message. */
const visibleKinds = new Set(['custom_message', 'fileMention', 'compaction', 'branch_summary', 'reset_boundary']);
/** Native log bookkeeping with no conversational content: model/selection/usage/title metadata that the
 * session projections already expose through their own surfaces. Explicitly omitted, never guessed into a
 * stock event the client would render as dialogue. */
const ignorableKinds = new Set(['model_usage', 'thinking_level_change', 'model_change', 'service_tier_change',
  'title_change', 'session_init', 'mode_change', 'credential_pin', 'ttsr_injection', 'label']);
const nativeRoles = new Set(['developer', 'custom', 'hookMessage', 'bashExecution', 'pythonExecution', 'toolResult',
  'fileMention', 'compactionSummary', 'branchSummary', 'resetBoundary']);

function usageValue(item: HistoryItem) {
  const usage = item.usage;
  if (!usage || typeof usage.inputTokens !== 'number' || typeof usage.outputTokens !== 'number') return undefined;
  return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
    ...(typeof usage.totalTokens === 'number' ? {totalTokens: usage.totalTokens} : {}),
    ...(typeof usage.cacheReadTokens === 'number' ? {cacheReadTokens: usage.cacheReadTokens} : {}),
    ...(typeof usage.cacheWriteTokens === 'number' ? {cacheWriteTokens: usage.cacheWriteTokens} : {}),
    ...(typeof usage.reasoningTokens === 'number' ? {reasoningTokens: usage.reasoningTokens} : {}) };
}

/**
 * Say what a native log record is worth to the stock conversation surface. Visible records become one
 * stock user message carrying their exact text (file mentions list their files); records that only record
 * bookkeeping are omitted; anything not known here is a typed compatibility failure, never a silent skip.
 */
function nativeMessage(item: HistoryItem, id: string): JsonValue | undefined {
  const surface = item.role === 'fileMention' ? 'fileMention'
    : item.role === 'compactionSummary' ? 'compaction'
    : item.role === 'branchSummary' ? 'branch_summary'
    : item.role === 'resetBoundary' ? 'reset_boundary'
    : (item.kind === 'message' && item.role !== undefined ? item.role : item.kind);
  if (ignorableKinds.has(surface)) return undefined;
  if (!visibleKinds.has(surface) && surface !== 'custom') throw Error('live_native_record_unsupported');
  if (item.role !== undefined && !nativeRoles.has(item.role)) throw Error('live_native_record_unsupported');
  if (item.display === false) return undefined;
  const files = item.files?.length
    ? `\n${item.files.map(file => `[file] ${typeof file === 'string' ? file : file.path}`).join("\n")}` : '';
  if (item.text === '' && files === '') return undefined;
  return { id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `${item.text}${files}` }] };
}

/** Native stop reasons that end the whole turn, not just the current step. */
export function turnEndReasonFor(stopReason: string | undefined, error: HistoryError | undefined): TurnEndReason | undefined {
  switch (stopReason) {
    case 'stop': return { kind: 'completed' };
    case 'length': return { kind: 'max-tokens' };
    case 'aborted': return { kind: 'aborted', reason: { kind: 'user' } };
    case 'error':
      return { kind: 'error', error: { message: error?.reason ?? 'The model request failed',
        code: error?.code !== undefined ? String(error.code) : 'UNKNOWN',
        ...(error?.status !== undefined ? { status: error.status } : {}) } };
    default: return undefined; // `toolUse` and unknown native reasons keep the turn open
  }
}

export function turnEndReason(item: HistoryItem): TurnEndReason | undefined {
  return item.role === 'assistant' ? turnEndReasonFor(item.stopReason, item.error) : undefined;
}

export function historyMessage(item: HistoryItem, id: string, { turn, step }: Counters,
  emit: EmitEvent, continuingAssistant = false, ledger?: ToolCallLedger): SessionHistoryRecord | undefined {
  const content: JsonValue[] = [];
  if (item.role === 'assistant' && item.reasoning) content.push({ type: 'reasoning', text: item.reasoning });
  content.push({ type: 'text', text: item.text });
  if (item.role === 'user') {
    emit('turn/start', { turn });
    return emit('user/message', { id, role: 'user', source: { kind: 'user' }, content }, true);
  }
  if (item.role === 'assistant') {
    if (!item.provider || !item.model) throw Error('live_missing_model_source');
    if (!continuingAssistant) emit('step/start', { turn, step });
    const usage = usageValue(item);
    const message = emit('assistant/message', {
      turn, step, message: { id, role: 'assistant',
        source: { kind: 'model', provider: item.provider, model: item.model }, content },
      stream: [], ...(usage ? { usage } : {}), ...(item.stopReason === 'aborted' ? { interrupted: true } : {}),
    }, true);
    for (const call of item.toolCalls ?? []) {
      ledger?.call(call.callId, id);
      emit('tool/parsed-call', { turn, step, callId: call.callId, name: call.name, arguments: call.arguments as JsonValue,
        ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}) });
    }
    if (!continuingAssistant) {
      emit('step/end', { turn, step });
      const reason = turnEndReason(item);
      if (reason) emit('turn/end', { turn, reason: reason as unknown as JsonValue });
    }
    return message;
  }
  if (item.role === 'toolResult' && item.toolCallId) {
    ledger?.result(item.toolCallId, item.parentId ?? null);
    const error = item.isError && item.error
      ? { name: item.toolName ?? 'ToolError', code: String(item.error.code ?? item.error.status ?? 'NATIVE_TOOL_ERROR'),
        reason: item.error.reason } : undefined;
    return emit('tool/result', { turn, step, message: { id, role: 'tool',
      source: { kind: 'tool', callId: item.toolCallId }, content, toolCallId: item.toolCallId,
      ...(item.isError ? { isError: true } : {}) }, ...(error ? { error } : {}) }, true);
  }
  const message = nativeMessage(item, id);
  return message === undefined ? undefined : emit('user/message', message, true);
}

export function settledHistoryRecords(item: HistoryItem, id: string, start: number, position: Counters,
  ledger?: ToolCallLedger) {
  const records: SessionHistoryRecord[] = [];
  historyMessage(item, id, position, (type, data, surface) => {
    const record = historyEvent(start + records.length, type, data, surface);
    records.push(record);
    return record;
  }, false, ledger);
  return records;
}
