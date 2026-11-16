import { expect, test } from "bun:test";
import { connect } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFetchHandler } from "../../apps/host/src/http.ts";
import { openBrowserAccess } from "../../packages/access/index.ts";
import type { BrowserAuthority } from "../../packages/access/index.ts";

function headersOnly(port: number, headers: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let response = "";
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error("Admission waited for body")); });
    socket.on("error", reject);
    socket.on("data", (data) => {
      response += data.toString();
      if (response.includes("\r\n\r\n")) { socket.destroy(); resolve(response); }
    });
    socket.on("connect", () => socket.write(headers));
  });
}

test("actual HTTP rejects large declared bodies before upload, Remote and history processing", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "omp-admission-"));
  let access: BrowserAuthority;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => createFetchHandler(access)(request) });
  const origin = server.url.origin;
  access = openBrowserAccess({ dataDir, origin });
  try {
    const missingHost = await headersOnly(server.port!, "GET /healthz HTTP/1.1\r\nConnection: close\r\n\r\n");
    expect(/^HTTP\/1\.1 (400|403)/.test(missingHost)).toBe(true);
    const oldProtocol = await headersOnly(server.port!, "GET /healthz HTTP/1.0\r\n\r\n");
    expect(oldProtocol.split("\r\n")[0]).toMatch(/^HTTP\/1\.[01] (400|403)/);
    for (const path of ["remote.mux", "upload/raw", "upload/base64", "history", "download"]) {
      const response = await headersOnly(server.port!, `POST /api/${path} HTTP/1.1\r\nHost: ${server.url.host}\r\n`
        + `Origin: ${origin}\r\nContent-Length: 9000000\r\nConnection: close\r\n\r\n`);
      expect(response.startsWith("HTTP/1.1 401")).toBe(true);
    }
    const response = await headersOnly(server.port!, "POST /api/upload/raw HTTP/1.1\r\nHost: evil.example\r\n"
      + `Origin: ${origin}\r\nContent-Length: 9000000\r\nConnection: close\r\n\r\n`);
    expect(response.startsWith("HTTP/1.1 403")).toBe(true);
    const login = await fetch(access.bootstrapLink(), { redirect: "manual" });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const denied = await headersOnly(server.port!, `POST /api/remote.mux HTTP/1.1\r\nHost: ${server.url.host}\r\n`
      + `Origin: ${origin}\r\nCookie: ${cookie}\r\nContent-Length: 9000000\r\nConnection: close\r\n\r\n`);
    expect(denied.startsWith("HTTP/1.1 403")).toBe(true);
  } finally {
    await server.stop(true); access.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}, 15_000);
