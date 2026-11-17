import { acquireMaintenanceLease, type MaintenanceControl, type MaintenanceLease } from "./maintenance.ts";
import { resolveGlobalSelection, type GlobalSelection, type ResolvedGlobalSelection } from "./resolver.ts";

export interface CoordinatedSelection extends GlobalSelection { control: MaintenanceControl }
export interface InspectedSelection extends MaintenanceLease {
  selected: ResolvedGlobalSelection; sessionAdmission: "blocked";
}

/**
 * Operator inspection only: acquire the independently pinned control before reading any release bytes.
 * Retain this lease through preflight/worker drain. The controlled ordinary entry acquires its own exec lifetime lease.
 * Complete native semantics, runtime mappings, all-user coordination and private admission remain independent blockers.
 */
export async function inspectCoordinatedSelection(selection: CoordinatedSelection): Promise<InspectedSelection> {
  if (selection.control.path === selection.root || selection.control.path.startsWith(`${selection.root}/`)) {
    throw new Error("MAINTENANCE_CONTROL_INSIDE_RELEASE");
  }
  const lease = await acquireMaintenanceLease(selection.control, "use");
  try {
    const selected = await resolveGlobalSelection(selection);
    const verify = async (): Promise<void> => {
      await lease.verify();
      await selected.verify();
      await lease.verify();
    };
    await verify();
    return { selected, sessionAdmission: "blocked", verify, release: lease.release };
  } catch (error) {
    await lease.release();
    throw error;
  }
}
