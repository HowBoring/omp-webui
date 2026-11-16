/** Explicit public Remote carrier fixtures; these do not prove native preflight. */
import { describe, expect, test } from "bun:test";
import { Context } from "@deepseek-ai/cordis";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { diagnosticsContribution } from "../../packages/contracts/diagnostics.ts";
import type { RpcFetch } from "@deepseek-ai/dsh-client-connection/client";

const report = {
  status: "blocked", sessionAdmission: "blocked", code: "public_remote_fixture", missingCapabilities: ["catalog"],
} as const;

async function mount(fetch: RpcFetch) {
  const ctx = new Context();
  installConnection(ctx, {
    interactions: "none",
    transport: { fetch, openStream: async function* () {} },
  });
  registry(ctx);
  gateway(ctx);
  const dispose = await ctx.remote.$mount(diagnosticsContribution);
  return { ctx, dispose };
}

function response(rpcId: string, value: unknown): Response {
  return Response.json({ type: "server-response", rpcId, result: { ok: true, value } });
}

function envelope(init: RequestInit): { rpcId: string; method: string; payload: unknown } {
  return JSON.parse(String(init.body)) as { rpcId: string; method: string; payload: unknown };
}

describe("actual DSH diagnostic Remote with explicit public wire fixtures", () => {
  test("uses the Connection envelope and returns a typed RemoteResult", async () => {
    const { ctx } = await mount(async (url, init) => {
      const call = envelope(init);
      expect(url).toBe("api/ompDiagnostics/preflight");
      expect(call.method).toBe("ompDiagnostics/preflight");
      expect(call.payload).toEqual({ args: {} });
      return response(call.rpcId, report);
    });
    try {
      expect(await ctx.remote.ompDiagnostics.preflight()).toEqual({ ok: true, value: report });
    } finally { await ctx.fiber.dispose(); }
  });

  test("rejects mismatched correlation and malformed reports", async () => {
    for (const fault of ["rpcId", "private_field", "missing_identity"]) {
      const { ctx } = await mount(async (_url, init) => {
        const call = envelope(init);
        const value = fault === "private_field" ? { ...report, stderr: "/private/secret" }
          : fault === "missing_identity" ? { ...report, status: "verified-blocked" } : report;
        return response(fault === "rpcId" ? "wrong-id" : call.rpcId, value);
      });
      try { expect((await ctx.remote.ompDiagnostics.preflight()).ok).toBe(false); }
      finally { await ctx.fiber.dispose(); }
    }
  });

  test("withdrawal aborts the in-flight request and rejects stale captured calls", async () => {
    let started!: () => void;
    const pending = new Promise<void>(resolve => { started = resolve; });
    let wasAborted = false;
    const { ctx, dispose } = await mount(async (_url, init) => {
      started();
      await new Promise<void>(resolve => {
        init.signal?.addEventListener("abort", () => { wasAborted = true; resolve(); }, { once: true });
      });
      return response(envelope(init).rpcId, report);
    });
    try {
      const captured = ctx.remote.ompDiagnostics.preflight;
      const result = captured();
      await pending;
      await dispose();
      expect((await result).ok).toBe(false);
      expect(wasAborted).toBe(true);
      expect((await captured()).ok).toBe(false);
    } finally { await ctx.fiber.dispose(); }
  });
});
