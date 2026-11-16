import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { nativeFixture, filesystemManifest } from "../catalog/fixture.ts";
import { strictWorker, selectedDescriptor, isolatedRuntimeArgs, negotiateStrict } from "./worker.ts";

test("baseline TUI refuses the new carrier and matched TUI renders and continues the same native data", async () => {
  const home = await mkdtemp(join(tmpdir(), "strict-tui-"));
  try {
    const root = await nativeFixture(home), file = join(root, "bucket/native-0000.jsonl");
    const selected = await selectedDescriptor(home), cwd = join(home, "project"), worker = strictWorker(home, cwd, isolatedRuntimeArgs);
    try {
      await negotiateStrict(worker);
      expect(await worker.request({ type: "strict_start", intent: "continue", reference: selected.reference, expectedCwd: cwd }))
        .toMatchObject({ success: true });
      expect(await worker.request({ type: "set_session_name", name: "Native generation title" })).toMatchObject({ success: true });
      expect((await worker.close()).code).toBe(0);
    } finally { worker.child.kill(); await worker.child.exited; }
    const before = await filesystemManifest(root);
    for (const mode of ["baseline", "matched"]) {
      const probe = Bun.spawn([Bun.which("python3") ?? "/usr/bin/python3", resolve("tests/continuation/tui-probe.py"), home, file, mode, process.execPath],
        { cwd: resolve("."), env: { PATH: "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe" });
      const [output, errors, code] = await Promise.all([new Response(probe.stdout).text(), new Response(probe.stderr).text(), probe.exited]);
      if (code) throw new Error(`Native PTY probe failed: ${errors}`);
      expect(JSON.parse(output)).toMatchObject(mode === "baseline" ? { invalidHeader: true } : { historyRendered: true, explicitRename: true });
      if (mode === "baseline") expect(await filesystemManifest(root)).toEqual(before);
    }
    const latest = await selectedDescriptor(home);
    expect(latest).toMatchObject({ instanceId: selected.instanceId, nativeSessionId: "native-0000", title: "Matched TUI continued title" });
  } finally { await rm(home, { recursive: true, force: true }); }
}, 60000);

test("a genuine native TUI retains ownership when strict public continuation is refused", async () => {
  const home = await mkdtemp(join(tmpdir(), "strict-tui-owner-"));
  try {
    const root = await nativeFixture(home), file = join(root,"bucket/native-0000.jsonl"), cwd=join(home,"project");
    const original=await selectedDescriptor(home),prepare=strictWorker(home,cwd,isolatedRuntimeArgs);
    try {await negotiateStrict(prepare);expect(await prepare.request({type:"strict_start",intent:"continue",reference:original.reference,expectedCwd:cwd})).toMatchObject({success:true});expect(await prepare.request({type:"set_session_name",name:"Owned native TUI generation"})).toMatchObject({success:true});await prepare.close();}
    finally{prepare.child.kill();await prepare.child.exited;}
    const owner=Bun.spawn([Bun.which("python3")??"/usr/bin/python3",resolve("tests/continuation/tui-probe.py"),home,file,"hold",process.execPath],
      {cwd:resolve("."),env:{PATH:"/usr/bin:/bin"},stdin:"pipe",stdout:"pipe",stderr:"pipe"});
    try {
      const reader=owner.stdout.getReader();const ready=await reader.read();expect(new TextDecoder().decode(ready.value)).toContain("owned-native-tui-holding");
      let selected=await selectedDescriptor(home);
      for(let attempt=0;attempt<20 && selected.ownership.state!=="held";attempt++){await new Promise(resolve=>setTimeout(resolve,100));selected=await selectedDescriptor(home);}
      expect(selected.ownership.state).toBe("held");
      const before=await filesystemManifest(root),candidate=strictWorker(home,cwd,isolatedRuntimeArgs);
      try{await negotiateStrict(candidate);expect(await candidate.request({type:"strict_start",intent:"continue",reference:selected.reference,expectedCwd:cwd})).toMatchObject({success:false,code:"STRICT_OCCUPIED"});expect(await filesystemManifest(root)).toEqual(before);expect(owner.exitCode).toBeNull();await candidate.close();}
      finally{candidate.child.kill();await candidate.child.exited;}
      owner.stdin.write("release\n");owner.stdin.end();expect(await owner.exited).toBe(0);reader.releaseLock();
    } finally {owner.kill();await owner.exited;}
  } finally {await rm(home,{recursive:true,force:true});}
},30_000);
