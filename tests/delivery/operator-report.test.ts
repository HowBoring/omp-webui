import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeReleaseManifest } from "../../packages/delivery/artifact.ts";
import { fixtureRelease } from "./fixtures.ts";

const script = fileURLToPath(new URL("../../scripts/inspect-delivery.ts", import.meta.url));

function runOperatorReport(cwd: string, selection?: string): unknown {
  const env = { PATH: cwd, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", NODE_DISABLE_COMPILE_CACHE: "1",
    ...(selection === undefined ? {} : { OMP_WEB_DELIVERY_SELECTION: selection }) };
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

for (const kind of ["malformed", "oversized"] as const) {
  test(`operator report sanitizes ${kind} selection files`, async () => {
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

test("operator report rejects a selection file with invalid UTF-8", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "delivery-operator-"));
  try {
    const path = join(cwd, "selection.json");
    const json = JSON.stringify({
      root: "release-\u00ff", entry: "omp", expectedIdentity: "a".repeat(64),
      control: { path: "relative-control", device: "1", inode: "1" },
    });
    await writeFile(path, Buffer.from(json, "latin1"), { mode: 0o400 });
    expect(runOperatorReport(cwd, path)).toEqual({
      status: "blocked", sessionAdmission: "blocked", code: "DELIVERY_SELECTION_INVALID",
    });
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test.skipIf(process.platform !== "linux")("operator report blocks a directory as a maintenance control", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "delivery-operator-"));
  try {
    const controlPath = join(cwd, "maintenance");
    await mkdir(controlPath);
    const { dev, ino } = await stat(controlPath, { bigint: true });
    const path = join(cwd, "selection.json");
    await writeFile(path, JSON.stringify({
      root: join(cwd, "release"), entry: join(cwd, "release/bin/omp"), expectedIdentity: "a".repeat(64),
      control: { path: controlPath, device: dev.toString(), inode: ino.toString() },
    }), { mode: 0o400 });
    expect(runOperatorReport(cwd, path)).toMatchObject({
      status: "blocked", sessionAdmission: "blocked", code: "MAINTENANCE_CONTROL_CHANGED",
    });
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

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
