import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { HistoryClient } from '../../packages/contracts/generated/history-client.ts';
import type { HistoryCut, HistoryItem, HistoryOpen, HistoryPage } from '../../packages/contracts/generated/omp-wire.ts';
import type { SessionFollowFrame } from '@deepseek-ai/dsh-api-session-controller/types';
import { LiveJournal } from '../../packages/projection/live-journal.ts';

const initialCut: HistoryCut = {
  durability: 'not_attested', sourceBindingStatus: 'worker', sourceId: 'source', sessionId: 'session', workerId: 'worker',
  contextId: 'context', contentRevision: 'content-v1', nativeRevision: 1, retainedRevision: 'retained-v1',
  leafId: 'last', observationSeq: 0,
};
const item = (id: string, parentId: string | null, text: string): HistoryItem =>
  ({id, parentId, active: true, kind: 'message', role: 'user', text});
const prefixMarker: HistoryItem = {id: 'running-prefix', parentId: null, active: false, kind: 'running_prefix',
  text: "[Running prefix content is available through this snapshot's running cursor]"};
const prefixLive = {workerId: initialCut.workerId, sourceId: initialCut.sourceId, sessionId: initialCut.sessionId,
  contextId: initialCut.contextId, branchLeafId: 'last', messageId: 'msg-1'};
const prefixRow: HistoryItem = {...prefixMarker, entryId: prefixMarker.id, partIndex: 0, partCount: 1,
  role: 'assistant', live: prefixLive, livePhase: 'streaming', text: 'In flight'};

function fixture(active: HistoryItem[][], options: {
  cut?: HistoryCut;
  page?: (page: HistoryPage, index: number) => HistoryPage;
  refusePage?: number;
  live?: HistoryItem[][];
  prefix?: HistoryItem;
  staleOpen?: boolean;
} = {}) {
  const cut = options.cut ?? initialCut;
  const opened: HistoryOpen = {
    version: 'coherent-history-v1', handoff: 'live', snapshot: 'snapshot', cursor: 'active-0', scope: 'active', cut,
    cursors: {active: 'active-0', live: 'live-0', tree: 'tree-0', running: 'running-0'},
    expiresAt: Date.now() + 10_000, count: active.reduce((sum, page) => sum + page.length, 0),
    prefix: options.prefix ?? null, streaming: options.prefix !== undefined, compacting: false,
    scannedBytes: 0, scanMs: 0, snapshotMs: 0,
    limits: {entries: 20_000, runningMessages: 10_000, scanItems: 60_000, bytes: 320 * 1024 * 1024,
      nativeItemBytes: 64 * 1024 * 1024, itemBytes: 512 * 1024, ms: 10_000, snapshotBytes: 256 * 1024 * 1024,
      cacheBytes: 512 * 1024 * 1024, snapshots: 2, pageItems: 128, pageBytes: 768 * 1024,
      responseBytes: 1024 * 1024, ttlMs: 10_000, contentItems: 64, contentPageBytes: 256 * 1024,
      liveEvents: 1024, liveBytes: 1024 * 1024, pollItems: 100},
  };
  let opens = 0;
  const history = new HistoryClient(async command => {
    switch (command.type) {
      case 'history_snapshot_open':
        assert.equal(command.scope, 'active');
        assert.equal(command.handoff, 'live');
        // A cold Session moves its cut while it activates; the first opening observes the older cut.
        return options.staleOpen && opens++ === 0 ? {...opened, cut: {...cut, contextId: 'context-0'}} : opened;
      case 'history_snapshot_close':
        assert.equal(command.snapshot, opened.snapshot);
        return {closed: true};
      case 'history_observation_poll':
        assert.equal(command.after, cut.observationSeq);
        return {cut, after: cut.observationSeq, through: cut.observationSeq, events: [], hasMore: false};
      case 'history_snapshot_page': {
        const scope = command.cursor.startsWith('active-') ? 'active' : 'live';
        const pages = scope === 'active' ? active : options.live ?? [[]];
        let index = Number(command.cursor.split('-')[1]);
        let offset = pages.slice(0, index).reduce((sum, page) => sum + page.length, 0);
        if (scope === 'active' && command.before !== undefined) {
          const rows = pages.flat();
          offset = Math.max(0, Math.min(command.before, rows.length) - 128);
          index = 0;
          const items = rows.slice(offset, Math.min(command.before, rows.length));
          if (options.refusePage !== undefined && options.refusePage < index) throw Error('fixture_read_past_oversized_record');
          const page: HistoryPage = {snapshot: opened.snapshot, scope, cut, expiresAt: opened.expiresAt,
            items, complete: true, offset};
          return options.page ? options.page(page, index) : page;
        }
        if (scope === 'active' && index === options.refusePage) throw Error('fixture_read_past_oversized_record');
        const items = pages[index] ?? [];
        const page: HistoryPage = {snapshot: opened.snapshot, scope, cut, expiresAt: opened.expiresAt,
          items, complete: true, ...(scope === 'active' && command.before !== undefined ? {offset} : {}),
          ...(index + 1 < pages.length ? {nextCursor: `${scope}-${index + 1}`} : {})};
        return scope === 'active' && options.page ? options.page(page, index) : page;
      }
    }
  });
  return history;
}

