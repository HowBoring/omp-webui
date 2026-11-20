import { expect, test } from "bun:test";
import { draftBudgetFailure, imageLimits } from "../../apps/chat/src/images.ts";

const image = (bytes: number, pixels = 1) => ({ byteLength: bytes, pixels });

test("the draft target is 8 objects, 10 MiB per image, 32 MiB total, and an independent decode budget", () => {
  const ten = image(10 * 1024 * 1024);
  expect(draftBudgetFailure([], image(imageLimits.bytes + 1))).toBe("bytes");
  expect(draftBudgetFailure(Array.from({ length: 8 }, () => image(1)), image(1))).toBe("objects");
  expect(draftBudgetFailure([ten, ten, image(12 * 1024 * 1024)], image(1))).toBe("bytes");
  expect(draftBudgetFailure([], { byteLength: 1, pixels: imageLimits.draftPixels + 1 })).toBe("pixels");
  expect(draftBudgetFailure([image(1, imageLimits.draftPixels)], image(1))).toBe("pixels");
  expect(draftBudgetFailure([], image(imageLimits.bytes, 4))).toBeUndefined();
});
