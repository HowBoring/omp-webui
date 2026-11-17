import * as fs from "node:fs/promises";
import pins from "./native-helper-drain-public-pins.json";
import { sha256 } from "./native-signed-probe-launch";

export const helperDrainAdapter = "/workspace/work/omp-webui-ticket-41-controlio-public-adapter";
export const helperDrainPublicRoot = `${helperDrainAdapter}/vendor/public-adapter-nominal-v1/release`;
export const helperDrainPublicMembers = Object.freeze(Object.keys(pins));

/** Immutable historical public inputs only. This checksum check grants no release or Native authority. */
export async function verifyHelperDrainPublicInputs(): Promise<void> {
  for (const [name, expected] of Object.entries(pins)) {
    const file = `${helperDrainPublicRoot}/${name}`, metadata = await fs.lstat(file);
    if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size > 16_777_216 || await fs.realpath(file) !== file
      || sha256(await fs.readFile(file)) !== expected) throw new Error("DRAIN_PUBLIC_INPUT_CHANGED");
  }
}
