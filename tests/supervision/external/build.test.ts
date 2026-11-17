import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildExternalProtector } from "../../../scripts/build-external-protector.ts";

test("external protector build refuses an enrolled release before lease acquisition or compilation", async () => {
  const temporary = await mkdtemp("/tmp/omp-external-build-guard-");
  try {
    const root = join(temporary, "release");
    await mkdir(root);
    await writeFile(join(root, "release.json"), "approved sentinel");
    const stable = { path: join(temporary, "not-opened"), device: "1", inode: "1" };
    await expect(buildExternalProtector({ root, control: stable, fences: stable,
      dispatcher: { endpoint: join(temporary, "unused.sock"), installation: "f".repeat(64) } }))
      .rejects.toMatchObject({ code: "EXTERNAL_BUILD_REQUIRES_FRESH_RELEASE" });
    expect(await readFile(join(root, "release.json"), "utf8")).toBe("approved sentinel");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("external build never overwrites an existing separately approved protector", async () => {
  const temporary = await mkdtemp("/tmp/omp-external-build-guard-");
  try {
    const root = join(temporary, "release");
    await mkdir(join(root, "bin"), { recursive: true });
    await writeFile(join(root, "bin/omp-external-protector"), "external sentinel");
    const stable = { path: join(temporary, "not-opened"), device: "1", inode: "1" };
    await expect(buildExternalProtector({ root, control: stable, fences: stable,
      dispatcher: { endpoint: join(temporary, "unused.sock"), installation: "f".repeat(64) } }))
      .rejects.toMatchObject({ code: "EXTERNAL_BUILD_DESTINATION_EXISTS" });
    expect(await readFile(join(root, "bin/omp-external-protector"), "utf8")).toBe("external sentinel");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
