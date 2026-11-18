import { strict as assert } from 'node:assert';
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { validCommand, validReport } from '../../../../packages/contracts/preflight.ts';
import { BoundedStdioTransport } from '../../../../packages/compatibility/stdio-transport.ts';

const [artifactRoot, profile] = process.argv.slice(2);
assert.ok(artifactRoot && profile && process.argv.length === 4, 'expected compiler root and empty scratch');
const root = realpathSync(resolve(artifactRoot));
const requested = resolve(profile);
assert.equal(realpathSync(requested), requested);
assert.ok(requested !== root && !requested.startsWith(root + sep), 'keep preflight output outside the compiler tree');
assert.deepEqual(readdirSync(requested), []);
assert.equal(Bun.version, '1.4.4');
assert.equal(process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH, '0');
assert.equal(process.env.NODE_DISABLE_COMPILE_CACHE, '1');

const pinned = {
  'vendor/omp-candidate/cli.js': 'c101c0a72f7b79f82a3b8545001aeb9f150dfccd712c9eca3171b7241a511dea',
  'vendor/omp-candidate/chunk-w4rr9em9.js': '111525aebf15d38209f3911431071a26ff0b94808f74b8985b630577bc1bf962',
  'vendor/omp-candidate/rpc-wire.schema.json': '81a3ffc9ebcf5c929c39995cdc6350b56796782353f87a6a9c274153baffe958',
  'packages/contracts/generated/report.js': 'ca136b45c2fe23459de39512db307b2265c36b01f69e7bbda08d0a5527246466',
  'no-provider.ts': 'c413f208c3a0849c2b37726d05e4533144a36bf420b8ec3cbfb3fdfa28346497',
} as const;
for (const [file, sha] of Object.entries(pinned)) {
  const absolute = join(root, file);
  assert.equal(realpathSync(absolute), absolute);
  assert.equal(Bun.SHA256.hash(readFileSync(absolute), 'hex'), sha, basename(file));
}
const { default: validMatchedReport } = await import(join(root, 'packages/contracts/generated/report.js'));
assert.equal(typeof validMatchedReport, 'function');
const home = join(requested, 'home'), cwd = join(requested, 'working');
mkdirSync(home, { mode: 0o700 });
mkdirSync(cwd, { mode: 0o700 });
const audit = join(requested, 'guard-audit.json'), auditSource = join(requested, 'audit-preload.ts');
writeFileSync(auditSource, `import { writeFileSync } from 'node:fs';
const guard = Reflect.get(globalThis, Symbol.for('omp.s0.network-guard'));
if (!guard || !process.env.OMP_FIXTURE_AUDIT) throw Error('missing preflight guard');
process.once('exit', () => writeFileSync(process.env.OMP_FIXTURE_AUDIT!, JSON.stringify({
  denied: guard.denied(), dispatched: guard.dispatched(),
}), { mode: 0o600, flag: 'wx' }));
`, { mode: 0o600, flag: 'wx' });
const transport = await BoundedStdioTransport.open({
  argv: [process.execPath, '--no-env-file', '--preload', join(root, 'no-provider.ts'), '--preload', auditSource,
    join(root, 'vendor/omp-candidate/cli.js'), '--rpc-preflight'],
  env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: home, TMPDIR: home, PI_CODING_AGENT_DIR: join(home, 'profile'),
    XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'), XDG_DATA_HOME: join(home, 'data'),
    OMP_FIXTURE_AUDIT: audit, BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0', NODE_DISABLE_COMPILE_CACHE: '1' },
  cwd, timeoutMs: 5000,
}, {
  validateCommand: validCommand,
  acceptReady: frame => frame.protocolVersion === 1 && frame.supportedProtocolVersions?.includes(2) === true
    && frame.maxFrameBytes === 1024 * 1024 && frame.maxReassembledFrameBytes === 64 * 1024 * 1024,
  remoteError: () => 'RPC_REMOTE_REJECTED', physicalFrameBytes: 1024 * 1024, allowChunks: true,
  commandBytes: 1024 * 1024,
});
const originalPid = transport.processId;
let report: unknown;
let drain: Awaited<ReturnType<typeof transport.close>>;
try {
  report = await transport.request({ id: crypto.randomUUID(), type: 'get_compatibility' });
} finally { drain = await transport.close(); }
assert.equal(drain.code, 0);
assert.ok(!drain.forced && !drain.forceSent && !drain.terminationSent);
assert.equal(drain.stdoutEOF, true);
assert.equal(drain.stderrEOF, true);
assert.equal(drain.stderrBytes, 0);
assert.equal(drain.protocolFailure, undefined);
const network = JSON.parse(readFileSync(audit, 'utf8'));
assert.deepEqual(network, { denied: 0, dispatched: 0 });
const finalHomeEntries = readdirSync(home).length;
const finalCwdEntries = readdirSync(cwd).length;
assert.equal(finalHomeEntries, 0);
assert.equal(finalCwdEntries, 0);
assert.equal(validMatchedReport(report), true);
assert.ok(typeof report === 'object' && report !== null);
assert.ok(validReport(report));
const fields = report;
const identity = {
  base: '7c49c11aa5bbaf3f418406583096168ad5b8c6dc',
  sourceSha256: '5e9f0c1f8ae49926c4cb48dfcf6b4607dd1ab399fb0b716b50340e07a01b7c14',
  patchSha256: '4155257edd91417311078f83ae144114c11968ef2709c27afaf72e9974e771ac',
  schemaSha256: pinned['vendor/omp-candidate/rpc-wire.schema.json'],
};
for (const [field, expected] of Object.entries(identity)) assert.equal(Reflect.get(fields, field), expected, field);
assert.equal(fields.candidate, 'omp-webui-s0');
assert.equal(fields.safePreflight, true);
assert.equal(fields.sessionAdmission, 'blocked');
assert.deepEqual(fields.runtime, { name: 'bun', version: '1.4.4', platform: process.platform, arch: process.arch });
const invalidPolicy = { ...fields, rpcUiSubmissionPolicy: null };
assert.equal(validReport(invalidPolicy), true);
assert.equal(validMatchedReport(invalidPolicy), false);
console.log(JSON.stringify({ status: 'PASS_COMPILED_CANDIDATE_DIAGNOSTIC', originalPid, protocol: 2,
  identity, matchedReport: true, activeShapeAllowsUnvalidatedPolicy: true,
  matchedShapeRejectsInvalidPolicy: true, privateAdmission: fields.sessionAdmission,
  finalHomeEntries, finalCwdEntries, network, drain }));
