/** Isolated boot probe, not an application Host. Run against a built pinned upstream checkout. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { globSync, readFileSync } from 'node:fs';
import { resolve, dirname, extname, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { verifyDshSource } from '../../scripts/dsh-source.ts';

const [upstreamArg, evidenceArg] = process.argv.slice(2);
if (!upstreamArg || !evidenceArg) throw new Error('usage: node host.mjs UPSTREAM EVIDENCE_DIR');
const upstream = resolve(upstreamArg);
const evidence = resolve(evidenceArg);
const sourceIdentity = await verifyDshSource(upstream, 'candidate');
await writeFile(resolve(evidence, 'source.json'), JSON.stringify(sourceIdentity, null, 2) + '\n');
const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../vendor/draft-fixture');
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
include('@omp-webui/draft-navigation');
include('@omp-webui/draft-fixture');
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
  '@deepseek-ai/dsh-api-session-controller': { disabledActions: ['rename', 'fork', 'queue'], allowPromptWhileRunning: false },
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
  sessionIds: ['fixture-existing', 'fixture-second'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const running = false;
let creates = 0;
const sessionRows = () => [{ sessionId: 'fixture-existing', updatedAt: 1767225600000, running, blank: false,
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
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html',
  '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
function json(response, value, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/probe/status') return json(response, { requests, frames, uploads, selected: [...selected],
      creates });
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
      uploads.push({ receiptId, file, sessionId: url.searchParams.get('sessionId') });
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
      requests.push({ endpoint, payload: call.payload, rpcId: call.rpcId });
      let result;
      const ok = value => ({ ok: true, value });
      const fail = (code, message) => ({ ok: false, error: { code, message, details: {} } });
      const args = call.payload?.args ?? call.payload;
      if (endpoint === 'settings/describe') result = ok({ namespaces: [], writable: false, hasDocument: false });
      else if (endpoint === 'session/list') result = ok({ items: sessionRows() });
      else if (endpoint === 'workspace/initializeDefault') result = ok(undefined);
      else if (endpoint === 'session/create') {
        creates++;
        const sessionId = `fixture-created-${creates}`;
        broadcast('api-session/added', sessionRows().at(-1));
        result = ok({ sessionId });
      }
      else if (endpoint === 'session/projections') result = ok({ asOfSeq: -1, values: {} });
      else if (endpoint === 'session/prompt' || endpoint === 'session/cancel' || endpoint === 'session/updateQueue') result = ok({ accepted: true });
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
const sockets = new WebSocketServer({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  if (new URL(request.url, 'http://127.0.0.1').pathname !== '/api/remote.mux') return socket.destroy();
  sockets.handleUpgrade(request, socket, head, (websocket) => sockets.emit('connection', websocket));
});
function broadcast(event, ...args) {
  for (const [socket, id] of channels) if (socket.readyState === 1) {
    socket.send(JSON.stringify({ type: 'item', streamId: id, value: { type: 'emit', event, args } }));
  }
}
sockets.on('connection', (socket) => {
  socket.on('close', () => channels.delete(socket));
  socket.on('message', (bytes) => {
    const frame = parseRemoteStreamClientMessage(bytes.toString());
    frames.push(frame);
    if (frame.type !== 'open') return;
    if (frame.endpoint === '$events') channels.set(socket, frame.streamId);
    const targetId = frame.payload?.args?.request?.address?.sessionId ?? 'fixture-existing';
    const existing = targetId === 'fixture-existing' || targetId === 'fixture-second';
    const openings = {
      '$events': { type: 'ready', clientId: 'probe-client', host: { home: '/probe-home' } },
      'remoteAccess/follow': { type: 'baseline', owner: true },
      'workspace/follow': { type: 'baseline', value: { items: [workspace], archivedSessionIds: [], pinnedSessionIds: [] } },
      'session/control': { type: 'baseline', value: { projections: {} } },
      'session/follow': { type: 'snapshot', header: { version: SESSION_FORMAT_VERSION,
        id: targetId, createdAt: 1767225600000, isSeeded: false },
        cursor: existing ? 0 : -1, records: existing ? fixtureHistory : [], hasMore: false,
        projections: { asOfSeq: existing ? 0 : -1, values: {} }, assistantStream: { revision: 0 } },
    };
    const message = Object.hasOwn(openings, frame.endpoint)
      ? { type: 'item', streamId: frame.streamId, value: openings[frame.endpoint] }
      : { type: 'error', streamId: frame.streamId,
        error: { code: 'gateway/internal', message: 'Unsupported by boot probe', details: {} } };
    socket.send(JSON.stringify(message));
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
  await ctx.fiber.dispose();
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
