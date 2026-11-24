import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBrowserAccess } from "../../packages/access/index.ts";

test("trusted revoke-all invalidates durable credentials and peers and notifies admission before returning", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "session-revoke-all-")), origin = "http://127.0.0.1:4321";
  let authority = openBrowserAccess({ dataDir, origin });
  try {
    const exchange = await authority.handle(new Request(authority.bootstrapLink(), { headers: { host: "127.0.0.1:4321" } }));
    const cookie = exchange!.headers.get("set-cookie")!.split(";")[0]!;
    const identity = authority.admit(new Request(origin + "/api/test", { headers: { host: "127.0.0.1:4321", cookie } }), "read");
    if (identity instanceof Response) throw new Error("login failed");
    const oldBootstrap = authority.bootstrapLink(); let withdrawn = false, peerClosed = false;
    authority.onRevokeAll(() => { withdrawn = true; }); authority.attachPeer(identity, () => { peerClosed = true; });
    authority.revokeAll();
    expect({ withdrawn, peerClosed, current: authority.revalidate(identity) }).toEqual({ withdrawn: true, peerClosed: true, current: false });
    expect((await authority.handle(new Request(oldBootstrap, { headers: { host: "127.0.0.1:4321" } })))!.status).toBe(401);
    authority.close(); authority = openBrowserAccess({ dataDir, origin });
    expect(authority.admit(new Request(origin + "/api/test", { headers: { host: "127.0.0.1:4321", cookie } }), "read")).toBeInstanceOf(Response);
  } finally { authority.close(); rmSync(dataDir, { recursive: true, force: true }); }
});
