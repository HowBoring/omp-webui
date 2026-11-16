import { expect, test } from "bun:test";
import { mkdtemp, rm, readdir, readFile, writeFile, chmod, appendFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { nativeFixture } from "../catalog/fixture.ts";
import { strictWorker, selectedDescriptor, negotiateStrict, isolatedRuntimeArgs } from "./worker.ts";

async function probe(home: string, file: string, mode: string, fault?: string) {
  const child = Bun.spawn([...(fault ? ["python3", resolve("tests/continuation/syscall-faults.py")] : []),
    process.execPath, "--no-env-file", "--preload", resolve("compatibility/omp/fixtures/no-provider.ts"),
    resolve("compatibility/omp/fixtures/factory-cleanup.ts"), mode], { cwd: join(home, "project"),
    env: { HOME: home, TMPDIR: home, PATH: "/usr/bin:/bin", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
      PI_TEST_SESSION_OWNERS_DIR: join(home, "shared-test-owners"), OMP_STRICT_FIXTURE_HOME: home,
      OMP_STRICT_FAULT_TARGET: file, ...(fault ? { OMP_STRICT_FAULT: fault } : {}) }, stdout: "pipe", stderr: "pipe" });
  const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code) throw new Error(errors || `Native factory exited ${code}`);
  return JSON.parse(output);
}

test("a corrupt committed body fails native open and releases ownership and all anchored descriptors", async () => {
  const home = await mkdtemp(join(tmpdir(), "strict-factory-"));
  try {
    const root = await nativeFixture(home), file = join(root, "bucket/native-0000.jsonl"), cwd = join(home, "project");
    await appendFile(file, JSON.stringify({type:"custom",id:"padding",parentId:"entry-0",timestamp:"2026-01-01T00:00:02Z",
      customType:"fixture-padding",data:"x".repeat(32_768)}) + "\n");
    const selected = await selectedDescriptor(home), worker = strictWorker(home, cwd, isolatedRuntimeArgs);
    try {
      await negotiateStrict(worker);
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd })).toMatchObject({success:true});
      expect(await worker.request({type:"set_session_name",name:"Committed before corruption"})).toMatchObject({success:true});
      await worker.close();
    } finally { worker.child.kill(); await worker.child.exited; }
    const directory = join(root,"bucket/.native-0000.jsonl.omp-generations");
    const generation = (await readdir(directory)).find(name => name.endsWith(".gen"));
    if (!generation) throw new Error("FIXTURE_GENERATION_REQUIRED");
    const target = join(directory,generation), bytes = await readFile(target); bytes[20_000] = 121;
    await chmod(target,0o600); await writeFile(target,bytes);
    expect(await probe(home,file,"open-corrupt")).toMatchObject({ error:"GENERATION_CONTENT_CORRUPT", reacquired:true,
      descriptorsUnchanged:true, exists:true });
  } finally { await rm(home,{recursive:true,force:true}); }
},20_000);

test("explicit native creation meets the central lease for an untrusted header ID", async () => {
  const home = await mkdtemp(join(tmpdir(),"strict-factory-"));
  try {
    await mkdir(join(home,"project"));
    expect(await probe(home,join(home,"new.jsonl"),"create-held")).toMatchObject({ error:"STRICT_OCCUPIED", reacquired:true,
      descriptorsUnchanged:true, exists:false });
  } finally { await rm(home,{recursive:true,force:true}); }
});

test("real parent-open EMFILE releases the lease acquired for explicit native creation", async () => {
  const home = await mkdtemp(join(tmpdir(),"strict-factory-"));
  try {
    await mkdir(join(home,"project"));
    expect(await probe(home,join(home,"new.jsonl"),"create-parent","native-parent-emfile")).toMatchObject({
      reacquired:true, descriptorsUnchanged:true, exists:false });
    expect(await Bun.file(join(home,"strict-syscalls.log")).text()).toContain('"returned":-24');
  } finally { await rm(home,{recursive:true,force:true}); }
},20_000);

test("a replacement after reservation construction rejects native open and releases the owned parent descriptor", async () => {
  const home = await mkdtemp(join(tmpdir(),"strict-factory-"));
  try {
    const root = await nativeFixture(home), file = join(root,"bucket/native-0000.jsonl"), cwd=join(home,"project");
    const selected=await selectedDescriptor(home),worker=strictWorker(home,cwd,isolatedRuntimeArgs);
    try {
      await negotiateStrict(worker);
      expect(await worker.request({type:"strict_start",intent:"continue",reference:selected.reference,expectedCwd:cwd})).toMatchObject({success:true});
      expect(await worker.request({type:"set_session_name",name:"Before replacement"})).toMatchObject({success:true});
      await worker.close();
    } finally { worker.child.kill(); await worker.child.exited; }
    const replacement=(await Bun.file(file).text()).replaceAll("native-0000","foreign-0000");
    await writeFile(file+".replacement",replacement);
    expect(await probe(home,file,"open-replaced","swap-after-reservation-parent")).toMatchObject({
      error:"STRICT_REPLACED", reacquired:true, descriptorsUnchanged:true, exists:true });
    expect(await Bun.file(file).text()).toBe(replacement);
    expect(await Bun.file(join(home,"strict-syscalls.log")).text()).toContain('"boundary":"open-directory-return"');
  } finally { await rm(home,{recursive:true,force:true}); }
},30_000);
