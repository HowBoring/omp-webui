import type { SessionEvent, SessionEventMap } from '../../../vendor/dsh/packages/core/session/src/types.ts'
import { SessionSeq } from '../../../vendor/dsh/packages/core/session/src/types.ts'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { ToolCallArguments } from '../../../vendor/dsh/packages/client/ui-conversation/src/client/contract/records.ts'

const raw: SessionEventMap['tool/call'] = { turn: 1, step: 1, callId: ToolCallId('raw'), name: 'echo', arguments: ' { "x": 1 } ' }
const parsed: SessionEventMap['tool/parsed-call'] = { ...raw, arguments: { x: 1, nested: [false, null, '雪'] } }
const displayRaw: ToolCallArguments = { argsRaw: raw.arguments }
const displayParsed: ToolCallArguments = { argumentRepresentation: 'parsed-json', argsParsed: parsed.arguments }
const required: SessionEvent<'tool/parsed-call'> = { type: 'tool/parsed-call', seq: SessionSeq(1), time: 1, data: parsed }
// @ts-expect-error Parsed presentation must never carry a reconstructed original string.
const ambiguous: ToolCallArguments = { ...displayParsed, argsRaw: '{}' }
// @ts-expect-error Existing tool/call arguments remain exact raw model text.
const wrongRaw: SessionEventMap['tool/call'] = { ...raw, arguments: { x: 1 } }
// @ts-expect-error Parsed display arguments must be a JSON object, not a string.
const wrongParsed: SessionEventMap['tool/parsed-call'] = { ...parsed, arguments: '{}' }
// @ts-expect-error The new event changes readable content and cannot be omitted by old readers.
const ignorable: SessionEvent<'tool/parsed-call'> = { ...required, ignorable: true }
void [displayRaw, displayParsed, required, ambiguous, wrongRaw, wrongParsed, ignorable]