test('an opening whose cut moves while a cold Session activates retries instead of failing the projection', async () => {
  const journal = await LiveJournal.open(fixture([], {staleOpen: true}));
  assert.equal(journal.failure, undefined);
  assert.equal(journal.opened.cut.contextId, 'context');
});

test('opening refuses an oversized active record before asking for more native pages', async () => {
  const pages = Array.from({length: 20}, (_, partIndex) => [{
    ...item(partIndex === 0 ? 'last' : `last:part:${partIndex}`, null, 'x'.repeat(32 * 1024)),
    entryId: 'last', partIndex, partCount: 20,
  }]);
  await assert.rejects(LiveJournal.open(fixture(pages, {refusePage: 17})), /live_event_bytes/);
});

for (const [label, text, refusePage] of [['escaped', '\u0000', 3], ['multibyte', '界', 6]] as const) {
  test(`opening limits ${label} record text before asking for more native pages`, async () => {
    const pages = Array.from({length: 20}, (_, partIndex) => [{
      ...item(partIndex === 0 ? 'last' : `last:part:${partIndex}`, null, text.repeat(32 * 1024)),
      entryId: 'last', partIndex, partCount: 20,
    }]);
    await assert.rejects(LiveJournal.open(fixture(pages, {refusePage})), /live_event_bytes/);
  });
}

test('opening counts paired surrogates once when parts split them near the event byte limit', async () => {
  const emojiCount = 40;
  const ascii = 'a'.repeat(512 * 1024 - 256 - 4 * emojiCount);
  const asciiParts = ascii.match(/.{1,32768}/g) ?? [];
  const splitPairs = Array.from({length: emojiCount}, () => ['\ud83d', '\ude42']).flat();
  const textParts = [...asciiParts, ...splitPairs];
  const pages = textParts.map((text, partIndex) => [{
    ...item(partIndex === 0 ? 'last' : `last:part:${partIndex}`, null, text),
    entryId: 'last', partIndex, partCount: textParts.length,
  }]);
  const journal = await LiveJournal.open(fixture(pages));
  assert.deepEqual((await journal.page({maxMessages: 1})).records[1]?.event.data, {
    id: 'last', role: 'user', source: {kind: 'user'}, content: [{type: 'text', text: ascii + '🙂'.repeat(emojiCount)}],
  });
});

test('opening rejects a page with a different Native revision under the same content revision', async () => {
  const history = fixture([[item('first', null, 'Older')], [item('last', 'first', 'Current')]], {
    page: (page, index) => index === 0 ? {...page, cut: {...page.cut, nativeRevision: 2}} : page,
  });
  await assert.rejects(LiveJournal.open(history), /live_open_cut_changed/);
});

test('opening rejects a disconnected active path before publishing a snapshot', async () => {
  const history = fixture([[item('first', null, 'Older')], [item('last', 'other-branch', 'Current')]]);
  await assert.rejects(LiveJournal.open(history), /live_open_active_path/);
});

