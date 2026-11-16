import { test,expect } from "bun:test";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";

test("native child preload rejects every audited provider network entry before dispatch",async()=>{
  const home=await mkdtemp(join(tmpdir(),"omp-network-deny-"));
  const child=Bun.spawn([process.execPath,"--no-env-file","--preload",resolve("tests/interactions/no-provider.ts"),
    resolve("tests/interactions/network-guard.ts")],{cwd:home,env:{HOME:home,PI_CODING_AGENT_DIR:join(home,"profile")},
    stdout:"pipe",stderr:"pipe"});
  try {
    const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    expect({code,stderr}).toMatchObject({code:0});expect(stdout).toBe("network-guard: 15 denied, 0 dispatched\n");
    expect(stderr.trim().split("\n")).toHaveLength(15);
    expect(stderr.trim().split("\n").every(line=>line.startsWith("S0_FIXTURE_NETWORK_DENIED:"))).toBe(true);
  } finally {child.kill();await rm(home,{recursive:true,force:true});}
});
