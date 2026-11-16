/** Native data-format boundary fixture. All files, process state and provider guard belong to the test home. */
import * as fs from "node:fs";
import * as path from "node:path";
import { SessionManager } from "../../../vendor/omp/packages/coding-agent/src/session/session-manager.ts";
import { serializeTitleSlot } from "../../../vendor/omp/packages/coding-agent/src/session/session-title-slot.ts";
import { readFileXattr, writeFileXattr } from "../../../vendor/omp/packages/coding-agent/src/utils/file-xattr.ts";

const home = process.env.HOME;
if (!home?.startsWith("/tmp/strict-carrier-")) throw new Error("SYNTHETIC_HOME_REQUIRED");
const file = path.join(home, "native.jsonl"), cwd = path.join(home, "项目");
fs.mkdirSync(cwd);
const overflow = process.argv[2] === "overflow";
// A v1 commit at a nine-digit offset is exactly 273 UTF-8 bytes, including its newline.
const carrierBytes = 256 * 1024 * 1024 - 273 + (overflow ? 1 : 0);
const logical = serializeTitleSlot({ title: "先前标题", source: "user", updatedAt: "2026-01-01T00:00:00.000Z" })
  + JSON.stringify({ type: "session", version: 3, id: "原生会话".repeat(8),
    timestamp: "2026-01-01T00:00:00.000Z", cwd }) + "\n"
  + JSON.stringify({ type: "message", id: "entry-0", parentId: null, timestamp: "2026-01-01T00:00:01.000Z",
    message: { role: "user", content: "Synthetic carrier fixture", timestamp: 1767225601000 } }) + "\n";
const fd = fs.openSync(file, "wx+");
const hash = (value: string | Uint8Array) => Bun.SHA256.hash(value, "hex");
try {
  const stat = fs.fstatSync(fd, { bigint: true });
  const carrier = hash(`${stat.dev}:${stat.ino}:${stat.birthtimeNs}`);
  const token = "11111111-1111-4111-8111-111111111111";
  const offset = carrierBytes - 273;
  const metadata = JSON.stringify({ format: "omp-native-generation", version: 1, token, carrier,
    nativeSessionId: "原生会话".repeat(8), offset, bytes: Buffer.byteLength(logical), sha256: hash(logical),
    prefixBytes: Buffer.byteLength(logical), prefixSha256: hash(logical) });
  const payload = { type: "omp_generation_commit", version: 1, token, offset, metadataSha256: hash(metadata) };
  const record = { ...payload, checksum: hash(JSON.stringify(payload)) };
  const encoded = JSON.stringify(record) + "\n";
  if (Buffer.byteLength(encoded) !== 273) throw new Error("FIXTURE_COMMIT_SIZE_CHANGED");
  const directory = path.join(home, ".native.jsonl.omp-generations");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, `${token}.gen`), logical, { mode: 0o400 });
  fs.writeFileSync(path.join(directory, `${offset}-${token}.meta`), metadata, { mode: 0o400 });
  const physicalHeader = logical.replace('"type":"session"', '"type":"ompgen1"');
  fs.writeSync(fd, physicalHeader, 0, "utf8");
  const chunk = Buffer.alloc(1024 * 1024, 32);
  for (let start = Buffer.byteLength(physicalHeader); start < offset - 1;) {
    const count = Math.min(chunk.length, offset - 1 - start);
    fs.writeSync(fd, chunk, 0, count, start); start += count;
  }
  fs.writeSync(fd, "\n" + encoded, offset - 1, "utf8");
  const head = { version: 1, carrier, current: record };
  writeFileXattr(fd, "user.omp-generation-v1", Buffer.from(JSON.stringify({ ...head, checksum: hash(JSON.stringify(head)) })));
  const before = { digest: hash(fs.readFileSync(file)), head: readFileXattr(fd, "user.omp-generation-v1", 1024)?.toString(),
    names: fs.readdirSync(directory).sort() };
  const manager = await SessionManager.open(file);
  let error: string | undefined;
  try { await manager.setSessionName("完整的原生标题", "user"); }
  catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
  try { await manager.close(); } catch (failure) { error ??= failure instanceof Error ? failure.message : String(failure); }
  const after = { digest: hash(fs.readFileSync(file)), head: readFileXattr(fd, "user.omp-generation-v1", 1024)?.toString(),
    names: fs.readdirSync(directory).sort() };
  let reopenedTitle: string | undefined;
  const reopened = await SessionManager.open(file);
  try { reopenedTitle = reopened.getSessionName(); } finally { await reopened.close(); }
  console.log(JSON.stringify({ error, unchanged: JSON.stringify(before) === JSON.stringify(after),
    size: fs.statSync(file).size, reopenedTitle }));
} finally { fs.closeSync(fd); }
