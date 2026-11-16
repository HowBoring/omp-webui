import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, renameSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionIndex } from "../../packages/sessions/index.ts";
import type { CatalogDescriptor } from "../../packages/contracts/generated/omp-wire.ts";
const paths: string[] = [];
afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
function directory() { const path = mkdtempSync(join(tmpdir(), "omp-session-index-")); paths.push(path); return path; }
const descriptor: CatalogDescriptor = { sourceId: "synthetic-source", instanceId: "synthetic-instance", reference: "opaque-native-reference",
  nativeSessionId: "existing-native-id", aliases: [], cwd: { status: "known", recorded: "/synthetic/project", canonical: "/synthetic/project" },
  createdAt: "2026-11-16T00:00:00.000Z", modifiedAt: "2026-11-16T00:00:00.000Z", observedAt: "2026-11-16T00:00:00.000Z",
  ownership: { state: "free", observedAt: "2026-11-16T00:00:00.000Z" }, title: "Synthetic conversation" };

test("first open persists one reference and its failure across Host restart", async () => {
  const data = directory(); let index = new SessionIndex(data);
  const record = index.register(descriptor);
  index.observe(record.id, { state: "failed", code: "STRICT_SESSION_OCCUPIED" });
  expect(index.register(descriptor).id).toBe(record.id);
  index.close(); index = new SessionIndex(data);
  expect((await index.page({})).records).toMatchObject([{ id: record.id, nativeSessionId: "existing-native-id",
    sourceId: "synthetic-source", instanceId: "synthetic-instance", attempt: { state: "failed", code: "STRICT_SESSION_OCCUPIED" } }]);
  index.close();
});

test("Host restart preserves native identity and requires manual reopen without resurrecting a worker", async () => {
  const data = directory(); let index = new SessionIndex(data);
  const record = index.register(descriptor); index.observe(record.id, { state: "open" });
  index.close(); index = new SessionIndex(data);
  expect(index.get(record.id)).toMatchObject({ reference: "opaque-native-reference", attempt: {
    state: "outcome_unknown", code: "SESSION_HOST_RESTARTED_MANUAL_OPEN_REQUIRED" } });
  index.close();
});

test("same native ID in different physical instances remains distinct and snapshots reject expired cursors", async () => {
  let now = 1_794_787_200_000;
  const index = new SessionIndex(directory(), () => now);
  const first = index.register(descriptor);
  const second = index.register({ ...descriptor, instanceId: "different-copy", reference: "other-native-reference" });
  expect(second.id).not.toBe(first.id);
  const page = await index.page({ pageSize: 1 }); expect(page.records).toHaveLength(1);
  now += 30_000;
  await expect(index.page({ cursor: page.nextCursor!, pageSize: 1 })).rejects.toThrow("INDEX_CURSOR_EXPIRED");
  index.close();
});

test("replacement of the Host state directory fails closed", () => {
  const parent = directory(), data = join(parent, "state");
  const index = new SessionIndex(data); index.register(descriptor);
  renameSync(data, join(parent, "old")); mkdirSync(data);
  expect(() => index.get("unknown")).toThrow("INDEX_UNAVAILABLE");
  index.close();
});
