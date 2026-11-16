/** Native factories are exercised in one live process so process exit cannot hide leaked leases or descriptors. */
import * as fs from "node:fs";
import * as path from "node:path";
import { SessionManager } from "../../../vendor/omp/packages/coding-agent/src/session/session-manager.ts";
import { createExplicitNativeStorage } from "../../../vendor/omp/packages/coding-agent/src/session/generation-storage-factory.ts";
import { tryAcquireSessionLease } from "../../../vendor/omp/packages/coding-agent/src/session/session-storage.ts";
import { serializeTitleSlot } from "../../../vendor/omp/packages/coding-agent/src/session/session-title-slot.ts";

const home = process.env.HOME, file = process.env.OMP_STRICT_FAULT_TARGET, mode = process.argv[2];
if (!home?.startsWith("/tmp/strict-factory-") || !file?.startsWith(home + "/")) throw new Error("SYNTHETIC_HOME_REQUIRED");
const cwd = path.join(home, "project"), id = mode === "create-held" ? "../native-header/会话" : "native-0000";
function descriptors(): string[] {
  return fs.readdirSync("/proc/self/fd").flatMap(name => {
    try { const target = fs.readlinkSync(`/proc/self/fd/${name}`); return target.startsWith(home + "/") ? [target] : []; }
    catch { return []; }
  }).sort();
}
const before = descriptors();
const held = mode === "create-held" ? tryAcquireSessionLease(id) : undefined;
if (mode === "create-held" && !held) throw new Error("FIXTURE_OWNERSHIP_REQUIRED");
const body = serializeTitleSlot({ title: "Fixture", updatedAt: "2026-01-01T00:00:00.000Z" })
  + JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd }) + "\n";
let error: string | undefined;
try {
  if (mode.startsWith("create-")) {
    const storage = createExplicitNativeStorage(file, body, cwd);
    await storage.releaseSessionOwnership();
  } else {
    const manager = await SessionManager.open(file);
    await manager.close();
  }
} catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
held?.release();
const lease = tryAcquireSessionLease(id), reacquired = lease !== null;
lease?.release();
console.log(JSON.stringify({ error, reacquired, descriptorsUnchanged: JSON.stringify(before) === JSON.stringify(descriptors()),
  exists: fs.existsSync(file) }));
