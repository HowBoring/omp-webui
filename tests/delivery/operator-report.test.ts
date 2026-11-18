import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeReleaseManifest } from "../../packages/delivery/artifact.ts";
import { fixtureRelease } from "./fixtures.ts";

const script = fileURLToPath(new URL("../../scripts/inspect-delivery.ts", import.meta.url));

function runOperatorReport(cwd: string, selection?: string): unknown {
  const env = selection === undefined ? { PATH: cwd } : { PATH: cwd, OMP_WEB_DELIVERY_SELECTION: selection };
  const result = Bun.spawnSync([process.execPath, "--no-env-file", script], { cwd, env, timeout: 2_000 });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(2);
  return JSON.parse(result.stdout.toString());
}

test("operator report blocks when startup has no selected target", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "delivery-operator-"));
  try {
    await writeFile(join(cwd, ".env"), "OMP_WEB_DELIVERY_SELECTION=untrusted.json\n");
    expect(runOperatorReport(cwd)).toEqual({
      status: "blocked", sessionAdmission: "blocked", code: "GLOBAL_TARGET_NOT_SELECTED",
      missingEvidence: expect.arrayContaining(["actual-global-target"]),
    });
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

for (const kind of ["malformed", "oversize"] as const) {
  test(`operator report sanitizes a ${kind} selection file`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "delivery-operator-"));
    try {
      const path = join(cwd, "selection.json");
      const json = JSON.stringify({
        root: cwd, entry: join(cwd, "omp"), expectedIdentity: "a".repeat(64),
        control: { path: join(cwd, "maintenance"), device: "1", inode: "1" },
      });
      await writeFile(path, kind === "malformed" ? json.slice(0, -1) : json.padEnd(65_537), { mode: 0o400 });
      expect(runOperatorReport(cwd, path)).toEqual({
        status: "blocked", sessionAdmission: "blocked", code: "DELIVERY_SELECTION_INVALID",
      });
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
}

test.skipIf(process.platform !== "linux")("explicit selection reports components only", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "delivery-operator-"));
  try {
    const root = await fixtureRelease(cwd);
    const expectedIdentity = await writeReleaseManifest({ root, platformDependencies: [] });
    const controlPath = join(cwd, "maintenance");
    await writeFile(controlPath, "");
    const { dev, ino } = await stat(controlPath, { bigint: true });
    const json = JSON.stringify({
      root, entry: join(root, "bin/omp"), expectedIdentity,
      control: { path: controlPath, device: dev.toString(), inode: ino.toString() },
    });
    const selection = json + " ".repeat(65_536 - Buffer.byteLength(json));
    const path = join(cwd, "selection.json");
    await writeFile(path, selection, { mode: 0o400 });
    await symlink("selection.json", join(cwd, "selected.json"));
    expect(runOperatorReport(cwd, "selected.json")).toEqual({
      status: "blocked", sessionAdmission: "blocked", code: "DELIVERY_COMPONENTS_ONLY",
      inventorySha256: expectedIdentity, missingEvidence: expect.arrayContaining(["actual-global-target"]),
    });
    expect(await readFile(path, "utf8")).toBe(selection);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
