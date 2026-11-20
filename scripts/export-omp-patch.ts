import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { authoredPaths, sourceGit, patchedTree, ompPatches } from "./omp-source.ts";
const omp = resolve("vendor/omp");
const present = authoredPaths.filter(path => existsSync(resolve(omp,path)));
sourceGit(omp,"add","-N",...present);
const requested = process.argv.find(value => value.startsWith("--patch="))?.slice(8) ?? ompPatches.at(-1)!;
const target = ompPatches.indexOf(requested);
if (target < 0) throw new Error("OMP_PATCH_TARGET_UNKNOWN");
// A named earlier patch requires the checkout to contain only that ordered prefix; do not absorb a later owner's source.
for (const later of ompPatches.slice(target + 1)) {
  const text = await Bun.file(resolve("compatibility/omp",later)).text();
  for (const match of text.matchAll(/^diff --git a\/(.+) b\/(.+)\nnew file mode/gm))
    if (match[2] && existsSync(resolve(omp,match[2]))) throw new Error("OMP_LATER_PATCH_PRESENT");
}
const prior = await patchedTree(omp,ompPatches.slice(0,target));
await Bun.write(resolve("compatibility/omp",requested),sourceGit(omp,"diff",prior,"--",...authoredPaths));
console.info("Exported last authored OMP patch against the exact prior patch tree; review before enrollment.");
