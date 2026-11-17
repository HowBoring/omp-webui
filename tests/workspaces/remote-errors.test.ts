/** Actual HTTP → public DSH Connection/Gateway/typed Remote; explicit native/index fault boundaries. */
import { expect, test, setSystemTime } from "bun:test";
import { Context } from "@deepseek-ai/cordis";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { mkdtemp, mkdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceContribution } from "../../packages/contracts/workspaces.ts";
import { startWorkspaceComponentServer } from "../../apps/host/src/workspace-component-server.ts";
import { CatalogClient } from "../../packages/contracts/generated/catalog-client.ts";

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "workspace-remote-error-"));
  const root = join(home, "project"); await mkdir(root);
  let nativeFailure: unknown = new Error("CATALOG_STALE");
  let indexFailure: unknown = new Error("INDEX_PAGE_LIMIT");
  const host = await startWorkspaceComponentServer({ dataDir: join(home, "state"), port: 0,
    manifest: join(home, "absent-manifest"), launcher: join(home, "absent-launcher"),
    catalog: new CatalogClient(async () => { throw nativeFailure; }),
    index: { page: async () => { throw indexFailure; } } });
  const origin = host.server.url.origin;
  const exchange = await fetch(host.bootstrapLink(), { redirect: "manual" });
  const cookie = exchange.headers.get("set-cookie")!.split(";")[0]!;
  const auth = await (await fetch(`${origin}/auth/status`, { headers: { cookie } })).json() as { csrf: string };
  const headers = { cookie, origin, "x-omp-csrf": auth.csrf, "content-type": "application/json" };
  const observed: { status: number; requestId: string; responseId?: string; responseText: string }[] = [];
  const ctx = new Context();
  installConnection(ctx, { interactions: "none", transport: {
    async fetch(url, init) {
      const request = JSON.parse(String(init.body)) as { rpcId: string };
      const response = await fetch(new URL(url, origin), { ...init, headers });
      const responseText = await response.clone().text();
      let body: unknown;
      try { body = JSON.parse(responseText); } catch { body = undefined; }
      observed.push({ status: response.status, requestId: request.rpcId, responseText,
        ...(typeof body === "object" && body !== null && "rpcId" in body && typeof body.rpcId === "string"
          ? { responseId: body.rpcId } : {}) });
      return response;
    }, openStream: async function* () {},
  } });
  registry(ctx); gateway(ctx); await ctx.remote.$mount(workspaceContribution);
  return { home, root, ctx, observed, origin, headers,
    nativeFailure(value: unknown) { nativeFailure = value; }, indexFailure(value: unknown) { indexFailure = value; },
    async close() { await ctx.fiber.dispose(); await host.stop(); await rm(home, { recursive: true, force: true }); } };
}

test("a consumed confirmation returns a correlated domain failure through typed DSH Remote", async () => {
  const f = await fixture();
  try {
    const preview = await f.ctx.remote.ompWorkspaces.preview(f.root);
    if (!preview.ok) throw preview.error;
    expect((await f.ctx.remote.ompWorkspaces.confirm(preview.value.confirmation)).ok).toBe(true);
    const stale = await f.ctx.remote.ompWorkspaces.confirm(preview.value.confirmation);
    expect(stale).toMatchObject({ ok: false, error: { code: "GRANT_PREVIEW_EXPIRED", details: {} } });
    expect(f.observed.every(call => call.status === 200 && call.responseId === call.requestId)).toBe(true);
  } finally { await f.close(); }
});

test("directory replacement, grant budget, native, index and storage failures retain safe typed codes", async () => {
  const f = await fixture();
  const failure = async (result: Awaited<ReturnType<typeof f.ctx.remote.ompWorkspaces.sources>>, code: string) => {
    expect(result).toMatchObject({ ok: false, error: { code, details: {} } });
    if (result.ok) throw new Error("expected failure");
    expect(result.error.message).not.toContain(f.home);
  };
  try {
    const preview = await f.ctx.remote.ompWorkspaces.preview(f.root);
    if (!preview.ok) throw preview.error;
    await rename(f.root, `${f.root}-original`); await mkdir(f.root);
    expect(await f.ctx.remote.ompWorkspaces.confirm(preview.value.confirmation))
      .toMatchObject({ ok: false, error: { code: "DIRECTORY_CHANGED", details: {} } });
    // Reach the real grant transaction limit through the same public browser service.
    for (let index = 0; index < 256; ++index) {
      const path = join(f.root, String(index)); await mkdir(path);
      const next = await f.ctx.remote.ompWorkspaces.preview(path);
      if (!next.ok) throw next.error;
      const grant = await f.ctx.remote.ompWorkspaces.confirm(next.value.confirmation);
      if (!grant.ok) throw grant.error;
    }
    const last = await f.ctx.remote.ompWorkspaces.preview(f.root);
    if (!last.ok) throw last.error;
    expect(await f.ctx.remote.ompWorkspaces.confirm(last.value.confirmation))
      .toMatchObject({ ok: false, error: { code: "GRANT_LIMIT", details: {} } });
    await failure(await f.ctx.remote.ompWorkspaces.sources(), "CATALOG_STALE");
    f.nativeFailure(new Error("RPC_UNEXPECTED_EOF"));
    await failure(await f.ctx.remote.ompWorkspaces.sources(), "RPC_UNEXPECTED_EOF");
    expect(await f.ctx.remote.ompWorkspaces.registered({}))
      .toMatchObject({ ok: false, error: { code: "INDEX_PAGE_LIMIT", details: {} } });
    await rename(join(f.home, "state/directory-grants.sqlite"), join(f.home, "state/original.sqlite"));
    await Bun.write(join(f.home, "state/directory-grants.sqlite"), "replacement");
    expect(await f.ctx.remote.ompWorkspaces.grants())
      .toMatchObject({ ok: false, error: { code: "GRANTS_UNAVAILABLE", details: {} } });
    expect(f.observed.every(call => call.status === 200 && call.responseId === call.requestId)).toBe(true);
  } finally { await f.close(); }
}, 15000);