test('opening rejects a changed record role between parts across native pages', async () => {
  const first = {...item('last', null, 'One'), entryId: 'last', partIndex: 0, partCount: 2};
  const second = {...first, id: 'last:part:1', partIndex: 1, role: 'assistant', text: 'Two'};
  await assert.rejects(LiveJournal.open(fixture([[first], [second]])), /live_open_parts/);
});

test('opening refuses a singleton with conflicting Native row and entry IDs', async () => {
  const conflicting = {...item('foreign', null, 'From another record'), entryId: 'last', partIndex: 0, partCount: 1};
  await assert.rejects(LiveJournal.open(fixture([[conflicting]])), /live_open_parts/);
});

test('opening refuses a continuation with another Native record’s part ID', async () => {
  const first = {...item('last', null, 'One'), entryId: 'last', partIndex: 0, partCount: 2};
  const second = {...first, id: 'foreign:part:1', partIndex: 1, text: 'Two'};
  await assert.rejects(LiveJournal.open(fixture([[first], [second]])), /live_open_parts/);
});

test('a streaming row requires the same Native prefix marker in its opening cut', async () => {
  const active = [[item('last', null, 'Current')]];
  await assert.rejects(LiveJournal.open(fixture(active, {live: [[prefixRow]]})), /live_prefix_identity_unavailable/);
  const wrong = {...prefixMarker, id: 'foreign-prefix'};
  await assert.rejects(LiveJournal.open(fixture(active, {prefix: wrong, live: [[prefixRow]]})),
    /live_prefix_identity_unavailable/);
  await assert.rejects(LiveJournal.open(fixture(active, {prefix: prefixMarker})), /live_prefix_identity_unavailable/);
});

test('opening refuses a Native live row without a phase', async () => {
  const {livePhase, ...row} = prefixRow;
  await assert.rejects(LiveJournal.open(fixture([[item('last', null, 'Current')]], {live: [[row]]})), /live_open_phase/);
});

test('multipart opening keeps older pages and the in-flight assistant settlement on one journal', async () => {
  const cut = initialCut;
  const user = {...item('first', null, 'Old \ud83d'), entryId: 'first', partIndex: 0, partCount: 2};
  const userTail = {...user, id: 'first:part:1', partIndex: 1, text: '\ude42 question'};
  const assistant = {...item('last', 'first', 'Earlier answer'), role: 'assistant', provider: 'provider', model: 'model'};
  const live = prefixLive;
  const journal = await LiveJournal.open(fixture([[user], [userTail, assistant]], {
    prefix: prefixMarker, live: [[prefixRow]],
  }));
  const opening = journal.snapshot();
  assert.deepEqual(opening.records.map(record => [record.event.seq, record.event.type]), [
    [0, 'turn/start'], [1, 'user/message'], [2, 'step/start'], [3, 'assistant/message'], [4, 'step/end'], [5, 'step/start'],
  ]);
  assert.deepEqual(opening.assistantStream?.activeAttempt?.stream, [
    {type: 'chunk', time: 0, chunk: {type: 'text-delta', index: 1, text: 'In flight'}},
  ]);
  const older = await journal.page({maxMessages: 1, throughSeq: 5, beforeSeq: 2});
  assert.deepEqual(older.records[1]?.event.data, {
    id: 'first', role: 'user', source: {kind: 'user'}, content: [{type: 'text', text: 'Old 🙂 question'}],
  });
  assert.equal(older.hasMore, false);

  const final = {...assistant, id: 'published', parentId: 'last', text: 'Final answer', live};
  journal.accept({cut: {...cut, leafId: final.id, nativeRevision: 2, observationSeq: 2}, after: 0, through: 2, hasMore: false,
    events: [
      {seq: 1, kind: 'native_append', item: final,
        source: {kind: 'append', revision: 2, contextRevision: 1, sessionId: cut.sessionId,
          leafId: final.id, entryId: final.id}},
      {seq: 2, kind: 'message_settlement', item: final, live,
        settlement: {status: 'observed', durability: 'not_attested', entryId: final.id}},
    ],
  });
  assert.deepEqual(await journal.page({maxMessages: 1, throughSeq: 5, beforeSeq: 2}), older);
  const latest = await journal.page({maxMessages: 1});
  assert.deepEqual(latest.records.map(record => [record.event.seq, record.event.type]), [
    [5, 'step/start'], [6, 'assistant/message'], [7, 'step/end'], [8, 'turn/end'],
  ]);
  assert.equal(latest.hasMore, true);
  assert.equal(journal.snapshot().assistantStream?.activeAttempt, undefined);
});

