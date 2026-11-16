import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("native read-only catalog discovers actual header cwd without ordinary Session startup", async () => {
  const home = await mkdtemp(join(tmpdir(), "omp-catalog-"));
  try {
    const bucket = join(home, ".omp/agent/sessions/--misleading--");
    await mkdir(bucket, { recursive: true });
    await Bun.write(join(bucket, "a.jsonl"), JSON.stringify({type:"session",version:3,id:"native-a",
      timestamp:"2026-01-01T00:00:00.000Z",cwd:"/recorded/project",title:"Native title"}) + "\n");
    const child = Bun.spawn([process.execPath, "--no-env-file", "vendor/omp/packages/coding-agent/src/cli.ts", "--rpc-catalog"], {
      env: { HOME: home }, stdin:"pipe", stdout:"pipe", stderr:"pipe",
    });
    const deadline = setTimeout(() => child.kill("SIGKILL"), 3000);
    child.stdin.write('{"id":"n","type":"negotiate_protocol","protocolVersion":2}\n');
    child.stdin.write('{"id":"p","type":"catalog_page","pageSize":32}\n');
    child.stdin.end();
    const output = await new Response(child.stdout).text();
    const exit = await child.exited;
    clearTimeout(deadline);
    expect(exit).toBe(0);
    const result = output.trim().split("\n").map(line => JSON.parse(line)).find(frame => frame.id === "p");
    expect(result?.data?.items?.[0]?.nativeSessionId).toBe("native-a");
    expect(result.data.items[0].cwd).toEqual({recorded:"/recorded/project",status:"missing"});
    expect(result.data.items[0].title).toBe("Native title");
  } finally { await rm(home, {recursive:true, force:true}); }
});
