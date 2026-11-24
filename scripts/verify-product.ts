import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { buildProduct } from "./build-product.ts";

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  }));
  return nested.flat().sort();
}

const actual = resolve("vendor/dsh-product");
const temporary = await mkdtemp(join(tmpdir(), "omp-product-verify-"));
try {
  await buildProduct(temporary);
  // The committed shell must not depend on which directory invoked the build.
  const invoking = process.cwd();
  try {
    process.chdir(tmpdir());
    await buildProduct(temporary);
  } finally {
    process.chdir(invoking);
  }
  const [actualFiles, expectedFiles] = await Promise.all([files(actual), files(temporary)]);
  const actualPaths = actualFiles.map(path => relative(actual, path));
  const expectedPaths = expectedFiles.map(path => relative(temporary, path));
  const paths = [...new Set([...actualPaths, ...expectedPaths])].sort();
  const different: string[] = [];
  for (const path of paths) {
    const [left, right] = await Promise.all([
      readFile(resolve(actual, path)).catch(() => undefined),
      readFile(resolve(temporary, path)).catch(() => undefined),
    ]);
    if (left === undefined || right === undefined || !left.equals(right)) different.push(path);
  }
  if (different.length > 0) {
    throw new Error(`PRODUCT_BUNDLE_SOURCE_MISMATCH: ${different.join(", ")}; run bun run product:build`);
  }
  console.log(JSON.stringify({ status: "verified", files: paths.length }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