test('a worker settle waits for the final assistant settlement it must not overtake', async () => {
  const cut = {...initialCut};
  const journal = await LiveJournal.open(fixture([[item('last', null, 'Hello')]], {cut}));
  const live = {...prefixLive, messageId: 'assistant-1', branchLeafId: 'last'};
  const assistant: HistoryItem = {id: 'assistant-1', parentId: 'last', active: true, kind: 'message',
    role: 'assistant', provider: 'fixture-provider', model: 'fixture-model', text: 'partial',
    stopReason: 'aborted', live};
  journal.accept({cut, after: 0, through: 1, hasMore: false,
    events: [{seq: 1, kind: 'message_start', live, item: assistant}]});
  journal.settle();
  assert.deepEqual((await journal.page({maxMessages: 10})).records.map(record => record.event.type),
    ['turn/start', 'user/message', 'step/start']);
  journal.accept({cut: {...cut, leafId: 'assistant-1', observationSeq: 3}, after: 1, through: 3, hasMore: false,
    events: [
      {seq: 2, kind: 'native_append', live, item: assistant,
        source: {kind: 'append', revision: 2, contextRevision: 1, sessionId: cut.sessionId,
          leafId: 'assistant-1', entryId: 'assistant-1'}},
      {seq: 3, kind: 'message_settlement', live, item: assistant,
        settlement: {status: 'observed', durability: 'not_attested', entryId: 'assistant-1'}}]});
  const records = (await journal.page({maxMessages: 10})).records;
  assert.deepEqual(records.map(record => record.event.type),
    ['turn/start', 'user/message', 'step/start', 'assistant/message', 'step/end', 'turn/end']);
  assert.deepEqual(records.at(-1)?.event.data, {turn: 1,
    reason: {kind: 'aborted', reason: {kind: 'user'}}});
});

test('page byte limits keep chronological message groups separately addressable', async () => {
  const parts = (id: string, parentId: string | null) => Array.from({length: 13}, (_, partIndex) => ({
    ...item(partIndex === 0 ? id : `${id}:part:${partIndex}`, parentId, 'x'.repeat(32 * 1024)),
    entryId: id, partIndex, partCount: 13,
  }));
  const journal = await LiveJournal.open(fixture([parts('first', null), parts('last', 'first')]));
  const recent = await journal.page({maxMessages: 2});
  assert.deepEqual(recent.records.map(record => record.event.seq), [2, 3]);
  assert.equal(recent.hasMore, true);
  const older = await journal.page({maxMessages: 2, throughSeq: 3, beforeSeq: 2});
  assert.deepEqual(older.records.map(record => record.event.seq), [0, 1]);
  assert.equal(older.hasMore, false);
});

test('native bookkeeping keeps the generation and a matching setLeaf realigns the leaf', async () => {
  const first = item('first', null, 'Question'), last = item('last', 'first', 'Answer');
  const journal = await LiveJournal.open(fixture([[first], [last]]));
  const generation = journal.projection.generation;
  const source = (kind: string) => ({kind, revision: 2, contextRevision: 2,
    sessionId: initialCut.sessionId, leafId: 'last'});
  journal.accept({cut: initialCut, after: 0, through: 5, hasMore: false, events: [
    {seq: 1, kind: 'native_content_changed'},
    {seq: 2, kind: 'native_untracked_rewrite'},
    {seq: 3, kind: 'native_source_replaced', source: source('source_replaced')},
    {seq: 4, kind: 'native_source_binding', source: source('source_binding')},
    {seq: 5, kind: 'native_setLeaf', source: source('setLeaf')},
  ]});
  // Activation rewrites the Native header and re-points its leaf at the tip already served: that is
  // bookkeeping, so the projection the stock client is bound to survives and keeps paging.
  assert.equal(journal.failure, undefined);
  assert.equal(journal.projection.generation, generation);
  assert.equal(journal.after, 5);
  assert.ok((await journal.page({maxMessages: 1})).records.length > 0);
});

