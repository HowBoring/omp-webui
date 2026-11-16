import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFetchHandler } from "../../apps/host/src/http.ts";
import { openBrowserAccess } from "../../packages/access/index.ts";

let dispose = async () => {};
afterEach(async () => { await dispose(); });

function localRequest(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("host", new URL(url).host);
  return new Request(url, { ...init, headers });
}

test("Host serves login but private API stays closed independently of browser authorization", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "omp-access-host-"));
  const access = openBrowserAccess({ dataDir, origin: "http://127.0.0.1:3180" });
  dispose = async () => { access.close(); await rm(dataDir, { recursive: true, force: true }); };
  const handler = createFetchHandler(access);
  expect((await handler(localRequest("http://127.0.0.1:3180/"))).status).toBe(200);
  expect((await handler(localRequest("http://127.0.0.1:3180/api/session/list"))).status).toBe(401);
  const login = await handler(localRequest(access.bootstrapLink()));
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const gated = await handler(localRequest("http://127.0.0.1:3180/api/session/list", { headers: { cookie } }));
  expect(gated.status).toBe(503);
  expect(await gated.json()).toEqual({ error: { code: "PRIVATE_CAPABILITY_GATE_CLOSED" } });
  expect((await handler(new Request("http://evil.example/healthz"))).status).toBe(403);
});
