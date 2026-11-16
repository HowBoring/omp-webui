import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("actual candidate launcher preflight uses isolated protocol without touching a user profile", async () => {
  const profile = await mkdtemp(join(tmpdir(), "omp-s0-profile-"));
  try {
    const child = Bun.spawn([process.execPath, "--no-env-file", "vendor/omp-candidate/cli.js", "--rpc-preflight"], {
      env: { HOME: profile, PI_CODING_AGENT_DIR: profile }, stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    child.stdin.write('{"id":"n","type":"negotiate_protocol","protocolVersion":2}\n');
    child.stdin.write('{"id":"c","type":"get_compatibility"}\n');
    child.stdin.end();
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(output).toContain('"safePreflight":true');
    expect(output).toContain('"sessionAdmission":"blocked"');
    expect(await new Response(child.stderr).text()).toBe("");
    expect(await readdir(profile)).toEqual([]);
  } finally { await rm(profile, { recursive: true, force: true }); }
});

test("preflight mixed with Session/UI arguments is rejected before ordinary CLI startup", async () => {
  const profile = await mkdtemp(join(tmpdir(), "omp-s0-unsafe-args-"));
  try {
    const child = Bun.spawn([process.execPath, "--no-env-file", "vendor/omp-candidate/cli.js",
      "--rpc-preflight", "--mode", "rpc-ui"], {
      env: { HOME: profile, PI_CODING_AGENT_DIR: profile }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    expect(await child.exited).toBe(2);
    expect(await new Response(child.stdout).text()).toBe("");
    expect(await readdir(profile)).toEqual([]);
  } finally { await rm(profile, { recursive: true, force: true }); }
});
