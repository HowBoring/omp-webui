import { lstat, readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { inspectRelease, type ReleaseSelection, type VerifiedRelease } from "./artifact.ts";

export interface GlobalSelection extends ReleaseSelection { entry: string }
export interface ResolvedGlobalSelection {
  entry: string; release: VerifiedRelease; sessionAdmission: "blocked";
  /** Check the exact selected pathname again while holding the maintenance lease. No PATH fallback is permitted. */
  verify(): Promise<void>;
}

/** Resolve only the documented controlled entry layout. This never executes a launcher or authenticates global scope. */
export async function resolveGlobalSelection(selection: GlobalSelection): Promise<ResolvedGlobalSelection> {
  try {
    const release = await inspectRelease(selection);
    const entry = selection.entry;
    if (!isAbsolute(entry) || resolve(entry) !== entry) throw new Error("absolute entry required");
    const verify = async (): Promise<void> => {
      if (await realpath(dirname(entry)) !== dirname(entry)) throw new Error("entry ancestor");
      const stat = await lstat(entry);
      if (stat.isSymbolicLink()) {
        const direct = resolve(dirname(entry), await readlink(entry));
        if (direct !== release.launcher || await realpath(entry) !== direct) throw new Error("entry link");
      } else if (!stat.isFile() || entry !== release.launcher) throw new Error("unsupported wrapper");
      await release.verify();
    };
    await verify();
    return { entry, release, sessionAdmission: "blocked", verify };
  } catch { throw new Error("GLOBAL_SELECTION_UNVERIFIED"); }
}
