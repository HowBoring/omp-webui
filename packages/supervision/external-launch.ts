import { isAbsolute, join, resolve } from "node:path";
import { ExternalProtectorError } from "./external.ts";

/** Same structural scope as the matched public Native ownership protocol; not a bearer permission. */
export type ExternalBrokerScope = { kind: "project"; directory: string }
  | { kind: "global"; service: "browser-relay" | "text-predict" };
/** Outside-release operator approval. The dispatcher verifies every member before actual spawn. */
export interface ExternalProtectorApproval {
  binaryDigest: string;
  sourceDigest: string;
  sharedSourceDigest: string;
  controlSourceDigest: string;
  candidateSourceDigest: string;
  configurationDigest: string;
}
export interface ExternalBrokerLaunch {
  releaseRoot: string;
  generation: string;
  scope: ExternalBrokerScope;
}
export interface ExternalBrokerInvocation {
  kind: "broker-tree";
  argv: readonly [protector: string, generation: string];
  /** Merge into the dispatcher's validated allowlisted environment; these hints grant no authority. */
  environmentHints: Readonly<{ OMP_EXECUTION_BROKER_GENERATION: string; OMP_EXECUTION_BROKER_SCOPE: string }>;
}
function canonicalDirectory(directory: string): boolean {
  return directory.length <= 4096 && !directory.includes("\0") && isAbsolute(directory) && resolve(directory) === directory;
}
function canonicalScope(scope: ExternalBrokerScope): string {
  const keys = Object.keys(scope);
  if (keys.length !== 2) throw new ExternalProtectorError("EXTERNAL_LAUNCH_UNSUPPORTED");
  if (scope.kind === "project" && canonicalDirectory(scope.directory)) {
    return JSON.stringify({ kind: "project", directory: scope.directory });
  }
  if (scope.kind === "global" && (scope.service === "browser-relay" || scope.service === "text-predict")) {
    return JSON.stringify({ kind: "global", service: scope.service });
  }
  throw new ExternalProtectorError("EXTERNAL_LAUNCH_UNSUPPORTED");
}
/**
 * Pure mechanical construction for the actual dispatcher only. Caller independently verifies the selected
 * installation, external binary approval, canonical/pinned cwd/runtime directory and prepared scope before spawn.
 * No executable, worker argv, runtime/token path, generic environment or intentional shutdown operation is accepted.
 */
export function externalBrokerLaunch(input: ExternalBrokerLaunch): ExternalBrokerInvocation {
  if (!canonicalDirectory(input.releaseRoot) || !/^[a-f0-9]{64}$/.test(input.generation)) {
    throw new ExternalProtectorError("EXTERNAL_LAUNCH_UNSUPPORTED");
  }
  return { kind: "broker-tree", argv: [join(input.releaseRoot, "bin/omp-external-protector"), input.generation],
    environmentHints: { OMP_EXECUTION_BROKER_GENERATION: input.generation,
      OMP_EXECUTION_BROKER_SCOPE: canonicalScope(input.scope) } };
}
