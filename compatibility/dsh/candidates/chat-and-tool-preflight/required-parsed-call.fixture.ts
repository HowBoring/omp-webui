import { throws } from 'node:assert/strict'
import { expect, test } from 'bun:test'
import { SessionFormatError } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import { sessionFormatCatalog, SessionFormatUnsupportedMigrationError } from '@deepseek-ai/dsh-session-format-catalog'

const header = { type: 'session', version: 4, id: 'parsed-call', createdAt: 1, isSeeded: false, delegationDepth: 0 }
const coordinates = { turn: 1, step: 1 }
const tool = { callId: 'parsed-1', name: 'synthetic' }
const stepRows = [
  { type: 'turn/start', data: { turn: 1 } },
  { type: 'step/start', data: coordinates },
]
const result = {
  type: 'tool/result', surfaceOp: 'append', data: { ...coordinates, message: {
    id: 'result', role: 'tool', source: { kind: 'tool', callId: tool.callId },
    toolCallId: tool.callId, content: [{ type: 'text', text: 'done' }],
  } },
}
const parsed = {
  type: 'tool/parsed-call', seq: 0, time: 1,
  data: {
    ...coordinates, ...tool, arguments: { nested: [false, null, { text: '雪' }] },
  },
}

type UnsequencedEvent = Pick<SessionFormatEvent, 'type' | 'data'> & SessionFormatJsonObject

function sequence(rows: readonly UnsequencedEvent[]) {
  return rows.map((row, seq) => ({ ...row, seq, time: seq + 1 }))
}

function restore(rows: readonly unknown[]) {
  const decoder = sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' })
  for (const row of rows) decoder.decodeRow(JSON.parse(JSON.stringify(row)))
  return decoder.finish().events
}

test('dormant vocabulary retains a standalone required parsed call and its nested JSON', () => {
  expect(restore([parsed])).toEqual([parsed])
})

test('dormant vocabulary rejects the same parsed call marked ignorable', () => {
  throws(() => restore([{ ...parsed, ignorable: true }]), (error: unknown) =>
    error instanceof SessionFormatError
      && error.message === 'format v4 event tool/parsed-call at seq 0 must not be ignorable')
})

const malformedArguments = { string: '{}', array: [], null: null, missing: undefined }
for (const [kind, args] of Object.entries(malformedArguments)) {
  test(`dormant vocabulary rejects parsed-call arguments stored as ${kind}`, () => {
    const malformed = { ...parsed, data: { ...parsed.data, arguments: args } }
    throws(() => restore([malformed]), (error: unknown) =>
      error instanceof SessionFormatError
        && error.message === 'format v4 event tool/parsed-call at seq 0 arguments must be a JSON object')
  })
}

test('dormant vocabulary still requires an advertised tool lifecycle for an ordinary result', () => {
  throws(() => restore(sequence([...stepRows, parsed, result])), (error: unknown) =>
    error instanceof SessionFormatError
      && error.message === 'tool/result parsed-1 has no advertised tool lifecycle')
})

test('dormant vocabulary retains an unknown ignorable event as opaque data', () => {
  const unknown = { ...parsed, type: 'external/opaque', ignorable: true, data: ['opaque'] }
  expect(restore([unknown])).toEqual([unknown])
})

test('legacy vocabulary rejects the same standalone unmarked required parsed call', () => {
  throws(() => restore([parsed]), (error: unknown) =>
    error instanceof SessionFormatUnsupportedMigrationError
      && /unknown event type "tool\/parsed-call"/.test(error.message))
})

test('legacy vocabulary keeps an externally marked unknown parsed tag opaque', () => {
  const opaque = { ...parsed, ignorable: true, data: { ...parsed.data, arguments: '{}' } }
  expect(restore([opaque])).toEqual([opaque])
})

test('both vocabularies retain the exact raw tool argument string and its ordinary result', () => {
  const argumentsRaw = '{ "n": 1, "escaped": "\\u96ea" }'
  const rows = sequence([
    ...stepRows,
    { type: 'assistant/message', surfaceOp: 'append', data: { ...coordinates, stream: [], message: {
      id: 'assistant', role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'fixture' },
      content: [{ type: 'tool-call', id: tool.callId, name: tool.name, arguments: argumentsRaw }],
    } } },
    { type: 'tool/call', data: { ...coordinates, ...tool, arguments: argumentsRaw } },
    result,
  ])
  expect(restore(rows)).toEqual(rows)
})
