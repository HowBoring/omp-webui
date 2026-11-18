import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { HOME: profile, PI_CODING_AGENT_DIR: agent, OMP_ACTIVE_HISTORY_SOURCE: source } = process.env;
const guard = globalThis[Symbol.for('omp.s0.network-guard')];
assert.ok(profile && profile === agent && /^\/tmp\/omp-active-history-[A-Za-z0-9_]+$/.test(profile));
assert.ok(source && guard && process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH === '0'
  && process.env.NODE_DISABLE_COMPILE_CACHE === '1');
assert.equal(guard.denied(), 0);
assert.equal(guard.dispatched(), 0);

const historyPath = join(source, 'packages/coding-agent/src/modes/rpc/rpc-history.ts');
const managerPath = join(source, 'packages/coding-agent/src/session/session-manager.ts');
const wirePath = join(source, 'packages/coding-agent/src/modes/rpc/wire/history.ts');
const overlay = process.env.OMP_ACTIVE_HISTORY_OVERLAY;
const loaded = new Set();
if (overlay) {
  const sources = new Map([historyPath, wirePath].map(path => [path, join(overlay, path.slice(source.length + 1))]));
  Bun.plugin({
    name: 'exact-active-history-fixture-source',
    setup(build) {
      for (const [path, replacement] of sources) {
        const filter = new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
        build.onLoad({ filter }, (args) => {
          assert.equal(args.path, path);
          loaded.add(path);
          return { contents: readFileSync(replacement, 'utf8'), loader: 'ts' };
        });
      }
    },
  });
}
const { SessionManager } = await import(managerPath);
const { RpcHistoryObservation } = await import(historyPath);
if (overlay) assert.ok(loaded.has(historyPath));

const manager = SessionManager.inMemory(profile);
const rootId = manager.appendMessage({ role: 'user', content: 'retained first', timestamp: 1 });
const abandonedId = manager.appendMessage({ role: 'user', content: 'abandoned sibling', timestamp: 2 });
manager.branch(rootId);
const leafId = manager.appendMessage({ role: 'user', content: 'current leaf', timestamp: 3 });
const history = new RpcHistoryObservation(manager, () => ({ messages: [], streaming: false, compacting: false }));
const index = history.openActiveIndex();
assert.equal(index.count, 2);
assert.equal(index.cut.leafId, leafId);
const binding = { snapshot: index.snapshot, contentRevision: index.cut.contentRevision };
const metadata = history.activeIndexPage(binding, 0);
assert.deepEqual(metadata.cut, index.cut);
assert.deepEqual(metadata.items.map(({ordinal, entryId, parentId}) => [ordinal, entryId, parentId]), [
  [0, rootId, null], [1, leafId, rootId],
]);
assert.ok(!JSON.stringify(metadata).includes('retained first'));
assert.ok(!JSON.stringify(metadata).includes('current leaf'));
const {ordinal, entryId, digest} = metadata.items[0];
assert.match(digest, /^[0-9a-f]{64}$/);
const page = history.activePayloadRange(binding, [{ordinal, entryId, digest}], 0);
assert.deepEqual(page.cut, index.cut);
assert.deepEqual(page.items.map(({id, text, partIndex, partCount}) => [id, text, partIndex, partCount]), [
  [rootId, 'retained first', 0, 1],
]);
assert.equal(page.next, undefined);
const appendId = manager.appendMessage({ role: 'user', content: 'new append', timestamp: 4 });
assert.notEqual(appendId, index.cut.leafId);
assert.deepEqual(history.activePayloadRange(binding, [{ordinal, entryId, digest}], 0), page);
assert.deepEqual(history.activeIndexPage(binding, 0), metadata);
manager.appendMessageToBranch({ role: 'user', content: 'background append', timestamp: 5 }, abandonedId);
assert.deepEqual(history.activePayloadRange(binding, [{ordinal, entryId, digest}], 0), page);
assert.throws(() => history.activePayloadRange(binding, [{ordinal, entryId, digest: '0'.repeat(64)}], 0),
  { message: 'history_active_entry_key' });
assert.throws(() => history.activeIndexPage({...binding, contentRevision: '0'.repeat(64)}, 0),
  { message: 'history_active_stale_revision' });
