/** Deliberate authoring of isolated synthetic native data; never imported by product runtime. */
import { resolve, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { nativeFixture } from "../tests/catalog/fixture.ts";
const home = resolve("vendor/sessions-fixture");
await mkdir(home, { recursive: true });
if (await Bun.file(join(home, "fixture-marker.json")).exists()) throw new Error("SESSION_FIXTURE_ALREADY_EXISTS");
await nativeFixture(home, 2);
await Bun.write(join(home, "fixture-marker.json"), JSON.stringify({ kind: "S1-synthetic-session-fixture", privateData: false }));
console.info("Synthetic native fixture prepared. Catalog/startup do not create Sessions.");
