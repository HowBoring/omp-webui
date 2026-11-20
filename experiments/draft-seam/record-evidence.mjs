/** Retain per-file artifact identities and verify the complete DSH public build record. No bundles are copied. */
import { createHash } from 'node:crypto';
import { globSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const upstream = resolve(process.argv[2] ?? 'vendor/dsh');
const evidence = resolve(process.argv[3] ?? 'experiments/draft-seam/evidence');
const sha = data => createHash('sha256').update(data).digest('hex');
const source = JSON.parse(readFileSync(resolve(upstream, '.dsh-build/omp-webui-source.json')));
const record = JSON.parse(readFileSync(resolve(upstream, '.dsh-build/client-build-environment.json')));
const patterns = ['apps/web/dist/**/*', 'packages/*/*/lib/client.js', 'packages/*/*/lib/client.js.map',
  'packages/*/*/lib/client.*.js', 'packages/*/*/lib/client.*.js.map', 'packages/*/*/lib/assets/**/*'];
const paths = globSync(patterns, { cwd: upstream }).map(path => path.replaceAll('\\', '/'))
  .filter(path => !/\/lib\/client\.node(?:\.|$)/.test(path) && statSync(resolve(upstream, path)).isFile()).sort();
const digest = createHash('sha256');
const files = paths.map(path => {
  const bytes = readFileSync(resolve(upstream, path));
  digest.update(`${Buffer.byteLength(path)}:`); digest.update(path); digest.update(`${bytes.byteLength}:`); digest.update(bytes);
  return { path, bytes: bytes.byteLength, sha256: sha(bytes) };
});
if (paths.length !== record.artifacts.fileCount || digest.digest('hex') !== record.artifacts.sha256) {
  throw new Error('Actual DSH assets differ from the completed source build record');
}
const fixtureFiles = globSync('vendor/draft-fixture/**/*').filter(path => statSync(path).isFile()).sort()
  .map(path => ({ path, sha256: sha(readFileSync(path)) }));
writeFileSync(resolve(evidence, 'assets.json'), JSON.stringify({ source, upstreamBuildRecord: record, files,
  fixtureFiles, graphSha256: sha(readFileSync(resolve(evidence, 'graph.json'))),
  servedResponsesSha256: sha(readFileSync(resolve(evidence, 'served-assets.json'))) }, null, 2) + '\n');
for (const [from, to] of [['vendor/dsh-diagnostics/manifest.json', 'diagnostic-build.json'],
  ['vendor/host-diagnostics/manifest.json', 'host-build.json']]) {
  writeFileSync(resolve(evidence, to), readFileSync(from));
}
console.info(JSON.stringify({ sourceTree: source.sourceTree, artifacts: files.length, fixtureFiles: fixtureFiles.length }));