manager.getEntry(leafId).message.content = 'rewritten between the requested row and the append';
assert.throws(() => history.activePayloadRange(binding, [{ordinal, entryId, digest}], 0),
  { message: 'history_handoff_changed' });
assert.equal(history.closeActiveIndex(binding).closed, true);
assert.throws(() => history.activeIndexPage(binding, 0), { message: 'history_active_stale_index' });

const canonicalManager = SessionManager.inMemory(profile);
const canonicalId = canonicalManager.appendMessage({ role: 'user', content: 'unserialized property', timestamp: 1 });
canonicalManager.getEntry(canonicalId).message.toJSON = () => ({ role: 'assistant', provider: 'fixture',
  model: 'verified', content: [{ type: 'text', text: 'canonical source payload' }], timestamp: 1 });
const canonical = new RpcHistoryObservation(canonicalManager,
  () => ({ messages: [], streaming: false, compacting: false }));
const canonicalIndex = canonical.openActiveIndex();
const canonicalBinding = { snapshot: canonicalIndex.snapshot, contentRevision: canonicalIndex.cut.contentRevision };
const [canonicalMetadata] = canonical.activeIndexPage(canonicalBinding, 0).items;
assert.equal(canonicalMetadata.role, 'assistant');
const canonicalKey = { ordinal: 0, entryId: canonicalId, digest: canonicalMetadata.digest };
assert.equal(canonical.activePayloadRange(canonicalBinding, [canonicalKey], 0).items[0].text,
  'canonical source payload');
assert.equal(canonical.closeActiveIndex(canonicalBinding).closed, true);

const graphManager = SessionManager.inMemory(profile);
const graphRoot = graphManager.appendMessage({ role: 'user', content: 'graph root', timestamp: 1 });
const graphSibling = graphManager.appendMessage({ role: 'user', content: 'off branch', timestamp: 2 });
graphManager.branch(graphRoot);
const graphLeaf = graphManager.appendMessage({ role: 'user', content: 'on branch', timestamp: 3 });
const offBranchEntry = graphManager.getEntry(graphSibling);
const originalOffBranch = { ...offBranchEntry };
const graph = new RpcHistoryObservation(graphManager, () => ({ messages: [], streaming: false, compacting: false }));
for (const [change, message] of [
  [{ id: graphLeaf }, 'history_duplicate_entry'],
  [{ parentId: 'missing' }, 'history_missing_parent'],
  [{ parentId: 'x'.repeat(257) }, 'history_missing_parent'],
  [{ parentId: graphSibling }, 'history_parent_cycle'],
  [{ type: 'unknown_native_category' }, 'history_unknown_entry'],
]) {
  offBranchEntry.toJSON = () => ({ ...originalOffBranch, ...change });
  assert.throws(() => graph.open('tree'), { message });
  assert.throws(() => graph.openActiveIndex(), { message });
}
offBranchEntry.toJSON = () => originalOffBranch;
const relocatedEntry = graphManager.getEntry(graphLeaf);
const originalRelocated = { ...relocatedEntry };
relocatedEntry.toJSON = () => ({ ...originalRelocated, parentId: graphSibling });
const graphIndex = graph.openActiveIndex();
const graphBinding = { snapshot: graphIndex.snapshot, contentRevision: graphIndex.cut.contentRevision };
const graphRows = graph.activeIndexPage(graphBinding, 0).items;
assert.deepEqual(graphRows.map(({entryId, parentId}) => [entryId, parentId]), [
  [graphRoot, null], [graphSibling, graphRoot], [graphLeaf, graphSibling],
]);
const graphKeys = graphRows.map(({ordinal, entryId, digest}) => ({ ordinal, entryId, digest }));
const graphPayload = graph.activePayloadRange(graphBinding, graphKeys, 0);
assert.deepEqual(graphPayload.items.map(({id, parentId}) => [id, parentId]), [
  [graphRoot, null], [graphSibling, graphRoot], [graphLeaf, graphSibling],
]);
assert.equal(graph.closeActiveIndex(graphBinding).closed, true);