test("unknown thrown values are sanitized while malformed envelopes and admission stay HTTP rejections", async () => {
  const f = await fixture();
  const secret = `SYNTHETIC_PROMPT_SECRET ${f.home}/private-history`;
  try {
    for (const thrown of [new Error(secret), { code: "CATALOG_STALE", message: secret, details: { secret },
      isDSHRemoteError: true }, secret]) {
      f.nativeFailure(thrown);
      const result = await f.ctx.remote.ompWorkspaces.sources();
      expect(result).toMatchObject({ ok: false, error: { code: "gateway/internal", message: "Workspace request failed.", details: {} } });
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(f.observed.at(-1)?.responseText).not.toContain(secret);
      expect(f.observed.at(-1)?.responseText).not.toContain('"stack"');
    }
    f.nativeFailure(Object.assign(new Error(secret), { code: "EIO", path: secret }));
    const storage = await f.ctx.remote.ompWorkspaces.sources();
    expect(storage).toMatchObject({ ok: false, error: { code: "EIO", details: {} } });
    expect(JSON.stringify(storage)).not.toContain(secret);
    expect(f.observed.at(-1)?.responseText).not.toContain(secret);
    expect(f.observed.at(-1)?.responseText).not.toContain('"stack"');
    const endpoint = `${f.origin}/api/ompWorkspaces/confirm`;
    const valid = { type: "client-request", rpcId: "untrusted-id", method: "ompWorkspaces/confirm",
      payload: { args: { confirmation: crypto.randomUUID() } } };
    for (const body of ["{", JSON.stringify({ ...valid, rpcId: 123 }),
      JSON.stringify({ ...valid, method: "ompWorkspaces/grants" }),
      JSON.stringify({ ...valid, payload: { args: { confirmation: "invalid" } } })]) {
      const response = await fetch(endpoint, { method: "POST", headers: f.headers, body });
      expect(response.status).toBe(400); expect(await response.text()).toBe("Invalid workspace request");
    }
    for (const [headers, status] of [
      [{ ...f.headers, cookie: "" }, 401], [{ ...f.headers, "x-omp-csrf": "" }, 403],
      [{ ...f.headers, origin: "null" }, 403],
    ] as const) {
      const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(valid) });
      expect(response.status).toBe(status); expect(await response.text()).not.toContain("rpcId");
    }
    const media = await fetch(endpoint, { method: "POST", headers: { ...f.headers, "content-type": "text/plain" }, body: "{" });
    expect(media.status).toBe(415);
    expect(f.observed.every(call => call.status === 200 && call.responseId === call.requestId)).toBe(true);
  } finally { await f.close(); }
});


test("an expired confirmation is a correlated typed failure using the controlled public clock seam", async () => {
  const start = new Date("2026-11-16T12:00:00Z");
  setSystemTime(start);
  const f = await fixture();
  try {
    const preview = await f.ctx.remote.ompWorkspaces.preview(f.root);
    if (!preview.ok) throw preview.error;
    setSystemTime(new Date(start.getTime() + 60_001));
    const result = await f.ctx.remote.ompWorkspaces.confirm(preview.value.confirmation);
    expect(result).toMatchObject({ ok: false, error: { code: "GRANT_PREVIEW_EXPIRED", details: {} } });
    if (result.ok) throw new Error("expected expired failure");
    // Compile-time code discrimination uses the declared public DSH failure vocabulary.
    if (result.error.code === "GRANT_PREVIEW_EXPIRED") expect(result.error.details).toEqual({});
    expect(f.observed.every(call => call.status === 200 && call.responseId === call.requestId)).toBe(true);
    expect(await f.ctx.remote.ompWorkspaces.grants()).toEqual({ ok: true, value: [] });
  } finally { await f.close(); setSystemTime(); }
});
