import { inspectCoordinatedSelection, type CoordinatedSelection } from "./coordinator.ts";

const missingEvidence = [
  "actual-global-target", "final-native-dsh-combination", "effective-native-semantics-and-budgets",
  "complete-deferred-runtime-and-platform-dependency-lifetime", "all-entry-coordinated-maintenance",
  "worker-private-and-shared-service-maintenance-lifetimes", "native-tui-upgrade-current-data-rollback",
  "matched-public-rpc-native-browser-negatives", "security-private-session-admission",
];
export interface DeliveryGateReport {
  status: "blocked"; sessionAdmission: "blocked"; code: string; missingEvidence: string[];
  /** Inventory identity only; never a final supported tuple or proof of actual-global scope. */
  inventorySha256?: string;
}

/** Sanitized operator-facing preparation report. This version has no product admission or executable launch path. */
export async function inspectDeliveryGate(selection?: CoordinatedSelection): Promise<DeliveryGateReport> {
  const report: DeliveryGateReport = { status: "blocked", sessionAdmission: "blocked",
    code: "GLOBAL_TARGET_NOT_SELECTED", missingEvidence: [...missingEvidence] };
  if (selection === undefined) return report;
  try {
    const inspected = await inspectCoordinatedSelection(selection);
    try {
      await inspected.verify();
      return { ...report, code: "DELIVERY_COMPONENTS_ONLY", inventorySha256: inspected.selected.release.identity };
    } finally { await inspected.release(); }
  } catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.message)
      ? error.message : "DELIVERY_INSPECTION_FAILED";
    return { ...report, code };
  }
}