const rolesManager = SessionManager.inMemory(profile);
const longStop = 'fixture-native-stop-'.repeat(19);
for (const message of [
  { role: 'user', content: 'user text', stopReason: longStop, timestamp: 1 },
  { role: 'toolResult', content: 'tool text', stopReason: 'tool-stop', timestamp: 2 },
  { role: 'custom', display: true, content: 'visible', stopReason: 'custom-stop', timestamp: 3 },
  { role: 'hookMessage', display: false, content: 'hidden', stopReason: 'hidden-stop', timestamp: 4 },
  { role: 'developer', content: 'developer text', stopReason: 'developer-stop', timestamp: 5 },
]) rolesManager.appendMessage(message);
const roles = new RpcHistoryObservation(rolesManager, () => ({ messages: [], streaming: false, compacting: false }));
const rolesIndex = roles.openActiveIndex();
const rolesBinding = { snapshot: rolesIndex.snapshot, contentRevision: rolesIndex.cut.contentRevision };
const rolesMetadata = roles.activeIndexPage(rolesBinding, 0).items;
const rolesEagerIndex = roles.open('active');
const rolesEager = roles.page(rolesEagerIndex.cursor).items;
const projectionFields = ({role, provider, model, stopReason}) => ({ role, provider, model, stopReason });
assert.deepEqual(rolesEager.map(({stopReason}) => stopReason), [longStop, 'tool-stop', 'custom-stop', undefined, undefined]);
assert.deepEqual(rolesMetadata.map(projectionFields), rolesEager.map(projectionFields));
assert.equal(roles.close(rolesEagerIndex.snapshot).closed, true);
assert.equal(roles.closeActiveIndex(rolesBinding).closed, true);

const multipartManager = SessionManager.inMemory(profile);
const wholeText = 'escaped 😀\\\n"'.repeat(110000);
const imageBytes = Buffer.alloc(300_001, 91);
const multipartId = multipartManager.appendMessage({ role: 'user', timestamp: 1, content: [
  { type: 'text', text: wholeText }, { type: 'image', mimeType: 'image/png', data: imageBytes.toString('base64') },
] });
const multipart = new RpcHistoryObservation(multipartManager, () => ({ messages: [], streaming: false, compacting: false }));
const multiIndex = multipart.openActiveIndex();
const multiBinding = { snapshot: multiIndex.snapshot, contentRevision: multiIndex.cut.contentRevision };
const [{ ordinal: multiOrdinal, entryId: multiEntryId, digest: multiDigest }] = multipart.activeIndexPage(multiBinding, 0).items;
const multiKey = { ordinal: multiOrdinal, entryId: multiEntryId, digest: multiDigest };
const firstPartPage = multipart.activePayloadRange(multiBinding, [multiKey], 0);
assert.ok(firstPartPage.next && firstPartPage.next.ordinal === 0);
const content = firstPartPage.items[0].contents[0];
assert.equal(content.originalAssociation, 'unproven');
assert.equal(content.bytes, imageBytes.length);
const eager = multipart.open('active', 'live');
const eagerPage = multipart.page(eager.cursor);
const withoutCursor = ({contents, ...item}) => ({ ...item,
  contents: contents?.map(({cursor: _cursor, ...metadata}) => metadata) });
assert.deepEqual(firstPartPage.items.map(withoutCursor), eagerPage.items.map(withoutCursor));
assert.throws(() => multipart.openActiveIndex(), { message: 'history_cache_full' });
assert.equal(multipart.close(eager.snapshot).closed, true);
const parts = [];
let next = { ordinal: 0, partIndex: 0 };
while (next) {
  const found = multipart.activePayloadRange(multiBinding, [multiKey], next.partIndex);
  assert.deepEqual(found.cut, multiIndex.cut);
  assert.ok(Buffer.byteLength(JSON.stringify(found)) <= 768 * 1024);
  for (const item of found.items) {
    assert.equal(item.entryId, multipartId);
    assert.equal(item.partIndex, parts.length);
    assert.equal(item.id, parts.length === 0 ? multipartId : `${multipartId}:part:${parts.length}`);
    assert.deepEqual(item.contents, [content]);
    parts.push(item.text);
  }
  next = found.next;
}
assert.equal(parts.join(''), `${wholeText}\n[Retained native image available; original association unproven]`);
const encoded = [];
let cursor = content.cursor;
while (cursor) {
  const found = multipart.contentPage(cursor);
  assert.deepEqual(found.cut, multiIndex.cut);
  assert.deepEqual(found.content, content);
  assert.equal(found.partIndex, encoded.length);
  encoded.push(found.data);
  cursor = found.nextCursor;
}
assert.deepEqual(Buffer.from(encoded.join(''), 'base64'), imageBytes);
const forged = content.cursor.slice(0, -1) + (content.cursor.endsWith('0') ? '1' : '0');
assert.throws(() => multipart.contentPage(forged), { message: 'history_stale_content_cursor' });
assert.equal(multipart.closeActiveIndex(multiBinding).closed, true);
assert.throws(() => multipart.contentPage(content.cursor), { message: 'history_stale_content_cursor' });

