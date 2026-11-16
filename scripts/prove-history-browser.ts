/** Genuine isolated Bun/DSH/native browser proof with deterministic worker/profile cleanup. */
import { startHistoryFixture } from "../apps/history-fixture/server.ts";
const fixture = await startHistoryFixture({ port: 3184 });
try {
  const browser = Bun.spawn(["python3", "tests/browser/history-browser.py"], {
    env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: fixture.profile },
    stdout: "inherit", stderr: "inherit",
  });
  if (await browser.exited !== 0) throw new Error("HISTORY_BROWSER_PROOF_FAILED");
} finally { await fixture.stop(); }
