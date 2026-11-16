import { z } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";

// Codes are identifiers, never arbitrary diagnostic strings, paths, or stderr.
const code = z.string().min(1).max(96).regex(/^[a-zA-Z][a-zA-Z0-9_.:-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.strictObject({
  base: z.string().regex(/^[a-f0-9]{40}$/),
  patchSha256: digest,
  sourceSha256: digest,
  schemaSha256: digest,
  installationSha256: digest,
  runtime: z.strictObject({
    name: z.literal("bun"),
    version: z.string().min(1).max(32).regex(/^[0-9][0-9a-zA-Z.+-]*$/),
    platform: code,
    arch: code,
  }),
});
const fields = {
  sessionAdmission: z.literal("blocked"),
  code,
  missingCapabilities: z.array(code).max(64).readonly(),
};

/** Sanitized preflight only. This contract never admits private OMP Sessions. */
export const diagnosticReportSchema = z.discriminatedUnion("status", [
  z.strictObject({ ...fields, status: z.literal("verified-blocked"), identity }),
  z.strictObject({ ...fields, status: z.literal("blocked"), identity: identity.optional() }),
]);
export type DiagnosticReport = z.infer<typeof diagnosticReportSchema>;

// The public Typert factory generates both mounted descriptors and strict named
// input parsing from these source-owned facts. Host and Client share this schema.
export const diagnosticsContribution = createTypertRemoteInfo({
  package: "@omp-webui/diagnostics",
  methods: {
    "ompDiagnostics/preflight": {
      service: "ompDiagnostics",
      invocation: { kind: "direct" },
      parameters: [],
      result: {
        mode: "strict",
        typeSymbol: "DiagnosticReport",
        create: () => diagnosticReportSchema,
        decode: (value: unknown) => diagnosticReportSchema.parse(value),
      },
    },
  },
}, z);

export const diagnosticsHostContribution: TypertContribution = {
  package: diagnosticsContribution.package,
  face: "host",
  schemas: [{ name: "DiagnosticReport", create: () => diagnosticReportSchema }],
  model: { services: [], events: [], objects: [] },
  invocations: diagnosticsContribution.descriptors,
};

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    ompDiagnostics: { preflight(): Promise<RemoteResult<DiagnosticReport>> };
  }
}