const wire = new RpcHistoryObservation(multipartManager, () => ({ messages: [], streaming: false, compacting: false }));
const roundTrip = (command) => JSON.parse(JSON.stringify(wire.activeCommand(JSON.parse(JSON.stringify(command)))));
const opened = roundTrip({ id: 'open', type: 'history_active_index_open' });
assert.ok(opened.success);
assert.equal(opened.id, 'open');
assert.equal(opened.command, 'history_active_index_open');
const wireBinding = { snapshot: opened.data.snapshot, contentRevision: opened.data.cut.contentRevision };
const indexed = roundTrip({ id: 'index', type: 'history_active_index_page', binding: wireBinding, start: 0 });
assert.ok(indexed.success);
const { ordinal: wireOrdinal, entryId: wireEntryId, digest: wireDigest } = indexed.data.items[0];
const request = { id: 'range', type: 'history_active_payload_range', binding: wireBinding, startPart: 1,
  entries: [{ ordinal: wireOrdinal, entryId: wireEntryId, digest: wireDigest }] };
const sought = roundTrip(request);
assert.ok(sought.success);
assert.equal(sought.data.items[0].partIndex, 1);
assert.deepEqual(sought.data.cut, opened.data.cut);
assert.notEqual(wireDigest, multiDigest);
const invalid = roundTrip({ ...request, entries: [{ ...request.entries[0], path: '/fixture/transcript' }] });
assert.deepEqual(invalid, { id: 'range', type: 'response', command: request.type, success: false,
  error: 'history_active_command_schema', code: 'history_active_command_schema' });
const foreign = roundTrip({ ...request, binding: multiBinding });
assert.equal(foreign.code, 'history_active_stale_index');
const repeated = roundTrip({ ...request, entries: [request.entries[0], request.entries[0]] });
assert.equal(repeated.code, 'history_active_entry_key');
assert.ok(roundTrip({ id: 'close', type: 'history_active_index_close', binding: wireBinding }).data.closed);

const lost = wire.openActiveIndex();
const lostBinding = { snapshot: lost.snapshot, contentRevision: lost.cut.contentRevision };
for (let i = 0; i < 4097; i++) wire.observe({ type: 'fixture_observation' });
assert.throws(() => wire.activeIndexPage(lostBinding, 0), { message: 'history_observation_gap' });
assert.equal(wire.closeActiveIndex(lostBinding).closed, true);
const expiring = wire.openActiveIndex();
const expiringBinding = { snapshot: expiring.snapshot, contentRevision: expiring.cut.contentRevision };
const realNow = Date.now;
try {
  Date.now = () => expiring.expiresAt;
  assert.throws(() => wire.activeIndexPage(expiringBinding, 0), { message: 'history_active_stale_index' });
} finally {
  Date.now = realNow;
}

const { buildRpcWireBundle } = await import(join(source, 'packages/coding-agent/src/modes/rpc/wire/index.ts'));
if (overlay) assert.ok(loaded.has(wirePath));
const bundle = buildRpcWireBundle();
for (const [name, result] of [
  ['history_active_index_open', 'HistoryActiveOpen'], ['history_active_index_page', 'HistoryActiveIndexPage'],
  ['history_active_payload_range', 'HistoryActivePayloadRange'], ['history_active_index_close', 'HistoryActiveIndexCloseResult'],
]) {
  assert.equal(bundle['x-rpc'].commands.find(command => command.name === name)?.result, result);
  assert.ok(bundle.$defs[result]);
}

