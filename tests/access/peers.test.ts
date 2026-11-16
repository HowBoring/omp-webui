import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openBrowserAccess } from "../../packages/access/index.ts";
import type { BrowserAccess, BrowserAuthority } from "../../packages/access/index.ts";

test("real WebSocket admission, each logical open, logout and expiry use current credential authority", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "omp-access-ws-"));
  let now = Date.now();
  let access: BrowserAuthority;
  const server = Bun.serve<{ identity: BrowserAccess; detach?: () => void }>({
    hostname: "127.0.0.1", port: 0,
    async fetch(request, server) {
      if (new URL(request.url).pathname === "/peer") {
        const identity = access.admit(request, "websocket");
        if (identity instanceof Response) return identity;
        if (server.upgrade(request, { data: { identity } })) return;
        return new Response(null, { status: 400 });
      }
      return await access.handle(request) ?? new Response(null, { status: 404 });
    },
    websocket: {
      open(peer) {
        peer.data.detach = access.attachPeer(peer.data.identity, () => peer.close(4001, "Access invalidated"));
        peer.send("admitted");
      },
      message(peer) {
        // This fixture models a logical open/publication check, never an OMP/DSH success path.
        if (!access.revalidate(peer.data.identity)) { peer.close(4001, "Access invalidated"); return; }
        peer.send("logical-open-admitted");
      },
      close(peer) { peer.data.detach?.(); },
    },
  });
  const origin = server.url.origin;
  access = openBrowserAccess({ dataDir, origin, now: () => now });
  const sockets: WebSocket[] = [];
  async function login() {
    const response = await fetch(access.bootstrapLink(), { redirect: "manual" });
    const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    const status = await fetch(`${origin}/auth/status`, { headers: { cookie } });
    const { csrf } = await status.json() as { csrf: string };
    return { cookie, csrf };
  }
  function connect(cookie: string) {
    // Bun's documented native-client headers overload is hidden by this project's DOM constructor type.
    // @ts-expect-error Bun.WebSocketOptions is supported by Bun 1.4.4 at runtime.
    const socket = new WebSocket(`${origin.replace("http", "ws")}/peer`, { headers: { cookie, origin } });
    sockets.push(socket);
    return socket;
  }
  function message(socket: WebSocket) {
    return new Promise<string>((resolve, reject) => {
      socket.addEventListener("message", (event) => resolve(String(event.data)), { once: true });
      socket.addEventListener("error", () => reject(new Error("WebSocket failed")), { once: true });
    });
  }
  const closed = (socket: WebSocket) => new Promise<number>((resolve) => {
    socket.addEventListener("close", (event) => resolve(event.code), { once: true });
  });
  try {
    const first = await login();
    const other = await login();
    for (const headers of [{ cookie: first.cookie }, { cookie: first.cookie, origin: "null" }, { origin }]) {
      const response = await fetch(`${origin}/peer`, { headers: { ...headers, upgrade: "websocket" } });
      expect([401, 403]).toContain(response.status);
    }
    const a = connect(first.cookie), b = connect(first.cookie), c = connect(other.cookie);
    expect(await Promise.all([message(a), message(b), message(c)])).toEqual(["admitted", "admitted", "admitted"]);
    const aClosed = closed(a), bClosed = closed(b);
    const logout = await fetch(`${origin}/auth/logout`, {
      method: "POST", headers: { cookie: first.cookie, origin, "x-omp-csrf": first.csrf },
    });
    expect(logout.status).toBe(204);
    expect(await Promise.all([aClosed, bClosed])).toEqual([4001, 4001]);
    const allowed = message(c); c.send("logical-open");
    expect(await allowed).toBe("logical-open-admitted");
    const cClosed = closed(c);
    now += 30 * 86_400_000;
    c.send("logical-open-after-expiry");
    expect(await cClosed).toBe(4001);
    const fresh = await login();
    const d = connect(fresh.cookie);
    expect(await message(d)).toBe("admitted");
    const dClosed = closed(d);
    now += 30 * 86_400_000;
    expect(await dClosed).toBe(4001); // idle expiry closes without a new request
  } finally {
    for (const socket of sockets) socket.close();
    await server.stop(true); access.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}, 10_000);
