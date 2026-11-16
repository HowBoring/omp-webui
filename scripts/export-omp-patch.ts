import { resolve } from "node:path";
import { authoredPaths, sourceGit } from "./omp-source.ts";
const omp = resolve("vendor/omp");
sourceGit(omp, "add", "-N", ...authoredPaths);
await Bun.write("compatibility/omp/0001-safe-preflight.patch", sourceGit(omp, "diff", "HEAD", "--", ...authoredPaths));
console.info("Exported authored OMP patch; review and commit it before enrolling an installation.");
