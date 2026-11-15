/** Isolated boot probe, not an application Host. Run against a built pinned upstream checkout. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { globSync, readFileSync } from 'node:fs';
import { resolve, dirname, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const [upstreamArg, evidenceArg] = process.argv.slice(2);
if (!upstreamArg || !evidenceArg) throw new Error('usage: node host.mjs UPSTREAM EVIDENCE_DIR');
const upstream = resolve(upstreamArg);
const evidence = resolve(evidenceArg);
const fileImport = (path) => import(pathToFileURL(resolve(upstream, path)).href);
const moduleRequire = createRequire(resolve(upstream, 'packages/client/modules/package.json'));
const { Context } = await import(pathToFileURL(moduleRequire.resolve('@deepseek-ai/cordis')).href);
const { ClientModuleRegistry, bootInjections } = await fileImport('packages/client/modules/lib/index.js');
const { renderIndexInjections } = await fileImport('packages/host/webserver/lib/types/injections.js');
const { parseRemoteStreamClientMessage } = await fileImport('packages/api/gateway/lib/types/stream-protocol.js');
const appRequire = createRequire(resolve(upstream, 'apps/web/package.json'));
const { WebSocketServer } = appRequire('ws');
const manifests = new Map([...globSync('packages/*/*/package.json', { cwd: upstream })].map((path) => {
  const manifest = JSON.parse(readFileSync(resolve(upstream, path), 'utf8'));
  return [manifest.name, { manifest, dir: dirname(resolve(upstream, path)) }];
}));
const seeds = [
  'client-modules', 'api-session-controller', 'client-ui-renderer', 'client-ui-layout',
  'client-ui-session', 'client-ui-chat', 'client-ui-sidebar', 'client-ui-tool',
  'client-ui-approval', 'client-ui-user-questions',
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
const ctx = new Context();
// Supply metadata rows only. No DSH Host plugins or runtime are mounted.
ctx.provide('loader', {
  *entries() {
    for (const name of selected) yield {
      options: { name }, fiber: {}, disabled: false,
      parent: { tree: { ctx: { baseUrl: pathToFileURL(manifests.get(name).dir + sep).href } } },
    };
  },
});
await ctx.plugin(ClientModuleRegistry);
const registry = ctx.get('clientModules');
const graph = registry.graph();
await writeFile(resolve(evidence, 'graph.json'), JSON.stringify(graph, null, 2) + '\n');
const rawHtml = await readFile(resolve(upstream, 'apps/web/dist/index.html'), 'utf8');
const observeContext = `(() => {
  const original = window.__ModuleLoader__.create;
  window.__ModuleLoader__.create = function(options) {
    const system = original.call(this, options);
    const start = system.entries.start;
    system.entries.start = function(loader, manifest) {
      window.__BOOT_PROBE_LOADER__ = loader;
      return start.call(this, loader, manifest);
    };
    return system;
  };
})()`;
const rows = [
  ...bootInjections(graph),
  { kind: 'global', name: '__DSH_REMOTE_ACCESS__', value: { type: 'baseline', owner: true } },
];
const html = renderIndexInjections(rawHtml, rows);
const observedHtml = renderIndexInjections(rawHtml, [
  ...rows, { kind: 'script', placement: 'head', text: observeContext },
]);
const requests = [];
const frames = [];
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html',
  '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
function json(response, value, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/probe/status') return json(response, { requests, frames, selected: [...selected] });
    if (url.pathname.startsWith('/plugins/')) {
      const result = await registry.fetchBundle(new Request(url, { method: request.method }));
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
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
      const values = {
        'settings/describe': { namespaces: [], writable: false, hasDocument: false },
        'session/list': { items: [] },
        // Native contract permits undefined when first-use initialization is ineligible.
        // No workspace, directory or Session is created by this fixture.
        'workspace/initializeDefault': undefined,
      };
      const result = Object.hasOwn(values, endpoint)
        ? { ok: true, value: values[endpoint] }
        : { ok: false, error: { code: 'gateway/internal', message: 'Unsupported by boot probe', details: {} } };
      return json(response, { type: 'server-response', rpcId: call.rpcId, result });
    }
    if (url.pathname === '/' || url.pathname === '/bare') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(url.pathname === '/bare' ? rawHtml : url.searchParams.has('observe') ? observedHtml : html);
      return;
    }
    const dist = resolve(upstream, 'apps/web/dist');
    const path = resolve(dist, '.' + decodeURIComponent(url.pathname));
    if (!path.startsWith(dist + sep)) return json(response, { error: 'outside static root' }, 400);
    const data = await readFile(path);
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
sockets.on('connection', (socket) => {
  socket.on('message', (bytes) => {
    const frame = parseRemoteStreamClientMessage(bytes.toString());
    frames.push(frame);
    if (frame.type !== 'open') return;
    const openings = {
      '$events': { type: 'ready', clientId: 'probe-client', host: { home: '/probe-home' } },
      'remoteAccess/follow': { type: 'baseline', owner: true },
      'workspace/follow': { type: 'baseline', value: { items: [], archivedSessionIds: [], pinnedSessionIds: [] } },
      'session/control': { type: 'baseline', value: { projections: {} } },
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
  for (const socket of sockets.clients) socket.terminate();
  server.close();
  await ctx.fiber.dispose();
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
