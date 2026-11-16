/** Explicit synthetic data authoring only; never imported by a Host service. */
import { rm, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { nativeFixture } from "../tests/catalog/fixture.ts";
const home = resolve("vendor/continuation-profile");
await rm(home, { recursive: true, force: true });
await mkdir(home, { recursive: true, mode: 0o700 });
await nativeFixture(home, 4);
await Bun.write(resolve(home, "fixture-origin.json"), JSON.stringify({ synthetic: true, sessions: 4,
  scenarios: { "native-0000": "available", "native-0001": "external-native-owner", "native-0002": "cancel", "native-0003": "lost-result" } }) + "\n");
console.info("Authored four isolated native fixtures; no real profile or global installation was read.");
