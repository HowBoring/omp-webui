import { expect, test } from 'bun:test';
import { assertPreparedInputPolicy } from '../../../vendor/omp/packages/coding-agent/src/attachments/input-policy';
test('unsupported prepared input kinds and live delivery hints refuse before receipt claim or reservation', () => {
  for (const kind of ['steer', 'follow_up', 'abort_and_prompt']) {
    expect(() => assertPreparedInputPolicy(kind, false)).toThrow('ATTACHMENT_INPUT_KIND_UNSUPPORTED');
  }
  for (const hint of ['steer','followUp']) expect(() => assertPreparedInputPolicy('prompt', false, hint))
    .toThrow('ATTACHMENT_INPUT_KIND_UNSUPPORTED');
  expect(() => assertPreparedInputPolicy('prompt', true)).toThrow('ATTACHMENT_BUSY_UNSUPPORTED');
  expect(() => assertPreparedInputPolicy('prompt', false)).not.toThrow();
});
