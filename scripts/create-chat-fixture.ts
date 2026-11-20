import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { nativeFixture } from "../tests/catalog/fixture.ts";
const home = resolve("vendor/chat-fixture");
await rm(home, { recursive: true, force: true });
await mkdir(home, { recursive: true });
await nativeFixture(home, 3);
// Authoring-only native writes: one Session whose retained segments carry a real compaction and reset boundary.
const sessionManager = new URL("../vendor/omp/packages/coding-agent/src/session/session-manager.ts", import.meta.url).pathname;
const authored = Bun.spawn([process.execPath, "--no-env-file", "-e", `
  import { SessionManager } from ${JSON.stringify(sessionManager)};
  const manager = SessionManager.create(${JSON.stringify(resolve(home, "project"))});
  await manager.ensureOnDisk();
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "Earlier retained question" }], timestamp: 1767225601000 });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Earlier retained answer" }], timestamp: 1767225602000 });
  const kept = manager.appendMessage({ role: "user", content: [{ type: "text", text: "Before reset" }], timestamp: 1767225603000 });
  manager.appendCompaction("Synthetic native summary", undefined, kept, 120);
  manager.appendResetBoundary();
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "Current question" }], timestamp: 1767225604000 });
  await manager.setSessionName("Native Tree Session", "user");
  await manager.flush();
  await manager.close();
`], { env: { HOME: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
const [authoredOut, authoredErr, authoredCode] = await Promise.all([
  new Response(authored.stdout).text(), new Response(authored.stderr).text(), authored.exited,
]);
if (authoredCode !== 0 || authoredErr) throw new Error(`NATIVE_TREE_FIXTURE_AUTHORING_FAILED: ${authoredErr.slice(0, 512)}`);
void authoredOut;
// The live-provider profile uses PI_CODING_AGENT_DIR=home, so Native Sessions live at home/sessions.
await rename(resolve(home, ".omp/agent/sessions"), resolve(home, "sessions"));
await writeFile(resolve(home, "fixture-marker.json"), JSON.stringify({ kind: "S2-synthetic-chat-fixture", privateData: false }) + "\n");
const attachmentHome = resolve("vendor/chat-attachment-fixture");
await rm(attachmentHome, { recursive: true, force: true });
await cp(home, attachmentHome, { recursive: true });
await mkdir(resolve(attachmentHome, ".omp/agent"), { recursive: true });
await cp(resolve(home, "sessions"), resolve(attachmentHome, ".omp/agent/sessions"), { recursive: true });
console.info("Synthetic native Chat fixture prepared.");
