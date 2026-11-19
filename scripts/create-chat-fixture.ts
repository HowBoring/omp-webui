import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { nativeFixture } from "../tests/catalog/fixture.ts";
const home = resolve("vendor/chat-fixture");
await rm(home, { recursive: true, force: true });
await mkdir(home, { recursive: true });
await nativeFixture(home, 2);
await writeFile(resolve(home, "fixture-marker.json"), JSON.stringify({ kind: "S2-synthetic-chat-fixture", privateData: false }) + "\n");
console.info("Synthetic native Chat fixture prepared.");
