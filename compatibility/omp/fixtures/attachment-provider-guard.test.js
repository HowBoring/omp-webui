import { expect, test } from "bun:test";
import { runSubmission } from "../../../vendor/omp/packages/coding-agent/src/session/submission-provenance";
import { stagePreparedImage, assertPreparedProviderContext } from "../../../vendor/omp/packages/coding-agent/src/attachments/provider-guard";

test("a byte-equal replacement image cannot acquire a controlled original's causal identity", () => {
  const image = { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" };
  const link = { originalId: "original", preparedId: "prepared", originalSha256: "a".repeat(64),
    preparedSha256: "b".repeat(64), representationKind: "image" };
  stagePreparedImage(image, link);
  const scope = { origin: { sourceId: "c".repeat(64), instanceId: "d".repeat(64), nativeSessionId: "synthetic", clientSubmissionId: "input" },
    phase: "input", prepared: { message: "prose", images: [image], companionMessages: [], attachments: [link],
      preparationDigest: "e".repeat(64), modelFingerprint: "f".repeat(64) } };
  const changed = { messages: [{ role: "user", timestamp: 1, content: [{ ...image }] }] };
  expect(() => runSubmission(scope, () => assertPreparedProviderContext(changed, "f".repeat(64))))
    .toThrow("ATTACHMENT_PROVIDER_REPRESENTATION_MISSING");
});

test("removing a prepared document from provider context is an explicit failure", () => {
  const link = { originalId: "document", preparedId: "prepared-document", originalSha256: "a".repeat(64),
    preparedSha256: "b".repeat(64), representationKind: "text" };
  const scope = { origin: { sourceId: "c".repeat(64), instanceId: "d".repeat(64), nativeSessionId: "synthetic", clientSubmissionId: "input" },
    phase: "input", prepared: { message: "prose", images: [], companionMessages: [], attachments: [link],
      preparationDigest: "e".repeat(64), modelFingerprint: "f".repeat(64) } };
  expect(() => runSubmission(scope, () => assertPreparedProviderContext({ messages: [] }, "f".repeat(64))))
    .toThrow("ATTACHMENT_PROVIDER_REPRESENTATION_MISSING");
});

test('cached model conversion cannot rebaseline a mutated prepared document', async () => {
  const { stageAttachmentMessage } = await import('../../../vendor/omp/packages/coding-agent/src/session/submission-provenance');
  const { carryPreparedModelMessage } = await import('../../../vendor/omp/packages/coding-agent/src/attachments/provider-guard');
  const link = { originalId: 'document', preparedId: 'prepared-document', originalSha256: 'a'.repeat(64),
    preparedSha256: 'b'.repeat(64), representationKind: 'text' };
  const source = {}, target = { role: 'developer', timestamp: 1, content: [{ type: 'text', text: 'exact staged' }] };
  stageAttachmentMessage(source, [link]); carryPreparedModelMessage(source, target);
  target.content[0].text = 'changed by context hook'; carryPreparedModelMessage(source, target);
  const scope = { origin: { sourceId: 'c'.repeat(64), instanceId: 'd'.repeat(64), nativeSessionId: 'synthetic', clientSubmissionId: 'input' },
    phase: 'input', prepared: { message: 'prose', images: [], companionMessages: [], attachments: [link],
      preparationDigest: 'e'.repeat(64), modelFingerprint: 'f'.repeat(64) } };
  expect(() => runSubmission(scope, () => assertPreparedProviderContext({ messages: [target] }, 'f'.repeat(64))))
    .toThrow('ATTACHMENT_PROVIDER_REPRESENTATION_CHANGED');
});

test('the actual native context clone carries explicit image origin before extensions run', async () => {
  const { clonePreparedContextMessages } = await import('../../../vendor/omp/packages/coding-agent/src/attachments/provider-guard');
  const image = { type: 'image', mimeType: 'image/png', data: 'exact staged image bytes' };
  const link = { originalId: 'image', preparedId: 'prepared-image', originalSha256: 'a'.repeat(64),
    preparedSha256: 'b'.repeat(64), representationKind: 'image' };
  stagePreparedImage(image, link);
  const source = [{ role: 'user', timestamp: 1, content: [image] }];
  const cloned = clonePreparedContextMessages(source);
  const scope = { origin: { sourceId: 'c'.repeat(64), instanceId: 'd'.repeat(64), nativeSessionId: 'synthetic', clientSubmissionId: 'input' },
    phase: 'input', prepared: { message: 'prose', images: [image], companionMessages: [], attachments: [link],
      preparationDigest: 'e'.repeat(64), modelFingerprint: 'f'.repeat(64) } };
  expect(() => runSubmission(scope, () => assertPreparedProviderContext({ messages: cloned }, 'f'.repeat(64)))).not.toThrow();
  cloned[0].content[0].data = 'modified inside the context hook';
  expect(() => runSubmission(scope, () => assertPreparedProviderContext({ messages: cloned }, 'f'.repeat(64))))
    .toThrow('ATTACHMENT_PROVIDER_REPRESENTATION_CHANGED');
});

test('native document clone keeps its original content baseline across a context hook', async () => {
  const { stageAttachmentMessage } = await import('../../../vendor/omp/packages/coding-agent/src/session/submission-provenance');
  const { clonePreparedContextMessages, stagePreparedDocument, carryPreparedModelMessage } =
    await import('../../../vendor/omp/packages/coding-agent/src/attachments/provider-guard');
  const source = { role: 'fileMention', timestamp: 1, files: [{ path: 'attachment-prepared://actual', content: 'exact staged' }] };
  const link = { originalId: 'document', preparedId: 'prepared-document', originalSha256: 'a'.repeat(64),
    preparedSha256: 'b'.repeat(64), representationKind: 'text' };
  stageAttachmentMessage(source, [link]); stagePreparedDocument(source);
  const [copy] = clonePreparedContextMessages([source]); copy.files[0].content = 'modified before model conversion';
  expect(() => carryPreparedModelMessage(copy, { role: 'developer', content: 'modified', timestamp: 1 }))
    .toThrow('ATTACHMENT_PROVIDER_REPRESENTATION_CHANGED');
});
