import { stringifyJson } from "@oh-my-pi/pi-utils/json";
import { BranchCopyError, buildBranchCopyIntent, type BranchCopyIndex, type BranchCopyIntent } from "./branch-copy";
import { validBranchInspectParams } from "./branch-inspect-wire";
import { inspectBranch } from "./rpc-branch-inspect";

type NativeBranchCopyManager = Parameters<typeof inspectBranch>[1] & BranchCopyIndex;

/** Synchronous Native precursor. A future operation owner must keep its own transition fence. */
export function prepareBranchCopy(
  value: unknown,
  manager: NativeBranchCopyManager,
  isBusy: () => boolean,
  outstandingBuiltinCount: number,
): BranchCopyIntent {
  if (!validBranchInspectParams(value) || !value.expected) throw new BranchCopyError("BRANCH_COPY_CUT_REQUIRED");
  const command = { ...structuredClone(value), type: "branch_inspect" } as const;
  const cut = inspectBranch(command, manager, isBusy, outstandingBuiltinCount);
  const intent = buildBranchCopyIntent(cut, manager, stringifyJson);
  inspectBranch(command, manager, isBusy, outstandingBuiltinCount);
  return intent;
}
