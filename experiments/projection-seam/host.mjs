/** Isolated boot probe, not an application Host. Run against a built pinned upstream checkout. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { globSync, readFileSync } from 'node:fs';
import { resolve, dirname, extname, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { parseProjectionBinding } from '@deepseek-ai/dsh-api-session-controller/projection';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access';
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway';
import { Peer } from '@deepseek-ai/dsh-client-connection';
import { interactionsHostContribution } from '../../packages/contracts/interactions.ts';
import { ProjectionNativeInteractions } from './native-service.ts';
import { verifyDshSource } from '../../scripts/dsh-source.ts';

const [upstreamArg, evidenceArg] = process.argv.slice(2);
if (!upstreamArg || !evidenceArg) throw new Error('usage: node host.mjs UPSTREAM EVIDENCE_DIR');
const upstream = resolve(upstreamArg);
const evidence = resolve(evidenceArg);
const sourceIdentity = await verifyDshSource(upstream, 'candidate');
await writeFile(resolve(evidence, 'source.json'), JSON.stringify(sourceIdentity, null, 2) + '\n');
const native = process.env.OMP_PROJECTION_NATIVE === '1' ? await (await import('./native.ts')).openNativeProjection() : undefined;
const SESSION = native?.info().sessionId ?? 'fixture-existing';
const SOURCE = native?.binding().source ?? 'verified-synthetic-source-session';
const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../vendor/projection-fixture');
await writeFile(resolve(evidence, 'fixture-build.json'), await readFile(resolve(fixtureRoot, 'manifest.json')));
const { SESSION_FORMAT_VERSION } = await import(pathToFileURL(resolve(upstream, 'packages/core/session/lib/types/types.js')).href);
const fileImport = (path) => import(pathToFileURL(resolve(upstream, path)).href);
const moduleRequire = createRequire(resolve(upstream, 'packages/client/modules/package.json'));
const { Context } = await import(pathToFileURL(moduleRequire.resolve('@deepseek-ai/cordis')).href);
const { ClientModuleRegistry, bootInjections } = await fileImport('packages/client/modules/lib/index.js');
const { renderIndexInjections } = await fileImport('packages/host/webserver/lib/index.js');
const { parseRemoteStreamClientMessage } = await fileImport('packages/api/gateway/lib/types/stream-protocol.js');
const appRequire = createRequire(resolve(upstream, 'apps/web/package.json'));
const { WebSocketServer } = appRequire('ws');
const manifests = new Map([...globSync('packages/*/*/package.json', { cwd: upstream })].map((path) => {
  const manifest = JSON.parse(readFileSync(resolve(upstream, path), 'utf8'));
  return [manifest.name, { manifest, dir: dirname(resolve(upstream, path)) }];
}));
for (const name of ['navigation', 'controls']) {
  const dir = resolve(fixtureRoot, name);
  const manifest = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'));
  manifests.set(manifest.name, { manifest, dir, fixture: true });
}
const seeds = [
  'client-modules', 'api-session-controller', 'client-ui-renderer', 'client-ui-layout',
  'client-ui-session', 'client-ui-chat', 'client-ui-sidebar', 'client-ui-tool',
  'client-ui-approval', 'client-ui-user-questions', 'client-ui-attachment',
].map((name) => `@deepseek-ai/dsh-${name}`);
const selected = new Set();
function include(name) {
  if (selected.has(name)) return;
  const entry = manifests.get(name);
  if (!entry?.manifest.dsh?.client) throw new Error(`not a declared client plugin: ${name}`);
  selected.add(name);
  for (const dep of entry.manifest.dsh.client.inject ?? []) include(dep);
}
seeds.forEach(include);
include('@omp-webui/projection-navigation');
include('@omp-webui/projection-fixture');
const ctx = new Context();
// Supply metadata rows only. No DSH Host plugins or runtime are mounted.
ctx.provide('loader', {
  *entries() {
    for (const name of selected) yield {
      options: { name: manifests.get(name).fixture ? resolve(manifests.get(name).dir, 'index.js') : name }, fiber: {}, disabled: false,
      parent: { tree: { ctx: { baseUrl: pathToFileURL(manifests.get(name).dir + sep).href } } },
    };
  },
});
await ctx.plugin(ClientModuleRegistry);
const registry = ctx.get('clientModules');
const graph = registry.graph();
// Public boot Config is validated by each Client plugin through the real Cordis Loader.
const configs = {
  '@deepseek-ai/dsh-client-ui-conversation': { draftPersistence: 'provider' },
  '@deepseek-ai/dsh-api-session-controller': { disabledActions: ['create', 'rename', 'fork', 'queue'], allowPromptWhileRunning: false, projectionRebuild: true },
  '@deepseek-ai/dsh-api-workspace-controller': { disabledSessionActions: ['archive', 'pin'] },
  '@deepseek-ai/dsh-client-ui-workspace': { navigationMode: 'external' },
};
for (const entry of graph.entries) if (configs[entry.id]) entry.config = configs[entry.id];
graph.rev = createHash('sha256').update(JSON.stringify(graph)).digest('hex');
await writeFile(resolve(evidence, 'graph.json'), JSON.stringify(graph, null, 2) + '\n');
const rawHtml = await readFile(resolve(upstream, 'apps/web/dist/index.html'), 'utf8');
const rows = [
  ...bootInjections(graph),
  { kind: 'global', name: '__DSH_REMOTE_ACCESS__', value: { type: 'baseline', owner: true } },
];
const html = renderIndexInjections(rawHtml, rows);
const llmRequire = createRequire(resolve(upstream, 'packages/api/session-controller/package.json'));
const { createUserMessage } = await import(pathToFileURL(llmRequire.resolve('@deepseek-ai/dsh-llm')).href);
const fixtureHistory = [{ type: 'event', event: { seq: 0, time: 1700000000000, type: 'user/message',
  surfaceOp: 'append', data: createUserMessage({ content: [{ type: 'text', text: 'Synthetic fixture history' }],
    source: { kind: 'user' } }) } }];
