import { createFetchHandler } from "./http.ts";

const hostname = process.env.OMP_WEB_HOST ?? "127.0.0.1";
if (hostname !== "127.0.0.1" && hostname !== "::1") {
  throw new Error("The scaffold only permits loopback binding.");
}

const port = Number(process.env.OMP_WEB_PORT ?? "3180");
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error("OMP_WEB_PORT must be an integer between 0 and 65535.");
}

const server = Bun.serve({
  hostname,
  port,
  fetch: createFetchHandler(),
});

console.info("[omp-webui] scaffold Host listening on " + server.url.toString());
