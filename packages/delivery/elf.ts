import type { FileHandle } from "node:fs/promises";
import { canonical, readRange, refuse, type ReleaseObservation } from "./observation.ts";

interface Segment { type: number; offset: number; address: bigint; size: number }
export interface ElfMetadata { needed: string[]; interpreter: string | undefined; soname: string | undefined }
function bounded(value: bigint): number {
  if (value > 1_073_741_824n) refuse();
  return Number(value);
}
function stringAt(bytes: Buffer, offset: number): string {
  const end = bytes.indexOf(0, offset);
  if (offset < 0 || end < offset || end - offset > 4096) refuse();
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset, end));
}
async function dynamic(file: FileHandle, size: number, segments: Segment[]): Promise<Pick<ElfMetadata, "needed" | "soname">> {
  const tables = segments.filter(segment => segment.type === 2);
  if (tables.length > 1) refuse();
  if (!tables[0]) return { needed: [], soname: undefined };
  const bytes = await readRange(file, size, tables[0].offset, tables[0].size);
  if (bytes.length % 16 !== 0) refuse();
  const fields = new Map<bigint, bigint>(), needed: number[] = [];
  let ended = false;
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const tag = bytes.readBigUInt64LE(offset), value = bytes.readBigUInt64LE(offset + 8);
    if (tag === 0n) { ended = true; break; }
    if ([15n, 29n, 0x6ffffefbn, 0x6ffffefcn, 0x7ffffffdn, 0x7fffffffn].includes(tag)) refuse();
    if (tag === 1n) {
      if (needed.length >= 256) refuse();
      needed.push(bounded(value));
    }
    if ([5n, 10n, 14n].includes(tag)) {
      if (fields.has(tag)) refuse();
      fields.set(tag, value);
    }
  }
  const strings = fields.get(5n), length = fields.get(10n);
  if (!ended || strings === undefined || length === undefined || length < 1n || length > 1_048_576n) refuse();
  const loads = segments.filter(segment => segment.type === 1 && segment.address <= strings
    && strings + length <= segment.address + BigInt(segment.size));
  if (loads.length !== 1) refuse();
  const load = loads[0]!;
  const contents = await readRange(file, size, load.offset + bounded(strings - load.address), Number(length));
  const names = needed.map(offset => stringAt(contents, offset));
  const name = fields.get(14n), soname = name === undefined ? undefined : stringAt(contents, bounded(name));
  if ([...names, ...(soname === undefined ? [] : [soname])].some(value => !/^[A-Za-z0-9_.+-]{1,255}$/.test(value))
    || new Set(names).size !== names.length) refuse();
  return { needed: names, soname };
}

/** Linux ELF64 little-endian metadata only; the file never enters a loader or executable process. */
export async function inspectElf(observation: ReleaseObservation, location: string): Promise<ElfMetadata | undefined> {
  return observation.read(location, 1_073_741_824, async (file, size) => {
    if (size < 4 || !(await readRange(file, size, 0, 4)).equals(Buffer.from([127, 69, 76, 70]))) return undefined;
    const header = await readRange(file, size, 0, 64);
    const machine = process.arch === "x64" ? 62 : process.arch === "arm64" ? 183 : refuse();
    if (header[4] !== 2 || header[5] !== 1 || header[6] !== 1 || header.readUInt32LE(20) !== 1
      || ![2, 3].includes(header.readUInt16LE(16)) || header.readUInt16LE(18) !== machine
      || header.readUInt16LE(52) !== 64 || header.readUInt16LE(54) !== 56) refuse();
    const count = header.readUInt16LE(56), offset = bounded(header.readBigUInt64LE(32));
    if (count < 1 || count > 128 || offset > 1_048_576) refuse();
    const table = await readRange(file, size, offset, count * 56), segments: Segment[] = [];
    for (let index = 0; index < count; index++) {
      const at = index * 56;
      const segment = { type: table.readUInt32LE(at), offset: bounded(table.readBigUInt64LE(at + 8)),
        address: table.readBigUInt64LE(at + 16), size: bounded(table.readBigUInt64LE(at + 32)) };
      if (segment.offset + segment.size > size || segment.address + BigInt(segment.size) > 0xffffffffffffffffn) refuse();
      segments.push(segment);
    }
    const interpreters = segments.filter(segment => segment.type === 3);
    if (interpreters.length > 1) refuse();
    let interpreter: string | undefined;
    if (interpreters[0]) {
      const value = interpreters[0], bytes = await readRange(file, size, value.offset, value.size);
      interpreter = stringAt(bytes, 0); canonical(interpreter);
      if (bytes.length !== Buffer.byteLength(interpreter) + 1) refuse();
    }
    return { ...await dynamic(file, size, segments), interpreter };
  });
}