const workspace = { workspaceId: 'fixture-ws', path: '/fixture/project', title: 'Fixture project',
  sessionIds: [SESSION, 'fixture-second'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
let running = false;
let projectionIndex = 1;
const projection = () => native?.binding() ?? parseProjectionBinding({ source: SOURCE, generation: `projection-${projectionIndex}` });
let branchText = 'OFF BRANCH ORIGINAL';
let failBaseline = false;
let holdBaseline = false;
let holdPage = false;
const baselineWaiters = [];
const pageWaiters = [];
const controls = new Map();
const follows = new Map();
const streamSubscriptions = new Map();
let interaction;
let eventSink;
let gatewayRpc;
ctx.provide('connection', { rpc: { intercept(_channel, _matches, handler) { gatewayRpc = handler; return () => { gatewayRpc = undefined; }; } } });
await ctx.plugin(TypertRegistry);
await ctx.plugin(RemoteAccessService);
await ctx.plugin(TypertGatewayService, {});
if (native) { ctx.typert.register(interactionsHostContribution); new ProjectionNativeInteractions(ctx, native.bridge); }
const remoteEventSource = signal => {
  const queue = []; let wake;
  eventSink = value => { if (queue.length >= 8) throw new Error('fixture event budget'); queue.push(value); wake?.(); };
  return (async function* () {
    const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
    try { while (!signal.aborted) { if (queue.length) yield queue.shift(); else await new Promise(resolve => { wake = resolve; }); } }
    finally { signal.removeEventListener('abort', abort); }
  })();
};
const unregisterEvents = ctx.typertGateway.registerRemoteEvents(remoteEventSource, { home: '/synthetic-projection-only' });
const owner = new Peer(ctx, { principal: { kind: 'owner' } });
function startInteraction() {
  if (interaction?.phase === 'pending') return;
  const signal = new AbortController();
  const deadline = Date.now() + 120000;
  interaction = { phase: 'pending', deadline };
  const timer = setTimeout(() => { interaction.phase = 'expired'; signal.abort(); }, deadline - Date.now());
  const subject = { id: SESSION };
  eventSink({ event: 'approval/request', request: { agent: subject, toolName: 'synthetic projection fixture', reason: 'Keep this pending across projection rebuild', signal: signal.signal },
    context: { value: ctx, subject, agentId: SESSION },
    resolve(outcome) { clearTimeout(timer); interaction.phase = 'answered'; interaction.outcome = outcome; },
    reject(error) { clearTimeout(timer); interaction.phase = 'cancelled'; interaction.error = String(error); },
  });
}
function opening(id) {
  const identity = projection();
  if (native) { const snapshot = native.journal.snapshot(); return { ...snapshot, projection: identity, projections: { ...snapshot.projections, projection: identity } }; }
  const start = projectionIndex === 1 ? 5 : 0;
  const records = [
    { type: 'event', event: { type: 'turn/start', seq: start, time: 1700000000000, data: { turn: 0 } } },
    { type: 'event', event: { ...fixtureHistory[0].event, seq: start + 1,
      data: { ...fixtureHistory[0].event.data, content: [{ type: 'text', text: branchText }] } } },
  ];
  return { type: 'snapshot', projection: identity,
    header: { version: SESSION_FORMAT_VERSION, id, createdAt: 1767225600000, isSeeded: false },
    cursor: start + 1, records, hasMore: projectionIndex === 1,
    projections: { projection: identity, asOfSeq: start + 1, values: { title: branchText } }, assistantStream: { revision: 0 } };
}
function controlSend(value) {
  for (const [socket, streams] of controls) for (const streamId of streams) if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'item', streamId, value }));
}
function invalidate(text = 'NEW BRANCH ORIGINAL') {
  const retired = projection(); projectionIndex++; branchText = text;
  controlSend({ type: 'projection-invalidated', sessionId: SESSION, projection: projection() });
  return retired;
}
native?.subscribe(() => controlSend({ type: 'projection-invalidated', sessionId: SESSION, projection: projection() }));
let creates = 0;
const sessionRows = () => [{ sessionId: SESSION, updatedAt: 1767225600000, running, blank: false,
  cwd: workspace.path, agentAvailable: true }, { sessionId: 'fixture-second', updatedAt: 1767225600000,
  running: false, blank: false, cwd: workspace.path, agentAvailable: true }, ...Array.from({ length: creates }, (_, i) => ({
    sessionId: `fixture-created-${i + 1}`, updatedAt: 1767225600001 + i, running: false, blank: true,
    cwd: workspace.path, agentAvailable: true }))];
