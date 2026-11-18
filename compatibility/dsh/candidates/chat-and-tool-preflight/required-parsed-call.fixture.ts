import { throws } from 'node:assert/strict'
import { expect, test } from 'bun:test'
import { SessionFormatError } from '@deepseek-ai/dsh-session-format'
import { sessionFormatCatalog, SessionFormatUnsupportedMigrationError } from '@deepseek-ai/dsh-session-format-catalog'

const header = { type: 'session', version: 4, id: 'parsed-call', createdAt: 1, isSeeded: false, delegationDepth: 0 }
const parsed = {
  type: 'tool/parsed-call', seq: 0, time: 1,
  data: {
    turn: 1, step: 1, callId: 'parsed-1', name: 'synthetic', arguments: { nested: [false, null, { text: '雪' }] },
  },
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

test('dormant vocabulary retains an unknown ignorable event as opaque data', () => {
  const unknown = { ...parsed, type: 'external/opaque', ignorable: true }
  expect(restore([unknown])).toEqual([unknown])
})

test('legacy vocabulary rejects the same standalone unmarked required parsed call', () => {
  throws(() => restore([parsed]), (error: unknown) =>
    error instanceof SessionFormatUnsupportedMigrationError
      && /unknown event type "tool\/parsed-call"/.test(error.message))
})

test('legacy vocabulary keeps an externally marked unknown parsed tag opaque', () => {
  const opaque = { ...parsed, ignorable: true }
  expect(restore([opaque])).toEqual([opaque])
})

test('both vocabularies retain the exact raw tool argument string', () => {
  const argumentsRaw = '{ "n": 1, "escaped": "\\u96ea" }'
  const coordinates = { turn: 1, step: 1 }
  const rows = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: coordinates },
    { type: 'assistant/message', surfaceOp: 'append', data: { ...coordinates, stream: [], message: {
      id: 'assistant', role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'fixture' },
      content: [{ type: 'tool-call', id: 'raw-1', name: 'synthetic', arguments: argumentsRaw }],
    } } },
    { type: 'tool/call', data: { ...coordinates, callId: 'raw-1', name: 'synthetic', arguments: argumentsRaw } },
  ].map((row, seq) => ({ ...row, seq, time: seq + 1 }))
  expect(restore(rows)).toEqual(rows)
})
