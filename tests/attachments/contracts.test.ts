import { expect, test } from "bun:test";
import validate from "../../packages/contracts/generated/attachment-command.js";

test("preparation schema rejects path fields and unsupported object formats", () => {
  const command = { id: "request", type: "attachment_prepare", preparationId: "prep", draftId: "draft",
    draftRevision: "1", authorityGeneration: "grant", message: "native @path stays prose",
    objects: [{ originalId: "object", format: "utf8", sha256: "a".repeat(64), data: "dGV4dA==" }] };
  expect(validate(command)).toBe(true);
  expect(validate({ ...command, filename: "/private/path" })).toBe(false);
  expect(validate({ ...command, objects: [{ ...command.objects[0], path: "/private/path" }] })).toBe(false);
  expect(validate({ ...command, objects: [{ ...command.objects[0], format: "svg" }] })).toBe(false);
});
