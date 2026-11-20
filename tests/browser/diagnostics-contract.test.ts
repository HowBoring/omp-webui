import { describe, expect, test } from "bun:test";
import { diagnosticReportSchema, diagnosticsContribution } from "../../packages/contracts/diagnostics.ts";

describe("public diagnostic report", () => {
  test("accepts bounded blocked reports and rejects browser execution controls or private data", () => {
    const blocked = { status: "blocked", sessionAdmission: "blocked", code: "candidate_unverified", missingCapabilities: [] } as const;
    expect(diagnosticReportSchema.parse(blocked)).toEqual(blocked);
    for (const extra of [{ executable: "/private/omp" }, { stderr: "secret" }, { argv: [] }]) {
      expect(diagnosticReportSchema.safeParse({ ...blocked, ...extra }).success).toBe(false);
    }
    expect(diagnosticReportSchema.safeParse({ ...blocked, code: "/private/profile" }).success).toBe(false);
  });

  test("verified reports require complete identity while session admission remains blocked", () => {
    expect(diagnosticReportSchema.safeParse({
      status: "verified-blocked", sessionAdmission: "blocked", code: "future_capabilities_missing",
      missingCapabilities: ["catalog"],
    }).success).toBe(false);
  });

  test("generated Remote descriptor has no business inputs and a strict result codec", () => {
    const descriptor = diagnosticsContribution.descriptors[0];
    expect(descriptor?.namespace).toBe("ompDiagnostics");
    expect(descriptor?.method).toBe("preflight");
    expect(descriptor?.parameters).toEqual([]);
    expect(descriptor?.result.mode).toBe("strict");
  });
});
