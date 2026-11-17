import { constants } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { ControlIoError } from "../packages/control-io/errors.ts";

const modules = ["index", "loader", "socket", "selection", "errors"] as const;
/** Exact public implementation/build inputs; no supervision/delivery implementation or test factory is packaged. */
export const controlIoPublicInputs = [
  ...modules.map(name => `packages/control-io/${name}.ts`), "packages/control-io/package.json",
  "scripts/build-control-io.ts", "scripts/build-control-io-public.ts", "package.json", "bun.lock",
] as const;
export const controlIoPublicMembers = [
  "control-io/index.js", "control-io/package.json", ...modules.map(name => `control-io/${name}.d.ts`),
  ...modules.map(name => `provenance/control-io/${name}.ts`), "provenance/control-io/package.json",
  "provenance/build-control-io.ts", "provenance/build-control-io-public.ts", "provenance/control-io-build.json",
  "provenance/control-io-toolchain-package.json", "provenance/control-io-toolchain-bun.lock",
] as const;
/** Compile staged source only. Caller owns exclusive fresh-release publication and maintenance coordination. */
export async function buildPublicControlIo(temporary: string): Promise<void> {
  if (Bun.version !== "1.4.4") throw new ControlIoError("CONTROL_IO_UNSUPPORTED");
  const source = join(temporary, "provenance/control-io");
  const output = join(temporary, "control-io");
  await mkdir(source, { recursive: true }); await mkdir(output);
  const inputs = await stagePublicSources(temporary);
  const javascript = { target: "bun" as const, format: "esm" as const, packages: "external" as const,
    minify: { whitespace: true, identifiers: false, syntax: false } };
  const result = await Bun.build({ ...javascript, entrypoints: [join(source, "index.ts")], outdir: output,
    naming: "index.js" });
  if (!result.success) throw new ControlIoError("CONTROL_IO_LOAD_FAILED");
  const ts = await import("typescript");
  if (ts.version !== "6.0.3") throw new ControlIoError("CONTROL_IO_UNSUPPORTED");
  const options = { declaration: true, emitDeclarationOnly: true, noEmitOnError: true, strict: true,
    skipLibCheck: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true,
    types: ["bun"], typeRoots: [resolve(import.meta.dir, "../node_modules/@types")], rootDir: source, outDir: output };
  const program = ts.createProgram([join(source, "index.ts")], options);
  const emitted = program.emit();
  if (emitted.emitSkipped || ts.getPreEmitDiagnostics(program).length) {
    throw new ControlIoError("CONTROL_IO_LOAD_FAILED");
  }
  for (const name of modules) {
    const path = join(output, `${name}.d.ts`);
    const declaration = (await readFile(path, "utf8")).replaceAll(/(from "\.\/[^"\n]+)\.ts"/g, '$1.js"');
    await writeFile(path, declaration);
  }
  await copyFile(join(source, "package.json"), join(output, "package.json"), constants.COPYFILE_EXCL);
  await writeFile(join(temporary, "provenance/control-io-build.json"), JSON.stringify({
    format: "omp-control-io-public-build-v1", inputs, bun: Bun.version, typescript: ts.version,
    javascript,
    declarationOptions: { ...options, typeRoots: ["<toolchain>/node_modules/@types"],
      rootDir: "provenance/control-io", outDir: "control-io" },
    admission: "unaccepted-artifact", approval: "independent-after-exhaustive-inventory",
  }, null, 2) + "\n", { flag: "wx" });
}

async function stagePublicSources(temporary: string): Promise<{ path: string; sha256: string }[]> {
  const source = join(temporary, "provenance/control-io");
  const inputs: { path: string; sha256: string }[] = [];
  for (const path of controlIoPublicInputs) {
    const destination = path.startsWith("packages/control-io/")
      ? join(source, path.slice("packages/control-io/".length))
      : path.startsWith("scripts/") ? join(temporary, "provenance", path.slice("scripts/".length))
        : join(temporary, "provenance", `control-io-toolchain-${path}`);
    await copyFile(resolve(import.meta.dir, "..", path), destination, constants.COPYFILE_EXCL);
    inputs.push({ path, sha256: createHash("sha256").update(await readFile(destination)).digest("hex") });
  }
  return inputs;
}