test('a branch change withdraws old pages and a fresh opening uses the same Native Session', async () => {
  const cut = {...initialCut, leafId: 'new-leaf', observationSeq: 1, nativeRevision: 2, contentRevision: 'content-v2'};
  const first = item('first', null, 'Shared ancestor');
  const old = await LiveJournal.open(fixture([[first], [item('last', 'first', 'Abandoned')]]));
  const oldCursor = old.cursor;
  assert.throws(() => old.accept({cut, after: 0, through: 1, hasMore: false,
    events: [{seq: 1, kind: 'native_setLeaf'}]}), /live_projection_invalidated/);
  await assert.rejects(old.page({throughSeq: oldCursor}), /live_projection_invalidated/);

  const current = await LiveJournal.open(fixture([[first], [item('new-leaf', 'first', 'Current')]], {cut}));
  assert.equal(current.sessionId, old.sessionId);
  assert.notEqual(current.generation, old.generation);
  assert.equal(old.projection.generation, old.generation);
  assert.notEqual(current.projection.generation, old.projection.generation);
  assert.deepEqual((await current.page({maxMessages: 1})).records[1]?.event.data, {
    id: 'new-leaf', role: 'user', source: {kind: 'user'}, content: [{type: 'text', text: 'Current'}],
  });
});

const assistant = (id: string, parentId: string | null, extra: Partial<HistoryItem> = {}): HistoryItem =>
  ({id, parentId, active: true, kind: 'message', role: 'assistant', text: '', provider: 'p', model: 'm', ...extra});

test('a retryable terminal failure exposes conversationContinuation at its turn/end seq', async () => {
  const journal = await LiveJournal.open(fixture([[item('u', null, 'go'),
    assistant('last', 'u', {stopReason: 'error', error: {reason: 'upstream', status: 503}})]]));
  const end = (await journal.page({maxMessages: 10})).records.find(record => record.event.type === 'turn/end');
  assert.equal(typeof end?.event.seq, 'number');
  assert.deepEqual(journal.snapshot().projections.values, {conversationContinuation: end!.event.seq});
});

for (const [label, extra] of [
  ['a completed turn', {text: 'done', stopReason: 'stop'}],
  ['an aborted turn', {stopReason: 'aborted'}],
  ['a nonretryable failure', {stopReason: 'error', error: {reason: 'bad request', status: 400}}],
] as const) {
  test(`${label} exposes no conversationContinuation`, async () => {
    const journal = await LiveJournal.open(fixture([[item('u', null, 'go'), assistant('last', 'u', extra)]]));
    assert.deepEqual(journal.snapshot().projections.values, {conversationContinuation: null});
  });
}

