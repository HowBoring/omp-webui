import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PhysicalFrames } from '../../../../packages/compatibility/framing.ts';
import { validNegotiated, validReady, validReport, validResponse } from '../../../../packages/contracts/preflight.ts';

const [artifactRoot, captureScope] = process.argv.slice(2);
assert.ok(artifactRoot && captureScope && process.argv.length === 4, 'expected compiler root and capture directory');
const scope = resolve(captureScope);
const candidate = resolve(artifactRoot);
const matcher = join(candidate, 'packages/contracts/generated/report.js');
assert.equal(Bun.SHA256.hash(readFileSync(matcher), 'hex'),
  'ca136b45c2fe23459de39512db307b2265c36b01f69e7bbda08d0a5527246466');
const { default: validMatchedReport } = await import(matcher);
const raw = readFileSync(join(scope, 'stdout.jsonl'));
const framer = new PhysicalFrames(1, 1024 * 1024, true);
let received = 0;
let report: Record<string, unknown> | undefined;
framer.push(raw, frame => {
  received++;
  if (received === 1) {
    assert.ok(validReady(frame));
    assert.equal(frame.protocolVersion, 1);
    assert.deepEqual(frame.supportedProtocolVersions, [1, 2]);
    assert.equal(frame.maxFrameBytes, 1024 * 1024);
    assert.equal(frame.maxReassembledFrameBytes, 64 * 1024 * 1024);
    return;
  }
  assert.ok(validResponse(frame) && frame.success && frame.data && typeof frame.data === 'object');
  if (received === 2) {
    assert.equal(frame.command, 'negotiate_protocol');
    assert.equal(frame.id, 'probe-negotiate');
    assert.ok(validNegotiated(frame.data));
    assert.equal(frame.data.protocolVersion, 2);
    framer.negotiate(2);
    return;
  }
  assert.equal(received, 3);
  assert.equal(frame.command, 'get_compatibility');
  assert.equal(frame.id, 'probe-inspect');
  assert.equal(validReport(frame.data), true);
  assert.equal(validMatchedReport(frame.data), true);
  report = { ...frame.data };
});
framer.finish();
assert.equal(received, 3);
assert.ok(report);
const expected = {
  base: '7c49c11aa5bbaf3f418406583096168ad5b8c6dc',
  sourceSha256: '5e9f0c1f8ae49926c4cb48dfcf6b4607dd1ab399fb0b716b50340e07a01b7c14',
  patchSha256: '4155257edd91417311078f83ae144114c11968ef2709c27afaf72e9974e771ac',
  schemaSha256: '81a3ffc9ebcf5c929c39995cdc6350b56796782353f87a6a9c274153baffe958',
};
for (const [field, value] of Object.entries(expected)) assert.equal(report[field], value, field);
assert.equal(report.candidate, 'omp-webui-s0');
assert.equal(report.safePreflight, true);
assert.equal(report.sessionAdmission, 'blocked');
assert.deepEqual(report.runtime, {name: 'bun', version:'1.4.4', platform:'linux', arch:'x64'});
const invalidPolicy = { ...report, rpcUiSubmissionPolicy: null };
assert.equal(validReport(invalidPolicy), true);
assert.equal(validMatchedReport(invalidPolicy), false);
assert.equal(readFileSync(join(scope, 'stderr.bin')).length, 0);
assert.deepEqual(readdirSync(join(scope, 'home')), []);
const audit = JSON.parse(readFileSync(join(scope, 'guard.json'), 'utf8'));
assert.deepEqual(audit, { denied: 0, dispatched: 0 });
console.log(JSON.stringify({ status:'PASS_COMPILED_STDIN_PREFLIGHT', protocol:2, identity:expected,
  activeShapeAllowsUnvalidatedPolicy:true, matchedShapeRejectsInvalidPolicy:true,
  privateAdmission:'blocked', audit, stdoutSha256:Bun.SHA256.hash(raw,'hex') }));
