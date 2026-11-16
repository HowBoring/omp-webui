import { createFetchHandler } from "./http.ts";
import { openBrowserAccess } from "../../../packages/access/index.ts";
import { resolve } from "node:path";

const hostname = process.env.OMP_WEB_HOST ?? "127.0.0.1";
if (hostname !== "127.0.0.1" && hostname !== "::1") {
  throw new Error("The scaffold only permits loopback binding.");
}

const port = Number(process.env.OMP_WEB_PORT ?? "3180");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("OMP_WEB_PORT must be an integer between 1 and 65535.");
}

const certPath = process.env.OMP_WEB_TLS_CERT;
const keyPath = process.env.OMP_WEB_TLS_KEY;
if (!!certPath !== !!keyPath) throw new Error("TLS requires both certificate and key.");
const tls = certPath && keyPath ? { cert: Bun.file(certPath), key: Bun.file(keyPath) } : undefined;
const authority = hostname === "::1" ? `[::1]:${port}` : `${hostname}:${port}`;
const access = openBrowserAccess({
  dataDir: resolve(process.env.OMP_WEB_DATA_DIR ?? ".data"),
  origin: `${tls ? "https" : "http"}://${authority}`,
});
if (process.argv.includes("--print-bootstrap")) {
  // Explicit local control-plane command. Never include this in routine startup/access logs.
  process.stdout.write(access.bootstrapLink() + "\n");
  access.close();
  process.exit(0);
}

const server = Bun.serve({
  hostname,
  port,
  ...(tls ? { tls } : {}),
  fetch: createFetchHandler(access),
});

console.info("[omp-webui] Host listening on " + server.url.origin + " (private capabilities gated)");
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { access.close(); void server.stop(true); });
}
