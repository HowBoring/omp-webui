import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBrowserAccess } from "../../packages/access/index.ts";

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });

async function directory() {
  const path = await mkdtemp(join(tmpdir(), "omp-access-"));
  cleanup.push(() => rm(path, { recursive: true, force: true }));
  return path;
}

function request(path: string, cookie?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return localRequest(new URL(path, "http://127.0.0.1:3180").href, { ...init, headers });
}

function localRequest(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("host")) headers.set("host", new URL(url).host);
  return new Request(url, { ...init, headers });
}

test("root bootstrap exchanges once, cleans URL, and preserves absolute browser access across reopening", async () => {
  const dataDir = await directory();
  let now = Date.UTC(2026, 0, 1);
  const options = { dataDir, origin: "http://127.0.0.1:3180", now: () => now };
  let access = openBrowserAccess(options);
  cleanup.push(() => access.close());
  const link = access.bootstrapLink();
  const login = await access.handle(localRequest(link));
  expect(login?.status).toBe(303);
  expect(login?.headers.get("location")).toBe("/");
  const setCookie = login!.headers.get("set-cookie")!;
  expect(setCookie.includes("HttpOnly; SameSite=Strict")).toBe(true);
  expect(setCookie.includes("Domain=")).toBe(false);
  expect(setCookie.includes("Secure")).toBe(false);
  const cookie = setCookie.split(";")[0]!;
  expect((await access.handle(localRequest(link)))?.status).toBe(401);
  const status = await access.handle(request("/auth/status", cookie));
  const summary = await status!.json() as { authenticated: boolean; expiresAt: number };
  expect({ authenticated: summary.authenticated, expiresAt: summary.expiresAt }).toEqual({
    authenticated: true, expiresAt: Date.UTC(2026, 0, 31),
  });
  expect(status?.headers.has("set-cookie")).toBe(false);
  access.close();
  access = openBrowserAccess(options);
  now += 30 * 86_400_000 - 1;
  expect((await access.handle(request("/auth/status", cookie)))?.status).toBe(200);
  now += 1;
  expect((await access.handle(request("/auth/status", cookie)))?.status).toBe(401);
});

async function authorized() {
  const dataDir = await directory();
  const access = openBrowserAccess({ dataDir, origin: "http://127.0.0.1:3180" });
  cleanup.push(() => access.close());
  const response = await access.handle(localRequest(access.bootstrapLink()));
  const cookie = response!.headers.get("set-cookie")!.split(";")[0]!;
  const status = await access.handle(request("/auth/status", cookie));
  const body = await status!.json() as { csrf: string };
  return { dataDir, access, cookie, csrf: body.csrf };
}

test("writes reject hostile authority, origin, proxy, metadata and CSRF before any body is consumed", async () => {
  const { access, cookie, csrf } = await authorized();
  const cases: Array<[Record<string, string>, number]> = [
    [{}, 403], [{ origin: "null" }, 403], [{ origin: "http://127.0.0.1:3181" }, 403],
    [{ origin: "http://127.0.0.1:3180", host: "evil.example" }, 403],
    [{ origin: "http://127.0.0.1:3180", host: "0177.0.0.1:3180" }, 403],
    [{ origin: "http://127.0.0.1:3180", host: "127.0.0.1:3181" }, 403],
    [{ origin: "http://127.0.0.1:3180", host: "127.0.0.1:3180@evil.example" }, 403],
    [{ origin: "http://127.0.0.1:3180", forwarded: "host=127.0.0.1:3180" }, 403],
    [{ origin: "http://127.0.0.1:3180", "x-forwarded-host": "127.0.0.1:3180" }, 403],
    [{ origin: "http://127.0.0.1:3180", "sec-fetch-site": "cross-site" }, 403],
    [{ origin: "http://127.0.0.1:3180", "x-omp-csrf": "wrong" }, 403],
  ];
  for (const [headers, expected] of cases) {
    const pending = request("/auth/logout", cookie, { method: "POST", headers, body: "untrusted large upload" });
    expect((await access.handle(pending))?.status).toBe(expected);
    expect(pending.bodyUsed).toBe(false);
  }
  expect((await access.handle(request("/auth/logout", undefined, {
    method: "POST", headers: { origin: "http://127.0.0.1:3180", "x-omp-csrf": csrf },
  })))?.status).toBe(401);
  expect((await access.handle(request("/auth/status", cookie)))?.status).toBe(200);
});

test("logout durably invalidates all pages of that credential, leaves another browser valid", async () => {
  const { dataDir, access, cookie, csrf } = await authorized();
  const second = await access.handle(localRequest(access.bootstrapLink()));
  const otherCookie = second!.headers.get("set-cookie")!.split(";")[0]!;
  const response = await access.handle(request("/auth/logout", cookie, {
    method: "POST", headers: { origin: "http://127.0.0.1:3180", "x-omp-csrf": csrf },
  }));
  expect(response?.status).toBe(204);
  expect(response?.headers.get("set-cookie")?.includes("Expires=Thu, 01 Jan 1970")).toBe(true);
  expect((await access.handle(request("/auth/status", cookie)))?.status).toBe(401);
  expect((await access.handle(request("/auth/status", otherCookie)))?.status).toBe(200);
  access.close();
  const restarted = openBrowserAccess({ dataDir, origin: "http://127.0.0.1:3180" });
  cleanup.push(() => restarted.close());
  expect((await restarted.handle(request("/auth/status", cookie)))?.status).toBe(401);
  expect((await restarted.handle(request("/auth/status", otherCookie)))?.status).toBe(200);
});

test("changing origin or data directory and losing private material require fresh bootstrap", async () => {
  const { dataDir, access, cookie } = await authorized();
  access.close();
  const moved = openBrowserAccess({ dataDir, origin: "http://127.0.0.1:3181" });
  expect((await moved.handle(localRequest("http://127.0.0.1:3181/auth/status", { headers: { cookie } })))?.status).toBe(401);
  moved.close();
  const returned = openBrowserAccess({ dataDir, origin: "http://127.0.0.1:3180" });
  expect((await returned.handle(request("/auth/status", cookie)))?.status).toBe(401);
  returned.close();
  await rm(join(dataDir, "browser-access.sqlite"));
  for (const dir of [dataDir, await directory()]) {
    const fresh = openBrowserAccess({ dataDir: dir, origin: "http://127.0.0.1:3180" });
    expect((await fresh.handle(request("/auth/status", cookie)))?.status).toBe(401);
    fresh.close();
  }
});

test("bootstrap is root GET only and never authenticates an API, upload or websocket", async () => {
  const { access } = await authorized();
  const token = new URL(access.bootstrapLink()).search;
  for (const path of ["/api/remote", "/upload", "/download", "/socket"]) {
    const result = access.admit(request(path + token), "read");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  }
  expect((await access.handle(localRequest(access.bootstrapLink(), {
    method: "POST", headers: { origin: "http://127.0.0.1:3180" },
  })))?.status).toBe(405);
});

test("loss or replacement of private state invalidates a live Host's cached credential authority", async () => {
  const { access, dataDir, cookie } = await authorized();
  const identity = access.admit(request("/auth/status", cookie), "read");
  if (identity instanceof Response) throw new Error("Fixture login failed");
  await rm(join(dataDir, "browser-access.sqlite"));
  expect((await access.handle(request("/auth/status", cookie)))?.status).toBe(401);
  expect(access.revalidate(identity)).toBe(false);
});
