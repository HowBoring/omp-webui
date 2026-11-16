import type { Subprocess } from "bun";
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildControlledLauncher } from "../../scripts/build-controlled-launcher.ts";
import { acquireMaintenanceLease } from "../../packages/delivery/maintenance.ts";
import { launcherFixture } from "./launcher-fixture.ts";

test("ordinary controlled entry preserves PID and its maintenance lock across exec into actual Bun", async () => {
  const fixture = await launcherFixture();
  let child: Subprocess<"pipe", "pipe", "pipe"> | undefined;
  try {
    child = Bun.spawn([fixture.entry, "--mode", "rpc-ui"], {
      env: {}, cwd: fixture.cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    const line = await child.stdout.getReader().read();
    if (line.done) throw new Error(`exit ${await child.exited}: ${await new Response(child.stderr).text()}`);
    expect(JSON.parse(new TextDecoder().decode(line.value))).toEqual({ pid: child.pid, args: ["--mode", "rpc-ui"] });
    await expect(acquireMaintenanceLease(fixture.control, "update")).rejects.toThrow("MAINTENANCE_UNAVAILABLE");
    child.stdin.end();
    expect(await child.exited).toBe(0);
    const update = await acquireMaintenanceLease(fixture.control, "update");
    try {
      const denied = Bun.spawn([fixture.entry], { env: {}, stdout: "pipe", stderr: "pipe" });
      expect(await denied.exited).toBe(73);
      expect(await new Response(denied.stdout).text()).toBe("");
    } finally { await update.release(); }
  } finally {
    if (child !== undefined && child.exitCode === null) child.kill();
    if (child !== undefined) await child.exited;
    await fixture.cleanup();
  }
});

test("reviewed single-argument Bun config suppresses synthetic cwd HOME and XDG preload discovery", async () => {
  const fixture = await launcherFixture();
  try {
    const home = join(fixture.parent, "home");
    const xdg = join(fixture.parent, "xdg");
    await mkdir(home);
    await mkdir(xdg);
    const preload = `preload = [${JSON.stringify(join(fixture.cwd, "unreviewed.ts"))}]\n`;
    await writeFile(join(fixture.cwd, "unreviewed.ts"), 'console.log("UNREVIEWED PRELOAD");\n');
    for (const path of [join(fixture.cwd, "bunfig.toml"), join(home, ".bunfig.toml"),
      join(xdg, ".bunfig.toml"), join(xdg, "bunfig.toml")]) await writeFile(path, preload);
    const child = Bun.spawn([fixture.entry], { env: { HOME: home, XDG_CONFIG_HOME: xdg },
      cwd: fixture.cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(0);
    expect(JSON.parse(await new Response(child.stdout).text())).toEqual({ pid: child.pid, args: [] });
  } finally { await fixture.cleanup(); }
});

test("controlled entry refuses runtime injection options before actual Bun executes", async () => {
  const fixture = await launcherFixture();
  try {
    for (const name of ["BUN_OPTIONS", "NODE_OPTIONS", "BUN_INSPECT", "LD_PRELOAD", "LD_LIBRARY_PATH", "LD_AUDIT"]) {
      const child = Bun.spawn([fixture.entry], { env: { [name]: "unreviewed" }, cwd: fixture.cwd,
        stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      expect(await child.exited).toBe(74);
      expect(await new Response(child.stdout).text()).toBe("");
    }
  } finally { await fixture.cleanup(); }
});

test("ordinary entry refuses a replaced control inode before invoking actual Bun", async () => {
  const fixture = await launcherFixture();
  try {
    await rename(fixture.control.path, join(fixture.parent, "original-control.lock"));
    await writeFile(fixture.control.path, "", { mode: 0o600, flag: "wx" });
    const child = Bun.spawn([fixture.entry], { env: {}, cwd: fixture.cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(74);
    expect(await new Response(child.stdout).text()).toBe("");
  } finally { await fixture.cleanup(); }
});

test("launcher build refuses a maintenance inode inside the replaceable release", async () => {
  const root = await mkdtemp(join(tmpdir(), "delivery-unsafe-control-"));
  try {
    await expect(buildControlledLauncher({ root,
      control: { path: join(root, "maintenance.lock"), device: "1", inode: "1" } }))
      .rejects.toThrow("LAUNCHER_CONTROL_INSIDE_RELEASE");
  } finally { await rm(root, { recursive: true, force: true }); }
});
