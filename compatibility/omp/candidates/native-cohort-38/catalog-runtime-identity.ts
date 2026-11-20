import { strict as assert } from "node:assert";
import {
  closeSync, constants, fstatSync, lstatSync, opendirSync, openSync, readlinkSync, readSync, realpathSync, statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import inputs from "./catalog-runtime-inputs.json";

function hashFile(path: string, bytes: number, buffer: Uint8Array): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, { bigint: true });
    assert.ok(before.isFile() && before.size === BigInt(bytes), `Unexpected file size or type: ${path}`);
    const hash = new Bun.CryptoHasher("sha256");
    let remaining = bytes;
    while (remaining > 0) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.byteLength, remaining), null);
      assert.ok(count > 0, `File ended before its recorded size: ${path}`);
      hash.update(buffer.subarray(0, count));
      remaining -= count;
    }
    const after = fstatSync(fd, { bigint: true });
    assert.ok(before.size === after.size && before.ctimeNs === after.ctimeNs, `File changed during read: ${path}`);
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}

function sortedNames(path: string, limit: number): string[] {
  const directory = opendirSync(path);
  const names: string[] = [];
  try {
    for (let next = directory.readSync(); next !== null; next = directory.readSync()) {
      assert.ok(names.length < limit, "Staged catalog inventory exceeds its entry count");
      names.push(next.name);
    }
  } finally {
    directory.closeSync();
  }
  return names.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

function verifyInventory(root: string, buffer: Uint8Array): string {
  const expected = inputs.stagedInventory;
  const digest = new Bun.CryptoHasher("sha256");
  let entries = 0, bytes = 0;
  // Depth-first, with UTF-8 byte ordering within each directory. The root record has an empty relative path.
  function visit(path: string, relative: string, depth: number): void {
    assert.ok(++entries <= expected.entries && depth <= expected.maxDepth, "Staged catalog inventory exceeds bounds");
    const info = lstatSync(path);
    const mode = (info.mode & 0o7777).toString(8);
    if (info.isDirectory()) {
      digest.update(`${relative}\0dir\0${mode}\0`);
      for (const name of sortedNames(path, expected.entries - entries)) {
        visit(join(path, name), relative === "" ? name : `${relative}/${name}`, depth + 1);
      }
      return;
    }
    if (info.isSymbolicLink()) {
      digest.update(`${relative}\0link\0${mode}\0${readlinkSync(path)}\0`);
      return;
    }
    assert.ok(info.isFile() && info.nlink === 1, `Unexpected staged catalog file type: ${relative}`);
    bytes += info.size;
    assert.ok(bytes <= expected.fileBytes, "Staged catalog inventory exceeds its byte count");
    digest.update(`${relative}\0file\0${mode}\0${info.size}\0${hashFile(path, info.size, buffer)}\0`);
  }
  visit(root, "", 0);
  assert.equal(entries, expected.entries, "Staged catalog inventory entry count differs");
  assert.equal(bytes, expected.fileBytes, "Staged catalog inventory byte count differs");
  const sha256 = digest.digest("hex");
  assert.equal(sha256, expected.sha256, "Staged catalog inventory SHA-256 differs");
  return sha256;
}

export function verifyCatalogRuntime(candidate: string) {
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, "x64");
  assert.equal(Bun.version, "1.4.4");
  assert.equal(process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH, "0");
  assert.equal(process.env.NODE_DISABLE_COMPILE_CACHE, "1");
  const root = realpathSync(candidate);
  assert.equal(root, resolve(candidate));
  const info = lstatSync(root);
  assert.ok(info.isDirectory() && (info.mode & 0o7777) === 0o700 && info.uid === process.getuid?.(),
    "Expected a private staged catalog root owned by the proof runner");
  const path = realpathSync(process.execPath);
  const running = statSync("/proc/self/exe", { bigint: true });
  const selected = statSync(path, { bigint: true });
  assert.ok(running.dev === selected.dev && running.ino === selected.ino, "Bun executable path changed since startup");
  const buffer = new Uint8Array(64 * 1024);
  const bunSha256 = hashFile(path, inputs.bun.bytes, buffer);
  assert.equal(bunSha256, inputs.bun.sha256, "Bun executable SHA-256 differs");
  return { bunSha256, stagedInventorySha256: verifyInventory(root, buffer) };
}

if (import.meta.main) {
  const [candidate] = process.argv.slice(2);
  assert.ok(candidate && process.argv.length === 3, "expected staged candidate path");
  console.log(JSON.stringify({ status: "CATALOG_RUNTIME_IDENTITY", ...verifyCatalogRuntime(candidate) }));
}
