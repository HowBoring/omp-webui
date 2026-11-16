import { startHistoryFixture } from "./server.ts";
const fixture = await startHistoryFixture({ port: Number(process.env.OMP_HISTORY_FIXTURE_PORT ?? 3184) });
console.log(JSON.stringify({ kind: "synthetic-history-only", pid: process.pid, url: fixture.server.url.origin, sessionAdmission: "blocked" }));
process.on("SIGTERM", () => { void fixture.stop().finally(() => process.exit(0)); });
process.on("SIGINT", () => { void fixture.stop().finally(() => process.exit(0)); });
