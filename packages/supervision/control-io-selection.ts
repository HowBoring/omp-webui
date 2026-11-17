import type { ControlIoSelection } from "../control-io/index.ts";
import type { InspectedSelection } from "../delivery/coordinator.ts";
import { helperError } from "./errors.ts";

/** Snapshot Host inventory without dropping its exhaustive verification or retained maintenance protection. */
export function selectedControlIo(selection: InspectedSelection): ControlIoSelection {
  const release = selection.selected.release;
  const members = (values: typeof release.manifest.assets) =>
    Object.freeze(values.map(value => Object.freeze({ ...value })));
  const manifest = Object.freeze({ ...release.manifest,
    assets: members(release.manifest.assets), platformDependencies: members(release.manifest.platformDependencies) });
  return Object.freeze({ selected: Object.freeze({ release: Object.freeze({
    root: release.root, identity: release.identity, manifest,
  }) }), verify: () => selection.verify(), release: () => selection.release() });
}

/** Keep selection failures bounded consistently before preparation, spawn and held registration. */
export async function verifyHelperSelection(selection: InspectedSelection): Promise<void> {
  try { await selection.verify(); }
  catch (error) { throw helperError("HELPER_SELECTION_UNVERIFIED", error); }
}
