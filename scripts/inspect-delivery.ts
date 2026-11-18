import { constants, type BigIntStats } from "node:fs";
import { open, stat } from "node:fs/promises";
import { z } from "zod";
import type { CoordinatedSelection } from "../packages/delivery/coordinator.ts";
import { inspectDeliveryGate } from "../packages/delivery/gate.ts";

const maximumSelectionBytes = 65_536;
const selectionSchema = z.strictObject({
  root: z.string(),
  entry: z.string(),
  expectedIdentity: z.string().regex(/^[a-f0-9]{64}$/),
  control: z.strictObject({ path: z.string(), device: z.string().regex(/^\d+$/), inode: z.string().regex(/^\d+$/) }),
});

function snapshot(info: BigIntStats): string {
  return [info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs].join(":");
}

async function readSelection(path: string): Promise<CoordinatedSelection> {
  const before = await stat(path, { bigint: true });
  if (!before.isFile() || before.size > BigInt(maximumSelectionBytes)) throw new Error("Invalid selection file");
  const expected = snapshot(before);
  // Nonblocking open protects against a FIFO replacing the named file before the open.
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (snapshot(await file.stat({ bigint: true })) !== expected) throw new Error("Selection file changed");
    // Read at most one byte past the limit, including when the file grows after stat.
    const bytes = Buffer.alloc(maximumSelectionBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maximumSelectionBytes || snapshot(await file.stat({ bigint: true })) !== expected
      || snapshot(await stat(path, { bigint: true })) !== expected) throw new Error("Invalid selection file");
    const json = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length));
    return selectionSchema.parse(JSON.parse(json));
  } finally {
    await file.close();
  }
}

try {
  // Startup configuration is supplied explicitly by the operator.
  const path = process.env.OMP_WEB_DELIVERY_SELECTION;
  const selection = path === undefined ? undefined : await readSelection(path);
  console.info(JSON.stringify(await inspectDeliveryGate(selection)));
} catch {
  console.info(JSON.stringify({ status: "blocked", sessionAdmission: "blocked", code: "DELIVERY_SELECTION_INVALID" }));
}
process.exitCode = 2;
