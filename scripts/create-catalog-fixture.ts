/** Explicit test-data authoring tool; never imported by product Host. */
import { mkdir, rm, copyFile, symlink } from "node:fs/promises";
import { resolve,join } from "node:path";
import { nativeFixture } from "../tests/catalog/fixture.ts";
const home = resolve("vendor/catalog-fixture");
await rm(home,{recursive:true,force:true});
const source = await nativeFixture(home,1000,undefined,1000);
const custom = join(home,"custom"); await mkdir(custom);
await Bun.write(join(custom,"unknown.jsonl"),'{"type":"session","version":3,"id":"unknown-cwd","timestamp":"2026-01-01T00:00:00Z","title":"Unknown working directory"}\n');
await copyFile(join(source,"bucket-0000/native-0000.jsonl"),join(custom,"same-id-copy.jsonl"));
await symlink(join(source,"bucket-0000/native-0000.jsonl"),join(source,"bucket-0000/alias.jsonl"));
await Bun.write(join(source,"malformed.jsonl"),"not a native header\n");
console.info(JSON.stringify({kind:"synthetic-native-fixture",home,nativeSessions:1002,buckets:1000,
  customSources:[custom,join(home,"missing-source")],seed:"catalog-v1-1000-cwd"}));
