import { resolve } from "node:path";
import { authoredPaths, sourceGit, patchedTree, ompPatches } from "./omp-source.ts";
const omp = resolve("vendor/omp");
sourceGit(omp,"add","-N",...authoredPaths);
const prior = await patchedTree(omp,ompPatches.slice(0,-1));
await Bun.write(resolve("compatibility/omp",ompPatches.at(-1)!),sourceGit(omp,"diff",prior,"--",...authoredPaths));
console.info("Exported last authored OMP patch against the exact prior patch tree; review before enrollment.");
