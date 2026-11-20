import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { nativeFixture } from "../tests/catalog/fixture.ts";
const home = resolve("vendor/chat-fixture");
await rm(home, { recursive: true, force: true });
await mkdir(home, { recursive: true });
await nativeFixture(home, 3);
// The live-provider profile uses PI_CODING_AGENT_DIR=home, so Native Sessions live at home/sessions.
await rename(resolve(home, ".omp/agent/sessions"), resolve(home, "sessions"));
await writeFile(resolve(home, "fixture-marker.json"), JSON.stringify({ kind: "S2-synthetic-chat-fixture", privateData: false }) + "\n");
const attachmentHome = resolve("vendor/chat-attachment-fixture");
await rm(attachmentHome, { recursive: true, force: true });
await cp(home, attachmentHome, { recursive: true });
await mkdir(resolve(attachmentHome, ".omp/agent"), { recursive: true });
await cp(resolve(home, "sessions"), resolve(attachmentHome, ".omp/agent/sessions"), { recursive: true });
console.info("Synthetic native Chat fixture prepared.");
