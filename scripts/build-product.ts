import { buildClient } from "../apps/chat/build.ts";

export async function buildProduct(outdir = "vendor/dsh-product"): Promise<void> {
  await buildClient({
    outdir,
    kind: "product",
    title: "OMP WebUI",
    entry: "src/product-entry.tsx",
    naming: { entry: "client.[ext]", chunk: "chunk-[hash].[ext]" },
  });
}

if (import.meta.main) await buildProduct();
