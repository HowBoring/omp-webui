import { buildClient } from "../apps/chat/build.ts";

if (import.meta.main) {
  await buildClient({
    outdir: "vendor/dsh-product",
    kind: "product",
    title: "OMP WebUI",
    entry: "src/product-entry.tsx",
    naming: { entry: "client.[ext]", chunk: "chunk-[hash].[ext]" },
  });
}
