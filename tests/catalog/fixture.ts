/** Synthetic native fixture authoring only. Product Host never imports this file. */
import { mkdir, readdir, lstat, readlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
export async function nativeFixture(home:string,count=1,profile?:string,buckets=1):Promise<string> {
  const root = join(home,".omp",...(profile ? ["profiles",profile]:[]),"agent/sessions");
  await mkdir(join(root,"bucket"),{recursive:true});
  await mkdir(join(home,"project"),{recursive:true});
  const slots = await nativeTitleSlots(Array.from({ length: count }, (_, index) => `Native Session ${index}`), home);
  for (let index=0; index<count; index++) {
    const id = `native-${String(index).padStart(4,"0")}`;
    const bucket = buckets === 1 ? "bucket" : `bucket-${String(index % buckets).padStart(4,"0")}`;
    await mkdir(join(root,bucket),{recursive:true});
    await Bun.write(join(root,bucket,`${id}.jsonl`),slots[index]+JSON.stringify({type:"session",version:3,id,
      timestamp:"2026-01-01T00:00:00.000Z",cwd:join(home,"project"),title:`Native Session ${index}`}) + "\n"
      + JSON.stringify({type:"message",id:`entry-${index}`,parentId:null,timestamp:"2026-01-01T00:00:01.000Z",
        message:{role:"user",content:[{type:"text",text:"Synthetic fixture input"}],timestamp:1767225601000}}) + "\n");
  }
  return root;
}
export async function filesystemManifest(root:string):Promise<Record<string,string>> {
  const result:Record<string,string> = {};
  for (const path of ["",...await readdir(root,{recursive:true})].sort()) {
    const full = join(root,path), info = await lstat(full,{bigint:true});
    const contents = info.isFile() ? await Bun.file(full).arrayBuffer() : info.isSymbolicLink() ? await readlink(full):"";
    const hash = createHash("sha256").update(typeof contents === "string" ? contents:Buffer.from(contents)).digest("hex");
    result[path] = `${info.mode}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${hash}`;
  }
  return result;
}

/** Fixture authoring only: actual pinned native SessionManager owns these deliberate writes before readonly checks. */
export async function sessionManagerFixture(home: string): Promise<{ emptyFile: string; emptyId: string; titledFile: string; id: string }> {
  const cwd = join(home, "project");
  await mkdir(cwd, { recursive: true });
  const module = new URL("../../vendor/omp/packages/coding-agent/src/session/session-manager.ts", import.meta.url).pathname;
  const child = Bun.spawn([process.execPath, "--no-env-file", "-e", `
    import { SessionManager } from ${JSON.stringify(module)};
    const cwd = ${JSON.stringify(cwd)};
    const emptyFile = SessionManager.createEmptySessionFile(cwd);
    const emptyId = JSON.parse((await Bun.file(emptyFile).text()).split("\\n")[1]).id;
    const manager = SessionManager.create(cwd);
    await manager.ensureOnDisk();
    manager.appendMessage({role:"user",content:"Synthetic native fixture only",timestamp:1767225601000});
    await manager.setSessionName("Actual native slot title", "user");
    await manager.flush();
    const titledFile = manager.getSessionFile(), id = manager.getSessionId();
    await manager.close();
    process.stdout.write(JSON.stringify({emptyFile,emptyId,titledFile,id}));
  `], { env: { HOME: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [output, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (code !== 0 || stderr) throw new Error(`NATIVE_FIXTURE_AUTHORING_FAILED: ${stderr.slice(0, 512)}`);
  const value: unknown = JSON.parse(output);
  if (typeof value !== "object" || value === null || !("emptyFile" in value) || typeof value.emptyFile !== "string"
    || !("emptyId" in value) || typeof value.emptyId !== "string"
    || !("titledFile" in value) || typeof value.titledFile !== "string" || !("id" in value) || typeof value.id !== "string") {
    throw new Error("NATIVE_FIXTURE_AUTHORING_RESULT");
  }
  return { emptyFile: value.emptyFile, emptyId: value.emptyId, titledFile: value.titledFile, id: value.id };
}

/** Pure authoritative serializer in a child, avoiding any native runtime import into Host/test module graphs. */
export async function nativeTitleSlots(titles: string[], home = "/tmp"): Promise<string[]> {
  const module = new URL("../../vendor/omp/packages/coding-agent/src/session/session-title-slot.ts", import.meta.url).pathname;
  const guard = new URL("../../compatibility/omp/fixtures/no-provider.ts", import.meta.url).pathname;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, "-e", `
    import { serializeTitleSlot } from ${JSON.stringify(module)};
    const titles = JSON.parse(await Bun.stdin.text());
    process.stdout.write(JSON.stringify(titles.map(title => serializeTitleSlot({title,source:"user",updatedAt:"2026-01-01T00:00:00Z"}))));
  `], { env: { HOME: home, TMPDIR: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  child.stdin.write(JSON.stringify(titles)); child.stdin.end();
  const [output, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (code !== 0 || stderr) throw new Error("NATIVE_SLOT_FIXTURE_AUTHORING_FAILED");
  const slots: unknown = JSON.parse(output);
  if (!Array.isArray(slots) || slots.some(slot => typeof slot !== "string")) throw new Error("NATIVE_SLOT_FIXTURE_RESULT");
  return slots;
}
