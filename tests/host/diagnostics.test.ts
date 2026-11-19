import { expect, test } from "bun:test";
import { startDiagnosticsServer } from "../../apps/host/src/diagnostics-server.ts";
import { diagnosticReportSchema } from "../../packages/contracts/diagnostics.ts";
import { isRecord } from "../../packages/compatibility/framing.ts";

test("real Bun Gateway exposes only sanitized diagnostics and rejects browser launch controls", async () => {
  const host = await startDiagnosticsServer({ manifest: "/missing/manifest", launcher: "/missing/launcher", port: 0,
    expectedIdentity: "0".repeat(64) });
  const origin = host.server.url.origin;
  const call = (args: object, requestOrigin = origin) => fetch(`${origin}/api/ompDiagnostics/preflight`, {
    method: "POST", headers: { origin: requestOrigin, "content-type": "application/json" },
    body: JSON.stringify({ type: "client-request", method: "ompDiagnostics/preflight", rpcId: "public-test", payload: { args } }),
  });
  try {
    const response = await call({});
    expect(response.status).toBe(200);
    const envelope: unknown = await response.json();
    if (!isRecord(envelope) || !isRecord(envelope.result)) throw new Error("invalid public Gateway response");
    const report = diagnosticReportSchema.parse(envelope.result.value);
    expect(report).toEqual({ status: "blocked", sessionAdmission: "blocked", code: "INSTALLATION_UNVERIFIED",
      missingCapabilities: expect.arrayContaining(["catalog.readonly.v1", "security.private-session-admission.v1"]) });
    expect((await call({ executable: "/untrusted", argv: ["--session"] })).status).toBe(400);
    expect((await call({}, "https://untrusted.invalid")).status).toBe(403);
    expect((await fetch(`${origin}/api/session/list`, { method: "POST", headers: { origin }, body: "invalid-json" })).status).toBe(501);
    expect((await fetch(origin)).status).toBe(503);
  } finally { await host.stop(); }
});
