/** Owned actual built Host + Chromium proof. Every success/failure path waits for its owned process exit. */
export {};

const child = Bun.spawn([process.execPath, "--no-env-file", "vendor/host-sessions/session-component-main.js"], {
  cwd: process.cwd(), env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, stdout: "pipe", stderr: "inherit" });
const reader = child.stdout.getReader();
let ready = "";
const timer = setTimeout(() => child.kill("SIGTERM"), 15_000);
try {
  while (!ready.includes("\n")) {
    const chunk = await reader.read(); if (chunk.done) throw new Error("SESSION_BROWSER_HOST_NOT_READY");
    ready += new TextDecoder().decode(chunk.value); if (ready.length > 4096) throw new Error("SESSION_HOST_READY_LIMIT");
  }
  clearTimeout(timer); reader.releaseLock();
  const browser = Bun.spawn(["python3", "tests/sessions/browser.py"], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    stdout: "inherit", stderr: "inherit" });
  if (await browser.exited !== 0) throw new Error("SESSION_BROWSER_FAILED");
} finally {
  clearTimeout(timer); child.kill("SIGTERM");
  const exit = await child.exited;
  if (exit !== 0) throw new Error("SESSION_BROWSER_HOST_EXIT_FAILED");
}
