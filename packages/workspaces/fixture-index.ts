/** Deliberate synthetic acceptance metadata provider. No product Host imports this module. */
import { z } from "zod";
import type { SessionIndexReader } from "./index.ts";
const metadata = z.strictObject({ id: z.string().max(128), reference: z.string().max(4096),
  nativeSessionId: z.string().max(128), title: z.string().max(8192).optional(), cwd: z.string().max(4096).optional() });
const identity = z.string().min(1).max(4096);
const records = z.array(z.union([metadata.extend({ sourceId: identity, instanceId: identity }), metadata])).max(256);
export async function syntheticIndex(path: string): Promise<SessionIndexReader> {
  const items = records.parse(await Bun.file(path).json());
  return { async page(options) {
    const cursor = options.cursor ?? "0";
    if (!/^(0|[1-9][0-9]{0,3})$/.test(cursor)) throw new Error("INDEX_CURSOR_INVALID");
    const offset = Number(cursor), size = options.pageSize ?? 32;
    return { records: items.slice(offset, offset + size),
      ...(offset + size < items.length ? { nextCursor: String(offset + size) } : {}) };
  } };
}
