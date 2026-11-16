import { resolve } from "node:path";
import { startDiagnosticsServer } from "./diagnostics-server.ts";

const manifest = process.env.OMP_WEB_MANIFEST;
const launcher = process.env.OMP_WEB_LAUNCHER;
if (manifest === undefined || launcher === undefined) {
  throw new Error("Select trusted OMP_WEB_MANIFEST and OMP_WEB_LAUNCHER in Host startup configuration");
}
const port = Number(process.env.OMP_WEB_PORT ?? "3180");
if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("Invalid OMP_WEB_PORT");
const host = await startDiagnosticsServer({ manifest: resolve(manifest), launcher: resolve(launcher), port });
console.info(JSON.stringify({ url: host.server.url.origin, stage: "diagnostics-only", sessionAdmission: "blocked" }));
const stop = () => { void host.stop(); };
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
