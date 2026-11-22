import { buildProductClient } from "./build-product-client.ts";

/** Compose the served product tree: stock DSH shell, audited roster, enrolled boot graph. */
export async function buildProduct(outdir = "vendor/dsh-product"): Promise<void> {
  await buildProductClient({ outdir });
}

if (import.meta.main) await buildProduct();
