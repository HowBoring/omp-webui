import { z } from "zod";
import { expect, test } from "bun:test";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeFixture } from "../catalog/fixture.ts";
import { strictWorker, selectedDescriptor, isolatedRuntimeArgs, negotiateStrict } from "./worker.ts";

test("native title publication keeps the selected inode and resolves its complete committed generation", async () => {
  const home = await mkdtemp(join(tmpdir(), "strict-generation-"));
  try {
    const root = await nativeFixture(home), file = join(root, "bucket/native-0000.jsonl");
    const selected = await selectedDescriptor(home), cwd = join(home, "project"), before = await stat(file, { bigint: true });
    const worker = strictWorker(home, cwd, isolatedRuntimeArgs);
    try {
      await negotiateStrict(worker);
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd }))
        .toMatchObject({ success: true });
      expect(await worker.request({ type: "set_session_name", name: "Committed native title" })).toMatchObject({ success: true });
      const after = await stat(file, { bigint: true });
      expect([after.dev, after.ino, after.birthtimeNs]).toEqual([before.dev, before.ino, before.birthtimeNs]);
      expect(await readFile(file, "utf8")).toContain('"type":"ompgen1"');
      expect(await worker.request({ type: "get_state" })).toMatchObject({ success: true,
        data: { sessionId: "native-0000", sessionName: "Committed native title" } });
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
    const refreshed = await selectedDescriptor(home);
    expect(refreshed).toMatchObject({ instanceId: selected.instanceId, nativeSessionId: "native-0000", title: "Committed native title" });
    const reopened = strictWorker(home, cwd, isolatedRuntimeArgs);
    try {
      await negotiateStrict(reopened);
      expect(await reopened.request({ type: "strict_start", intent: "continue", reference: refreshed.reference, expectedCwd: cwd }))
        .toMatchObject({ success: true });
      expect(await reopened.request({ type: "get_state" })).toMatchObject({ data: { sessionName: "Committed native title" } });
      expect((await reopened.close()).code).toBe(0);
    } finally { reopened.child.kill(); await reopened.child.exited; }
  } finally { await rm(home, { recursive: true, force: true }); }
}, 20000);

for (const operation of ["fork", "branch", "new_session"] as const) test(`native explicit ${operation} remains distinct from strict continuation`, async () => {
  const home = await mkdtemp(join(tmpdir(), "strict-native-transition-"));
  try {
    const root = await nativeFixture(home), file = join(root, "bucket/native-0000.jsonl"), cwd = join(home, "project");
    const selected = await selectedDescriptor(home), setup = strictWorker(home, cwd, isolatedRuntimeArgs);
    try {
      await negotiateStrict(setup);
      expect(await setup.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd }))
        .toMatchObject({ success: true });
      expect(await setup.request({ type: "set_session_name", name: "Generation transition origin" })).toMatchObject({ success: true });
      expect((await setup.close()).code).toBe(0);
    } finally { setup.child.kill(); await setup.child.exited; }
    const native = strictWorker(home, cwd, isolatedRuntimeArgs, file);
    try {
      await negotiateStrict(native);
      expect(await native.request({ type: "get_state" })).toMatchObject({ data: { sessionId: "native-0000" } });
      const command = operation === "branch" ? { type: operation, entryId: "entry-0" } : { type: operation };
      expect(await native.request(command)).toMatchObject({ success: true, data: { cancelled: false } });
      const state = await native.request({ type: "get_state" });
      const value = z.object({ sessionId: z.string().uuid(), sessionFile: z.string() }).parse(state.data);
      expect(value.sessionId).not.toBe("native-0000");
      expect(value.sessionFile).not.toBe(file);
      if (operation === "fork") expect(await native.request({ type: "get_entries" })).toMatchObject({ data: {
        entries: expect.arrayContaining([expect.objectContaining({ id: "entry-0" })]),
      } });
      expect((await native.close()).code).toBe(0);
    } finally { native.child.kill(); await native.child.exited; }
  } finally { await rm(home, { recursive: true, force: true }); }
}, 20000);

test("matched native tree navigation keeps the same identity and renders a logical export",async()=>{
 const home=await mkdtemp(join(tmpdir(),"strict-native-tree-"));
 try{const root=await nativeFixture(home),file=join(root,"bucket/native-0000.jsonl"),cwd=join(home,"project"),selected=await selectedDescriptor(home),setup=strictWorker(home,cwd,isolatedRuntimeArgs);
  try{await negotiateStrict(setup);expect(await setup.request({type:"strict_start",intent:"continue",reference:selected.reference,expectedCwd:cwd})).toMatchObject({success:true});expect(await setup.request({type:"set_session_name",name:"Native navigation generation"})).toMatchObject({success:true});await setup.close();}finally{setup.child.kill();await setup.child.exited;}
  const native=strictWorker(home,cwd,isolatedRuntimeArgs,file);
  try{await negotiateStrict(native);expect(await native.request({type:"get_tree"})).toMatchObject({success:true});
   expect(await native.request({type:"navigate_tree",entryId:"entry-0",summarize:false})).toMatchObject({success:true,data:{cancelled:false}});
   expect(await native.request({type:"get_state"})).toMatchObject({success:true,data:{sessionId:"native-0000",sessionFile:file}});
   expect(await native.request({type:"get_entries"})).toMatchObject({data:{entries:expect.arrayContaining([expect.objectContaining({id:"entry-0"})])}});
   expect((await native.close()).code).toBe(0);
  }finally{native.child.kill();await native.child.exited;}
  const rendered=Bun.spawn([process.execPath,"--no-env-file","--preload",new URL("../../compatibility/omp/fixtures/no-provider.ts",import.meta.url).pathname,new URL("../../vendor/omp-candidate/cli.js",import.meta.url).pathname,"render",file,"--plain"],{cwd,env:{HOME:home,TMPDIR:home,PATH:"/usr/bin:/bin",BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0"},stdin:"ignore",stdout:"pipe",stderr:"pipe"});
  const [output,errors,code]=await Promise.all([new Response(rendered.stdout).text(),new Response(rendered.stderr).text(),rendered.exited]);if(code)throw new Error(errors);expect(output).toContain("Synthetic fixture input");expect(output).not.toContain("omp_generation_commit");
  expect((await selectedDescriptor(home)).instanceId).toBe(selected.instanceId);
 }finally{await rm(home,{recursive:true,force:true});}
},30_000);
