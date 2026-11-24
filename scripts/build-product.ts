import { buildProductClient } from "./build-product-client.ts";

/** Build the one authored OMP browser plugin, then compose the frozen product tree. */
export async function buildProduct(outdir = "vendor/dsh-product"): Promise<void> {
  const plugin = await Bun.build({
    entrypoints: [new URL("../apps/chat/src/product-enrollment.js", import.meta.url).pathname],
    target: "browser", format: "iife", minify: true, outdir: "vendor/omp-product-enrollment",
  });
  if (!plugin.success) throw new AggregateError(plugin.logs, "product enrollment plugin build failed");
  await buildProductClient({ outdir, plugins: [{
    id: "@omp-webui/product-enrollment", bundle: "vendor/omp-product-enrollment/product-enrollment.js",
  }] });
}

if (import.meta.main) await buildProduct();
