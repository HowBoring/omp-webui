import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { inspectDeliveryGate } from "../packages/delivery/gate.ts";

const selectionSchema = z.strictObject({
  root: z.string(), entry: z.string(), expectedIdentity: z.string().regex(/^[a-f0-9]{64}$/),
  control: z.strictObject({ path: z.string(), device: z.string().regex(/^\d+$/), inode: z.string().regex(/^\d+$/) }),
});
try {
  // This is trusted operator startup configuration. No CLI/browser executable/argv or PATH discovery fallback exists.
  const path = process.env.OMP_WEB_DELIVERY_SELECTION;
  const selection = path === undefined ? undefined : await (async () => {
    if ((await stat(path)).size > 65_536) throw new Error("selection too large");
    return selectionSchema.parse(JSON.parse(await readFile(path, "utf8")));
  })();
  console.info(JSON.stringify(await inspectDeliveryGate(selection)));
} catch {
  console.info(JSON.stringify({ status: "blocked", sessionAdmission: "blocked", code: "DELIVERY_SELECTION_INVALID" }));
}
process.exitCode = 2;
