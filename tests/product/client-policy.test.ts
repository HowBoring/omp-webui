import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The Host's history journals are generation-scoped: a native cut change replaces the
 * presented journal and control announces the new projection. Stock Client defaults pin
 * one journal and never react, so the served boot graph must select rebuild explicitly.
 */
test("the served client enables projection rebuild for generation-scoped journals", async () => {
  const graph = await readFile(join(import.meta.dir, "../../vendor/dsh-product/boot/graph-__DSH_BOOT__.js"), "utf8");
  const row = /"id":"@deepseek-ai\/dsh-api-session-controller"[^}]*?"config":(\{[^}]*\})/.exec(graph);
  expect(row).not.toBeNull();
  expect(JSON.parse(row![1]!)).toMatchObject({ projectionRebuild: true });
});
