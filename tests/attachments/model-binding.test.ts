import { expect, test } from "bun:test";

/**
 * Static import cannot be used: `vendor/omp` is vendored upstream source outside this repository's
 * strict TypeScript program, and a literal specifier makes `tsc` typecheck the whole upstream tree.
 */
const source = new URL("../../vendor/omp/packages/coding-agent/src/attachments/model-binding.ts",
  import.meta.url).pathname;
const {
  attachmentImageCapable,
  attachmentModelFingerprint,
} = (await import(source)) as {
  attachmentImageCapable(model: unknown, policy: unknown): boolean;
  attachmentModelFingerprint(model: unknown, policy: unknown): string;
};

type BoundModel = Record<string, unknown>;
const openai: BoundModel = {
  provider: "kimi-code", id: "k3.1-pro", api: "openai-completions", baseUrl: "https://api.kimi.com/coding/v1",
  input: ["text", "image"], compat: {}, name: "K3.1 Pro", contextWindow: 1_048_576, maxTokens: 131_072,
  identity: { class: "kimi", family: "k3" }, cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2 },
  compatConfig: { thinkingFormat: "kimi", reasoningContentField: "reasoning_content", supportsDeveloperRole: false },
  thinking: { mode: "effort", efforts: ["low", "high", "max"], requiresEffort: true, defaultLevel: "high" },
} as BoundModel;
/** Same model after registry discovery swaps the wire row; no attachment semantics changed. */
const anthropic: BoundModel = {
  ...openai, api: "anthropic-messages", baseUrl: "https://api.kimi.com/coding",
  headers: { "User-Agent": "KimiCLI/19.0.0" }, thinking: { mode: "anthropic-adaptive" }, cost: { input: 3, output: 15 },
} as BoundModel;
const policy = { blocked: false, urls: false };

test("a wire-row refresh of the same model keeps a prepared receipt bound", () => {
  expect(attachmentModelFingerprint(anthropic, policy)).toBe(attachmentModelFingerprint(openai, policy));
});

test("a changed model or changed image delivery still invalidates the receipt", () => {
  const baseline = attachmentModelFingerprint(openai, policy);
  for (const changed of [
    { provider: "other" },
    { id: "k3" },
    { input: ["text"] },
    { imageInputDecoder: "stb" },
    { imageCountBudget: 1 },
  ]) expect(attachmentModelFingerprint({ ...openai, ...changed } as BoundModel, policy)).not.toBe(baseline);
  expect(attachmentModelFingerprint(openai, { blocked: true, urls: false })).not.toBe(baseline);
  expect(attachmentModelFingerprint(openai, { blocked: false, urls: true })).not.toBe(baseline);
});

test("image capability follows the effective wire and policy", () => {
  expect(attachmentImageCapable(openai, policy)).toBe(true);
  expect(attachmentImageCapable(anthropic, policy)).toBe(true);
  expect(attachmentImageCapable({ ...openai, input: ["text"] } as BoundModel, policy)).toBe(false);
  expect(attachmentImageCapable(openai, { blocked: true, urls: false })).toBe(false);
  expect(attachmentImageCapable(openai, { blocked: false, urls: true })).toBe(false);
  expect(attachmentImageCapable(undefined, policy)).toBe(false);
});