test('a retryable failure settled while its attempt is live commits the attempt and keeps Continue', async () => {
  const cut = {...initialCut, leafId: 'u'};
  const journal = await LiveJournal.open(fixture([[item('u', null, 'go')]], {cut}));
  const live = {...prefixLive, messageId: 'assistant-live', branchLeafId: 'u'};
  const failed: HistoryItem = {id: 'assistant-live', parentId: 'u', active: true, kind: 'message', role: 'assistant',
    provider: 'p', model: 'm', text: 'failed', stopReason: 'error', error: {reason: 'upstream', status: 503}, live};
  const frames: SessionFollowFrame[] = [];
  journal.subscribe(frame => frames.push(frame));
  journal.accept({cut, after: 0, through: 1, hasMore: false,
    events: [{seq: 1, kind: 'message_start', live, item: {...failed, active: false, text: '', livePhase: 'streaming'}}]});
  journal.accept({cut: {...cut, leafId: 'assistant-live', nativeRevision: 2, observationSeq: 3},
    after: 1, through: 3, hasMore: false, events: [
      {seq: 2, kind: 'native_append', live, item: failed,
        source: {kind: 'append', revision: 2, contextRevision: 1, sessionId: cut.sessionId,
          leafId: 'assistant-live', entryId: 'assistant-live'}},
      {seq: 3, kind: 'message_settlement', live, item: {...failed, active: false},
        settlement: {status: 'observed', durability: 'not_attested', entryId: 'assistant-live'}}]});
  const records = (await journal.page({maxMessages: 10})).records;
  assert.deepEqual(records.map(record => record.event.type),
    ['turn/start', 'user/message', 'step/start', 'assistant/attempt', 'step/end', 'turn/end']);
  const attempt = records.find(record => record.event.type === 'assistant/attempt');
  assert.equal(attempt?.event.ignorable, true);
  const end = records.at(-1)!;
  assert.deepEqual(end.event.data, {turn: 1,
    reason: {kind: 'error', error: {message: 'upstream', code: 'SERVER', status: 503}}});
  assert.deepEqual(journal.snapshot().projections.values, {conversationContinuation: end.event.seq});
  const streamEnd = frames.flatMap(frame =>
    frame.type === 'assistant-stream' && frame.frame.type === 'end' ? [frame.frame] : []).at(-1);
  assert.deepEqual(streamEnd?.outcome, {kind: 'committed', eventType: 'assistant/attempt', seq: attempt!.event.seq});
});

test('an inactive failed settlement still publishes the attempt and closes the turn once', async () => {
  const cut = {...initialCut, leafId: 'u'};
  const journal = await LiveJournal.open(fixture([[item('u', null, 'go')]], {cut}));
  const live = {...prefixLive, messageId: 'assistant-inactive', branchLeafId: 'u'};
  const failed: HistoryItem = {id: 'assistant-inactive', parentId: 'u', active: false, kind: 'message',
    role: 'assistant', provider: 'p', model: 'm', text: 'partial', stopReason: 'error',
    error: {reason: 'upstream', status: 503}, live};
  journal.accept({cut, after: 0, through: 2, hasMore: false, events: [
    {seq: 1, kind: 'message_start', live, item: {...failed, text: '', livePhase: 'streaming'}},
    {seq: 2, kind: 'message_update', live, item: failed}]});
  journal.accept({cut: {...cut, leafId: 'assistant-inactive', nativeRevision: 2, observationSeq: 5},
    after: 2, through: 5, hasMore: false, events: [
      {seq: 3, kind: 'native_append', live, item: failed,
        source: {kind: 'append', revision: 2, contextRevision: 1, sessionId: cut.sessionId,
          leafId: 'assistant-inactive', entryId: 'assistant-inactive'}},
      {seq: 4, kind: 'message_settlement', live, item: failed,
        settlement: {status: 'observed', durability: 'not_attested', entryId: 'assistant-inactive'}},
      {seq: 5, kind: 'turn_end'}]});
  const cursor = journal.cursor;
  const records = (await journal.page({maxMessages: 10})).records;
  assert.deepEqual(records.map(record => record.event.type),
    ['turn/start', 'user/message', 'step/start', 'assistant/attempt', 'step/end', 'turn/end']);
  const attempt = records.find(record => record.event.type === 'assistant/attempt');
  assert.deepEqual(attempt?.event.data, {turn: 1, step: 1,
    stream: [{type: 'chunk', time: 0, chunk: {type: 'text-delta', index: 1, text: 'partial'}}]});
  const end = records.at(-1)!;
  assert.deepEqual(end.event.data, {turn: 1,
    reason: {kind: 'error', error: {message: 'upstream', code: 'SERVER', status: 503}}});
  assert.deepEqual(journal.snapshot().projections.values, {conversationContinuation: end.event.seq});
  journal.settle();
  assert.equal(journal.cursor, cursor);
  assert.deepEqual((await journal.page({maxMessages: 10})).records.map(record => record.event.seq),
    records.map(record => record.event.seq));
});