if (process.env.OMP_ACTIVE_HISTORY_VOLUME === '1') {
  const volume = SessionManager.inMemory(profile);
  const suffix = 'x'.repeat(10_486);
  const input = createHash('sha256');
  let serializedBytes = 0;
  const itemCount = 10_000;
  for (let ordinal = 0; ordinal < itemCount; ordinal++) {
    const content = `${String(ordinal).padStart(5, '0')}:${suffix}`;
    input.update(content + '\n');
    const id = volume.appendMessage({ role: 'user', content, timestamp: ordinal });
    serializedBytes += Buffer.byteLength(JSON.stringify(volume.getEntry(id)) + '\n');
  }
  const inputSha256 = input.digest('hex');
  assert.equal(inputSha256, 'c24c9eab9b33d8e6863898e74091f856e6b7a0f332db0c960f399f934730d49f');
  assert.ok(serializedBytes >= 100 * 1024 * 1024);
  const reader = new RpcHistoryObservation(volume, () => ({ messages: [], streaming: false, compacting: false }));
  const started = performance.now();
  const opened = reader.openActiveIndex();
  assert.equal(opened.count, itemCount);
  assert.ok(opened.indexBytes <= 8 * 1024 * 1024);
  const openMs = Math.round(performance.now() - started);
  const binding = { snapshot: opened.snapshot, contentRevision: opened.cut.contentRevision };
  const keyOf = ({ordinal, entryId, digest}) => ({ordinal, entryId, digest});
  const metadata = [];
  let indexPages = 0;
  let nextOrdinal = 0;
  do {
    const page = reader.activeIndexPage(binding, nextOrdinal);
    assert.deepEqual(page.cut, opened.cut);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 768 * 1024);
    metadata.push(...page.items);
    nextOrdinal = page.nextOrdinal;
    indexPages++;
  } while (nextOrdinal !== undefined);
  const indexMs = Math.round(performance.now() - started);
  assert.equal(metadata.length, itemCount);
  for (const [ordinal, item] of metadata.entries()) {
    assert.equal(item.ordinal, ordinal);
    assert.equal(item.parentId, metadata[ordinal - 1]?.entryId ?? null);
  }
  const recentStarted = performance.now();
  const recent = reader.activePayloadRange(binding, metadata.slice(-1).map(keyOf), 0);
  const recentMs = Math.round(performance.now() - recentStarted);
  assert.equal(recent.items[0].text, `09999:${suffix}`);
  const oldStarted = performance.now();
  const old = reader.activePayloadRange(binding, metadata.slice(0, 1).map(keyOf), 0);
  const oldMs = Math.round(performance.now() - oldStarted);
  assert.equal(old.items[0].text, `00000:${suffix}`);
  let offset = 0, payloadPages = 0, maxPayloadPageBytes = 0;
  while (offset < itemCount) {
    const keys = metadata.slice(offset, offset + 128).map(keyOf);
    const page = reader.activePayloadRange(binding, keys, 0);
    assert.deepEqual(page.cut, opened.cut);
    const bytes = Buffer.byteLength(JSON.stringify(page));
    assert.ok(bytes <= 768 * 1024 && page.items.length > 0);
    maxPayloadPageBytes = Math.max(maxPayloadPageBytes, bytes);
    for (const row of page.items) {
      assert.equal(row.entryId, metadata[offset].entryId);
      assert.equal(row.text, `${String(offset).padStart(5, '0')}:${suffix}`);
      offset++;
    }
    if (page.next) assert.deepEqual(page.next, { ordinal: offset, partIndex: 0 });
    payloadPages++;
  }
  assert.equal(reader.closeActiveIndex(binding).closed, true);
  console.log(JSON.stringify({ itemCount, serializedBytes, inputSha256, openMs, indexMs, indexPages,
    indexBytes: opened.indexBytes, recentMs, oldMs, payloadPages, maxPayloadPageBytes,
    elapsedMs: Math.round(performance.now() - started) }));
}
assert.equal(guard.denied(), 0);
assert.equal(guard.dispatched(), 0);
console.log('verified metadata and exact earlier payload with the guarded Native reader');
