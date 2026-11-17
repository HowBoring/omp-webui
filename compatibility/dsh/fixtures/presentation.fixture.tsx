import { renderToStaticMarkup } from 'react-dom/server'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { expect, test } from 'bun:test'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/src/client/conversation/assembler'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { toolDefinition } from '../../../vendor/dsh/packages/client/ui-chat/src/client/conversation-nodes/tool.ts'
import { GenericToolCard } from '../../../vendor/dsh/packages/client/ui-tool/src/client/tool/toolviews/GenericToolCard.tsx'
import { chatViewDefinition } from '@deepseek-ai/dsh-client-ui-chat/src/client/conversation-nodes/chat-snapshot-builder'

const value = { text: '<script>globalThis.bad = true</script>\n雪', count: 2, enabled: false }
const raw = ' { "enabled": false, "count":2, "text":"quoted" } '
const callId = ToolCallId('display-fixture')

// Public module composition only; no Session, worker, registry mutation or provider.
function project(type: 'tool/call' | 'tool/parsed-call', settled = false) {
  const assembler = new ConversationNodeAssembler(
    { entries: () => [toolDefinition], fallbackEntry: () => undefined },
    { entries: () => [chatViewDefinition] },
    { entries: () => [], forTarget: () => undefined },
  )
  const common = { turn: 1, step: 1, callId, name: 'display_echo' }
  const call: SessionEvent<'tool/call' | 'tool/parsed-call'> = type === 'tool/call'
    ? { type, seq: SessionSeq(3), time: 3, data: { ...common, arguments: raw } }
    : { type, seq: SessionSeq(3), time: 3, data: { ...common, arguments: value } }
  const entries: SessionEventLikeEntry[] = [
    { type: 'event', event: { type: 'turn/start', seq: SessionSeq(1), time: 1, data: { turn: 1 } } },
    { type: 'event', event: { type: 'step/start', seq: SessionSeq(2), time: 2, data: { turn: 1, step: 1 } } },
    { type: 'event', event: call },
  ]
  if (settled) entries.push({ type: 'event', event: { type: 'tool/result', seq: SessionSeq(4), time: 4,
    surfaceOp: 'append', data: { turn: 1, step: 1, message: createToolResultMessage({ callId,
      content: [{ type: 'text', text: 'final <b>result</b>' }], isError: true }) } } })
  assembler.replaceWindow(entries, false)
  assembler.activateTarget('chat')
  assembler.flush()
  const snapshot = assembler.get('chat')
  if (!snapshot) throw new Error('CHAT_SNAPSHOT_UNAVAILABLE')
  const data = snapshot.nodes.turnDataSource(1, 'tool-call').getSnapshot()[0]
  if (!data) throw new Error('TOOL_PRESENTATION_UNAVAILABLE')
  return data.root
}

test('public call projection preserves raw spelling and presents parsed objects without a raw field', () => {
  const parsed = project('tool/parsed-call')
  expect(parsed).toMatchObject({ phase: 'start', argumentRepresentation: 'parsed-json', argsParsed: value })
  expect(parsed).not.toHaveProperty('argsRaw')
  const legacy = project('tool/call')
  if ('kind' in parsed || parsed.phase !== 'start' || 'kind' in legacy || legacy.phase !== 'start') {
    throw new Error('START_PRESENTATION_REQUIRED')
  }
  expect(legacy.argsRaw).toBe(raw)
  expect(legacy).not.toHaveProperty('argsParsed')
  const card = GenericToolCard({ phase: 'start', block: parsed, callId, toolName: 'display_echo',
    t: key => key, useDisclosure: () => ({ expanded: true, setExpanded: () => {}, toggle: () => {} }), openFile: () => {},
    loadImage: async () => { throw new Error('IMAGE_FORBIDDEN') }, getFileTriggerProps: () => { throw new Error('ARGUMENT_LINK_FORBIDDEN') } })
  expect(card.props.bodyRaw).toBeNull()
  expect(card.props.bodyParsed).toBe('{\n  "text": "<script>globalThis.bad = true</script>\\n雪",\n  "count": 2,\n  "enabled": false\n}')
  expect(card.props.variant).toBe('others')
  const markup = renderToStaticMarkup(card)
  expect(markup).toContain('row.parsedInput')
  expect(markup).toContain('&lt;script&gt;')
  expect(markup).not.toContain('<script>')
  expect(markup).not.toContain('<a ')
  expect(markup).not.toContain('download=')
  const replayed = project('tool/parsed-call', true)
  if (!('kind' in replayed)) throw new Error('RESULT_PRESENTATION_REQUIRED')
  expect(replayed.call).toMatchObject({ argumentRepresentation: 'parsed-json', argsParsed: value })
  expect(replayed.call).not.toHaveProperty('argsRaw')
  expect(replayed.isError).toBe(true)
  expect(replayed.content).toEqual([{ type: 'text', text: 'final <b>result</b>' }])
  const legacyResult = project('tool/call', true)
  if (!('kind' in legacyResult)) throw new Error('RAW_RESULT_REQUIRED')
  expect(legacyResult.call).toEqual({ name: 'display_echo', argsRaw: raw })
})