const channels = new Map();
const requests = [];
const frames = [];
const uploads = [];
const served = new Map();
let receiptCounter = 0;
let promptMode = 'accept';
let submissionOutcome = 'unknown';
const pendingPrompts = [];
function record(items, value, maximum) { if (items.length >= maximum) throw new Error('Fixture evidence budget exceeded'); items.push(value); }
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html',
  '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
function json(response, value, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const expectedOrigin = `http://127.0.0.1:${server.address().port}`;
  if (request.headers.host !== new URL(expectedOrigin).host
    || (request.headers.origin && request.headers.origin !== expectedOrigin)
    || ['cross-site', 'same-site'].includes(request.headers['sec-fetch-site'])) return json(response, { error: 'Forbidden fixture origin' }, 403);
  try {
    if (url.pathname === '/fixture/info') return json(response, {sessionId: SESSION, source: SOURCE, native: native ? {...native.info(), state: await native.port.state()} : null});
    if (url.pathname === '/fixture/native-action' && native) {
      const op = url.searchParams.get('op');
      if (op === 'ask') await native.port.prompt('ASK_FOR_PROJECTION_PROOF');
      else if (op === 'model') await native.port.model();
      else if (op === 'model-first') await native.port.model('first');
      else if (op === 'hold-history') native.port.holdHistory();
      else if (op === 'release-history') native.port.releaseHistory();
      else if (op === 'fail-history') native.port.releaseHistory(true);
      else if (op === 'retry') await native.retry();
      else if (op === 'rewind') {
        const state = await native.port.state();
        if (!state.isSettled || state.isStreaming) return json(response, { error: 'Native worker busy' }, 409);
        const first = native.journal.page({maxMessages: 128}).records.find(record => record.event.type === 'user/message');
        if (!first?.event.data?.id) throw Error('Native navigation target missing');
        await native.port.navigate(first.event.data.id);
      } else return json(response, { error: 'Unknown literal native fixture action' }, 400);
      return json(response, native.info());
    }
    if (url.pathname === '/fixture/action') {
      const op = url.searchParams.get('op');
      if (op === 'invalidate') invalidate(url.searchParams.get('text') ?? 'NEW BRANCH ORIGINAL');
      if (op === 'rewritten') invalidate('REWRITTEN SAME SHAPE ORIGINAL');
      if (op === 'fail') { failBaseline = true; invalidate('FAILED BRANCH ORIGINAL'); }
      if (op === 'unfail') failBaseline = false;
      if (op === 'hold-open') holdBaseline = true;
      if (op === 'release-open') { holdBaseline = false; for (const publish of baselineWaiters.splice(0)) publish(); }
      if (op === 'hold-page') holdPage = true;
      if (op === 'release-page') { holdPage = false; for (const publish of pageWaiters.splice(0)) publish(); }
      if (op === 'interaction') startInteraction();
      if (op === 'old-control') controlSend({ type: 'projection', sessionId: SESSION, projection: { source: 'verified-synthetic-source-session', generation: 'projection-1' }, seq: 999, changes: [{ key: 'title', val: 'STALE CONTROL TITLE' }] });
      if (op === 'old-assistant') for (const [socket, streams] of follows) for (const streamId of streams) {
        const old = { source: SOURCE, generation: 'projection-1' };
        for (const value of [
          { type: 'assistant-stream', projection: old, frame: { type: 'start', attemptId: 'reused-fixture-attempt', revision: 999, startedAfterSeq: 6, turn: 0, step: 0 } },
          { type: 'assistant-stream', projection: projection(), frame: { type: 'start', attemptId: 'reused-fixture-attempt', revision: 1, startedAfterSeq: 1, turn: 0, step: 0 } },
          { type: 'assistant-stream', projection: old, frame: { type: 'chunk', attemptId: 'reused-fixture-attempt', revision: 1000, index: 0, time: 0, chunk: ['text', 'STALE ASSISTANT'] } },
          { type: 'assistant-stream', projection: projection(), frame: { type: 'end', attemptId: 'reused-fixture-attempt', revision: 2, index: 0, outcome: { kind: 'abandoned' } } },
        ]) socket.send(JSON.stringify({ type: 'item', streamId, value }));
      }
      if (op === 'physical-restart') for (const [socket, streams] of follows) for (const streamId of [...streams]) {
        socket.send(JSON.stringify({ type: 'end', streamId }));
        streamSubscriptions.get(socket)?.get(streamId)?.abort();
        streamSubscriptions.get(socket)?.delete(streamId); streams.delete(streamId);
      }
      if (op === 'connection-ready') for (const socket of sockets.clients) socket.close(1012, 'fixture reconnect');
      if (op === 'surface-replace') for (const [socket, streams] of follows) for (const streamId of streams) socket.send(JSON.stringify({ type: 'item', streamId,
        value: { type: 'event', projection: projection(), event: { type: 'user/message', seq: 7, time: 1700000000007,
          surfaceOp: { op: 'replace', startSeq: 5, endSeq: 6 }, sourceEventSeqs: [5, 6],
          data: createUserMessage({ content: [{ type: 'text', text: 'MODEL SURFACE ONLY' }], source: { kind: 'user' } }) } } }));
      return json(response, { projection: projection(), interaction: interaction ?? null });
    }
    if (url.pathname === '/probe/prompt-mode') {
      promptMode = url.searchParams.get('value'); submissionOutcome = 'unknown';
      return json(response, { value: promptMode });
    }
    if (url.pathname === '/probe/release-prompt') {
      submissionOutcome = url.searchParams.get('outcome') ?? 'unknown';
      for (const pending of pendingPrompts.splice(0)) {
        const result = { ok: true, value: { accepted: true } };
        pending.call.result = result;
        json(pending.response, { type: 'server-response', rpcId: pending.call.rpcId, result });
      }
      return json(response, { value: submissionOutcome });
    }
    if (url.pathname === '/probe/submission-outcome') return json(response, { value: submissionOutcome });
    if (url.pathname === '/probe/status') return json(response, { requests, frames, uploads, selected: [...selected],
      creates, projection: projection(), interaction: interaction ?? null, pendingGateway: ctx.typertGateway.getPendingRemoteEvents() });
    if (url.pathname.startsWith('/fixture/originals/')) {
      const id = decodeURIComponent(url.pathname.slice('/fixture/originals/'.length));
      if (!['original-a', 'original-b'].includes(id)) return json(response, { error: 'missing original' }, 404);
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(id === 'original-a' ? 'fixture first original' : 'fixture second original');
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/session/uploadFileBinary') {
      const parts = []; for await (const part of request) parts.push(part);
      const data = Buffer.concat(parts);
      const receiptId = `fixture-receipt-${++receiptCounter}`;
      const hash = createHash('sha256').update(data).digest('hex');
      const file = { attachmentId: hash, name: url.searchParams.get('name') ?? 'fixture.txt', bytes: data.length };
      record(uploads, { receiptId, file, sessionId: url.searchParams.get('sessionId') }, 128);
      return json(response, { ok: true, value: { receiptId, file } });
    }
    if (url.pathname.startsWith('/plugins/')) {
      const result = await registry.fetchBundle(new Request(url, { method: request.method }));
      response.writeHead(result.status, Object.fromEntries(result.headers));
      const body = Buffer.from(await result.arrayBuffer());
      served.set(url.pathname + url.search, { status: result.status, sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length });
      response.end(body);
      return;
    }
    if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
      let text = '';
      for await (const part of request) {
        text += part;
        if (text.length > 65536) throw new Error('probe request too large');
      }
      const call = JSON.parse(text);
      const endpoint = url.pathname.slice(5);
      if (call.type !== 'client-request' || call.method !== endpoint || !call.rpcId) {
        return json(response, { error: 'invalid probe envelope' }, 400);
      }
      record(requests, { endpoint, payload: call.payload, rpcId: call.rpcId }, 4096);
      let result;
      const ok = value => ({ ok: true, value });
      const fail = (code, message) => ({ ok: false, error: { code, message, details: {} } });
      const args = call.payload?.args ?? call.payload;
      if (args.request?.projection && JSON.stringify(args.request.projection) !== JSON.stringify(projection())) {
        return json(response, { type: 'server-response', rpcId: call.rpcId,
          result: fail('gateway/bad-request', 'Stale synthetic projection request') });
      }
      if (endpoint.startsWith('ompInteractions/') && native) {
        const method = endpoint.slice('ompInteractions/'.length);
        if (!['snapshot', 'answer'].includes(method)) throw Error('Unknown native Interaction method');
        result = ok(await ctx.typertGateway.invoke({ namespace: 'ompInteractions', method, args, peer: owner, signal: request.signal ?? new AbortController().signal }));
      }
      else if (endpoint === 'settings/describe') result = ok({ namespaces: [], writable: false, hasDocument: false });
      else if (endpoint === 'session/list') result = ok({ items: sessionRows() });
      else if (endpoint === 'workspace/initializeDefault') result = ok(undefined);
      else if (endpoint === 'session/create') {
        creates++;
        const sessionId = `fixture-created-${creates}`;
        broadcast('api-session/added', sessionRows().at(-1));
        result = ok({ sessionId });
      }
      else if (endpoint === 'session/projections') { await native?.ready(); result = ok({ kind: 'sequenced', ...opening(SESSION).projections }); }
      else if (endpoint === 'session/page') {
        const request = args.request;
        if (JSON.stringify(request.projection) !== JSON.stringify(projection())) throw new Error('Stale fixture page');
        const value = { cursor: request.throughSeq, projection: request.projection, records: [
          { type: 'event', event: { type: 'turn/start', seq: 3, time: 1700000000000, data: { turn: 0 } } },
          { type: 'event', event: { ...fixtureHistory[0].event, seq: 4,
            data: { ...fixtureHistory[0].event.data, content: [{ type: 'text', text: 'STALE OLDER ORIGINAL' }] } } },
        ], hasMore: false };
        const publish = () => json(response, { type: 'server-response', rpcId: call.rpcId, result: ok(value) });
        if (holdPage) { if (pageWaiters.length >= 8) throw new Error('Fixture page budget'); pageWaiters.push(publish); return; }
        result = ok(value);
      }
      else if (endpoint === '$events/result') {
        const value = await gatewayRpc(endpoint, call.payload, request.signal ?? new AbortController().signal, owner);
        result = value;
      }
      else if (endpoint === 'session/prompt' && promptMode === 'delay') {
        pendingPrompts.push({ response, call: requests.at(-1) });
        return;
      }
      else if (endpoint === 'session/prompt' && promptMode === 'drop') {
        response.destroy(); return;
      }
      else if (endpoint === 'session/prompt' || endpoint === 'session/cancel'  || endpoint === 'session/updateQueue') result = ok({ accepted: true });
      else if (endpoint === 'session/rename') result = ok({ title: args.title, seq: 0 });
      else result = fail('gateway/internal', `Unsupported by isolated fixture: ${endpoint}`);
      requests.at(-1).result = result;
      return json(response, { type: 'server-response', rpcId: call.rpcId, result });
    }
    if (url.pathname === '/' || url.pathname === '/bare') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(url.pathname === '/bare' ? rawHtml : html);
      return;
    }
    const dist = resolve(upstream, 'apps/web/dist');
    const path = resolve(dist, '.' + decodeURIComponent(url.pathname));
    if (!path.startsWith(dist + sep)) return json(response, { error: 'outside static root' }, 400);
    const data = await readFile(path);
    served.set(url.pathname, { status: 200, sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length });
    response.writeHead(200, { 'content-type': mime[extname(path)] ?? 'application/octet-stream' });
    response.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') return json(response, { error: 'missing probe asset' }, 404);
    console.error(error);
    json(response, { error: String(error) }, 500);
  }
});
const sockets = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: false });
server.on('upgrade', (request, socket, head) => {
  if (new URL(request.url, 'http://127.0.0.1').pathname !== '/api/remote.mux'
    || request.headers.origin !== `http://127.0.0.1:${server.address().port}` || sockets.clients.size >= 8) return socket.destroy();
  sockets.handleUpgrade(request, socket, head, (websocket) => sockets.emit('connection', websocket));
});
function broadcast(event, ...args) {
  for (const [socket, id] of channels) if (socket.readyState === 1) {
    socket.send(JSON.stringify({ type: 'item', streamId: id, value: { type: 'emit', event, args } }));
  }
}
sockets.on('connection', (socket) => {
  const subscriptions = new Map();
  streamSubscriptions.set(socket, subscriptions);
  socket.on('close', () => {
    controls.delete(socket); follows.delete(socket); channels.delete(socket); streamSubscriptions.delete(socket);
    for (const controller of subscriptions.values()) controller.abort();
  });
  socket.on('message', bytes => {
    const frame = parseRemoteStreamClientMessage(bytes.toString()); record(frames, frame, 8192);
    if (frame.type === 'cancel') { subscriptions.get(frame.streamId)?.abort(); subscriptions.delete(frame.streamId); controls.get(socket)?.delete(frame.streamId); follows.get(socket)?.delete(frame.streamId); return; }
    if (frame.type !== 'open') return;
    if (subscriptions.size >= 8 || subscriptions.has(frame.streamId)) { socket.close(1008, 'Fixture stream budget'); return; }
    subscriptions.set(frame.streamId, new AbortController());
    const send = value => {
      if (socket.readyState !== 1) return;
      record(frames, { direction: 'server', streamId: frame.streamId, value }, 8192);
      socket.send(JSON.stringify({ type: 'item', streamId: frame.streamId, value }));
    };
    if (frame.endpoint === '$events') {
      const controller = new AbortController(); subscriptions.set(frame.streamId, controller);
      void (async () => {
        try {
          const stream = await ctx.typertGateway.wireStream.open('$events', frame.payload, (async function* () {})(), owner, controller.signal);
          for await (const value of stream) send(value);
        } catch (error) { if (!controller.signal.aborted && socket.readyState === 1) socket.send(JSON.stringify({ type: 'error', streamId: frame.streamId, error: ctx.typertGateway.wireStream.failure(error) })); }
      })();
      return;
    }
    if (frame.endpoint === 'session/control') {
      const signal = subscriptions.get(frame.streamId).signal;
      void (async () => {
        try {
          if (native) await native.ready(signal);
          if (signal.aborted || socket.readyState !== 1) return;
          const baseline = opening(SESSION).projections;
          let streams = controls.get(socket);
          if (!streams) { streams = new Set(); controls.set(socket, streams); }
          streams.add(frame.streamId);
          send({ type: 'baseline', value: { projections: { [SESSION]: baseline } } });
        } catch (error) {
          if (!signal.aborted && socket.readyState === 1) {
            subscriptions.delete(frame.streamId);
            socket.send(JSON.stringify({ type: 'error', streamId: frame.streamId,
              error: { code: 'gateway/internal', message: String(error), details: {} } }));
          }
        }
      })(); return;
    }
    const targetId = frame.payload?.args?.request?.address?.sessionId ?? SESSION;
    if (frame.endpoint === 'session/follow') {
      let streams = follows.get(socket); if (!streams) { streams = new Set(); follows.set(socket, streams); } streams.add(frame.streamId);
      if (native) {
        const signal = subscriptions.get(frame.streamId).signal;
        void (async () => {
          try {
            await native.ready(signal); if (signal.aborted) return;
            const journal = native.journal, identity = projection();
            const stop = journal.subscribe(value => send({ ...value, projection: identity }));
            signal.addEventListener('abort', stop, { once: true }); send(opening(targetId));
          } catch (error) { if (!signal.aborted && socket.readyState === 1) socket.send(JSON.stringify({ type: 'error', streamId: frame.streamId, error: { code: 'gateway/internal', message: String(error), details: {} } })); }
        })(); return;
      }
      const value = opening(targetId);
      const publish = () => {
        if (socket.readyState !== 1) return;
        if (failBaseline) socket.send(JSON.stringify({ type: 'error', streamId: frame.streamId, error: { code: 'gateway/internal', message: 'Controlled baseline failure', details: {} } }));
        else send(value);
      };
      if (holdBaseline) { if (baselineWaiters.length >= 8) throw new Error('Fixture opening budget'); baselineWaiters.push(publish); } else publish(); return;
    }
    const openings = {
      'remoteAccess/follow': { type: 'baseline', owner: true },
      'workspace/follow': { type: 'baseline', value: { items: [workspace], archivedSessionIds: [], pinnedSessionIds: [] } },
    };
    if (Object.hasOwn(openings, frame.endpoint)) send(openings[frame.endpoint]);
    else socket.send(JSON.stringify({ type: 'error', streamId: frame.streamId, error: { code: 'gateway/internal', message: 'Unsupported by projection fixture', details: {} } }));
  });
});
server.listen(0, '127.0.0.1', async () => {
  const address = server.address();
  const state = { pid: process.pid, port: address.port,
    graphEntries: graph.entries.length, graphBatches: graph.batches.length };
  await writeFile(resolve(evidence, 'server.json'), JSON.stringify(state, null, 2) + '\n');
  console.log(JSON.stringify(state));
});
async function stop() {
  await writeFile(resolve(evidence, 'served-assets.json'), JSON.stringify(Object.fromEntries(served), null, 2) + '\n');
  await writeFile(resolve(evidence, 'calls.json'), JSON.stringify({ requests, frames, uploads, creates }, null, 2) + '\n');
  for (const socket of sockets.clients) socket.terminate();
  server.close();
  await unregisterEvents();
  await owner.dispose();
  await ctx.fiber.dispose();
  if (native) { const { trace, ...result } = await native.close(); await writeFile(resolve(evidence, 'native-closed.json'), JSON.stringify(result, null, 2) + '\n'); await writeFile(resolve(evidence, 'native.network.strace.gz'), gzipSync(trace)); }
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
