import type { CatalogDescriptor } from "./generated/omp-wire.ts";

export type NativeSessionIdentity = Pick<CatalogDescriptor, "sourceId" | "instanceId" | "nativeSessionId">;

export function sameNativeSession(left: NativeSessionIdentity, right: NativeSessionIdentity): boolean {
  return left.sourceId === right.sourceId && left.instanceId === right.instanceId && left.nativeSessionId === right.nativeSessionId;
}
