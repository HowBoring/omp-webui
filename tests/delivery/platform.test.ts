import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import type { BigIntStats, StatOptions, Stats } from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { resolveGlobalSelection } from "../../packages/delivery/resolver.ts";
import { fixtureRelease } from "./fixtures.ts";
import { inspectRelease, writeReleaseManifest } from "../../packages/delivery/artifact.ts";

/** Worked ELF64 LE vector: one load at vaddr 0x1000, optional dynamic strings and PT_INTERP.
 * These are inert metadata bytes, never executed, loaded, compiled or copied from the host. */
function elf(input: { needed?: string; interpreter?: string } = {}): Buffer {
  const bytes = Buffer.alloc(Math.max(1024, 769 + Buffer.byteLength(input.interpreter ?? "")));
  bytes.set([127, 69, 76, 70, 2, 1, 1]);
  bytes.writeUInt16LE(3, 16); bytes.writeUInt16LE(process.arch === "arm64" ? 183 : 62, 18);
  bytes.writeUInt32LE(1, 20); bytes.writeBigUInt64LE(64n, 32);
  bytes.writeUInt16LE(64, 52); bytes.writeUInt16LE(56, 54);
  const count = 1 + Number(!!input.needed) + Number(!!input.interpreter);
  bytes.writeUInt16LE(count, 56);
  const segment = (index: number, type: number, offset: number, size: number, address = 0n) => {
    const at = 64 + index * 56;
    bytes.writeUInt32LE(type, at); bytes.writeBigUInt64LE(BigInt(offset), at + 8);
    bytes.writeBigUInt64LE(address, at + 16); bytes.writeBigUInt64LE(BigInt(size), at + 32);
  };
  segment(0, 1, 0, bytes.length, 0x1000n);
  let index = 1;
  if (input.needed) {
    segment(index++, 2, 256, 64);
    // DT_NEEDED index 1; DT_STRTAB virtual 0x1200; DT_STRSZ; DT_NULL.
    bytes.writeBigUInt64LE(1n, 256); bytes.writeBigUInt64LE(1n, 264);
    bytes.writeBigUInt64LE(5n, 272); bytes.writeBigUInt64LE(0x1200n, 280);
    bytes.writeBigUInt64LE(10n, 288); bytes.writeBigUInt64LE(BigInt(input.needed.length + 2), 296);
    bytes.write(input.needed, 513);
  }
  if (input.interpreter) {
    segment(index, 3, 768, Buffer.byteLength(input.interpreter) + 1);
    bytes.write(input.interpreter, 768);
  }
  return bytes;
}

async function fixture() {
  const parent = await fs.mkdtemp("/tmp/host-platform-");
  const root = await fixtureRelease(parent), platform = path.join(parent, "platform");
  await fs.mkdir(path.join(platform, "real"), { recursive: true });
  await fs.chmod(path.join(platform, "real"), 0o755);
  const loader = path.join(platform, "real/ld-linux-vector.so.2");
  const libc = path.join(platform, "real/libc.so.6");
  const directoryAlias = path.join(platform, "lib64");
  const loaderAlias = path.join(platform, "real/interpreter");
  await fs.symlink("real", directoryAlias);
  await fs.symlink("ld-linux-vector.so.2", loaderAlias);
  await fs.writeFile(loader, elf());
  await fs.writeFile(libc, elf({ interpreter: path.join(directoryAlias, "interpreter") }));
  await fs.writeFile(path.join(root, "worker/cli.js"), elf({ needed: "libc.so.6" }));
  return { parent, root, loader, libc, directoryAlias, loaderAlias,
    dependencies: [loader, libc, directoryAlias, loaderAlias] };
}

test("public release inspection verifies recursively required relative interpreter aliases", async () => {
  const value = await fixture();
  try {
    const expectedIdentity = await writeReleaseManifest({ root: value.root, platformDependencies: value.dependencies });
    const release = await inspectRelease({ root: value.root, expectedIdentity });
    expect(release.manifest.platformDependencies.filter(value => value.kind === "link").length).toBe(2);
    await release.verify();
  } finally { await fs.rm(value.parent, { recursive: true, force: true }); }
});

test("held selected release tolerates unrelated children of interpreter traversal directories", async () => {
  const value = await fixture();
  try {
    const expectedIdentity = await writeReleaseManifest({ root: value.root, platformDependencies: value.dependencies });
    const selected = await resolveGlobalSelection({ root: value.root, expectedIdentity, entry: path.join(value.root, "bin/omp") });
    const sibling = path.join(path.dirname(value.loader), "unrelated-sibling");
    await fs.mkdir(sibling);
    await selected.verify();
    await fs.writeFile(path.join(sibling, "unrelated-file"), "outside release and platform members");
    await selected.verify();
    await fs.rm(sibling, { recursive: true });
    await selected.verify();
  } finally { await fs.rm(value.parent, { recursive: true, force: true }); }
});

for (const mutation of ["same-content-target", "same-text-alias", "ancestor", "mode", "read-error", "read-race", "during-read", "owner-observation"] as const) {
  test(`held public release permanently refuses ${mutation}`, async () => {
    const value = await fixture();
    try {
      const expectedIdentity = await writeReleaseManifest({ root: value.root, platformDependencies: value.dependencies });
      const release = await inspectRelease({ root: value.root, expectedIdentity });
      let restore = () => {};
      if (mutation === "same-content-target") {
        await fs.writeFile(value.loader + ".replacement", await fs.readFile(value.loader));
        await fs.rename(value.loader + ".replacement", value.loader);
      }
      if (mutation === "same-text-alias") {
        await fs.unlink(value.loaderAlias); await fs.symlink("ld-linux-vector.so.2", value.loaderAlias);
      }
      if (mutation === "ancestor") await fs.chmod(path.dirname(value.loader), 0o700);
      if (mutation === "mode") await fs.chmod(value.loader, 0o700);
      if (["read-error", "read-race", "during-read", "owner-observation"].includes(mutation)) {
        const original = fs.open;
        const mock = spyOn(fs, "open").mockImplementation(async (location, flags, mode) => {
          if (location === value.loader) {
            if (mutation === "read-error") throw new Error("controlled read refusal with sensitive path");
            if (mutation === "read-race") {
              await fs.writeFile(value.loader + ".replacement", await fs.readFile(value.loader));
              await fs.rename(value.loader + ".replacement", value.loader);
            }
          }
          const file = await original(location, flags, mode);
          if (location === value.loader && mutation === "during-read") {
            const read = file.read;
            let changed = false;
            spyOn(file, "read").mockImplementation(async (...args) => {
              const result = await Reflect.apply(read, file, args);
              if (!changed) { changed = true; await fs.appendFile(value.loader, Buffer.from([0])); }
              return result;
            });
          }
          if (location === value.loader && mutation === "owner-observation") {
            const stat = file.stat.bind(file);
            function drift(options?: StatOptions & { bigint?: false }): Promise<Stats>;
            function drift(options: StatOptions & { bigint: true }): Promise<BigIntStats>;
            function drift(options?: StatOptions): Promise<Stats | BigIntStats>;
            async function drift(options?: StatOptions): Promise<Stats | BigIntStats> {
              const metadata = await stat(options);
              const uid = typeof metadata.uid === "bigint" ? metadata.uid + 1n : metadata.uid + 1;
              Object.defineProperty(metadata, "uid", { value: uid });
              return metadata;
            }
            spyOn(file, "stat").mockImplementation(drift);
          }
          return file;
        });
        restore = () => mock.mockRestore();
      }
      try { await expect(release.verify()).rejects.toThrow("RELEASE_UNVERIFIED"); }
      finally { restore(); }
      await fs.chmod(path.dirname(value.loader), 0o755); await fs.chmod(value.loader, 0o644);
      // Restoring bytes/modes or removing a transient read fault cannot revive the held generation.
      await expect(release.verify()).rejects.toThrow("RELEASE_UNVERIFIED");
    } finally { await fs.rm(value.parent, { recursive: true, force: true }); }
  });
}

for (const invalid of ["unsigned", "unused", "cycle", "dangling", "absolute", "indirect-parent", "missing-recursive-interpreter",
  "unknown-target", "duplicate", "special-mode", "needed-provider", "architecture", "loader-search", "over-budget"] as const) {
  test(`public inventory refuses ${invalid} platform closure`, async () => {
    const value = await fixture();
    try {
      let dependencies = value.dependencies;
      if (invalid === "unsigned") dependencies = dependencies.filter(file => file !== value.directoryAlias);
      if (invalid === "unused") {
        const extra = path.join(value.parent, "extra"); await fs.symlink("platform/real", extra); dependencies.push(extra);
      }
      if (["cycle", "dangling", "absolute", "unknown-target"].includes(invalid)) {
        await fs.unlink(value.loaderAlias);
        const target = invalid === "cycle" ? "interpreter" : invalid === "dangling" ? "missing"
          : invalid === "absolute" ? value.loader : "libc.so.6";
        await fs.symlink(target, value.loaderAlias);
      }
      if (invalid === "indirect-parent") dependencies.push(path.join(value.directoryAlias, "ld-linux-vector.so.2"));
      if (invalid === "missing-recursive-interpreter") dependencies = dependencies.filter(file => file !== value.loaderAlias);
      if (invalid === "duplicate") dependencies.push(value.loader);
      if (invalid === "special-mode") await fs.chmod(value.libc, 0o4644);
      if (invalid === "needed-provider") await fs.writeFile(path.join(value.root, "worker/cli.js"), elf({ needed: "absent.so" }));
      if (invalid === "architecture") {
        const bytes = elf(); bytes.writeUInt16LE(0, 18); await fs.writeFile(value.loader, bytes);
      }
      if (invalid === "loader-search") {
        const bytes = elf({ needed: "libc.so.6" }); bytes.writeBigUInt64LE(29n, 256);
        await fs.writeFile(path.join(value.root, "worker/cli.js"), bytes);
      }
      if (invalid === "over-budget") dependencies = Array.from({ length: 257 }, (_, index) => `${value.loader}${index}`);
      await expect(writeReleaseManifest({ root: value.root, platformDependencies: dependencies })).rejects.toThrow();
    } finally { await fs.rm(value.parent, { recursive: true, force: true }); }
  });
}

test("the actual selected release accepts legacy canonical interpreter paths", async () => {
  const value = await fixture();
  try {
    await fs.writeFile(value.libc, elf({ interpreter: value.loader }));
    const expectedIdentity = await writeReleaseManifest({ root: value.root, platformDependencies: [value.loader, value.libc] });
    const selection = await resolveGlobalSelection({ root: value.root, expectedIdentity, entry: path.join(value.root, "bin/omp") });
    expect(selection.sessionAdmission).toBe("blocked");
    await selection.verify();
  } finally { await fs.rm(value.parent, { recursive: true, force: true }); }
});

for (const change of ["exact-target", "duplicate", "unknown-field", "outside-directory", "non-normalized", "alias-mode"] as const) {
  test(`the reader refuses independently pinned malformed inventory: ${change}`, async () => {
    const value = await fixture();
    try {
      await writeReleaseManifest({ root: value.root, platformDependencies: value.dependencies });
      const location = path.join(value.root, "release.json");
      const manifest: { platformDependencies: Array<{ path: string; kind: string; identity: string; mode: number }>;
        unexpected?: boolean } = JSON.parse(await fs.readFile(location, "utf8"));
      const alias = manifest.platformDependencies.find(member => member.path === value.loaderAlias)!;
      if (change === "exact-target") alias.identity = "./ld-linux-vector.so.2";
      if (change === "duplicate") manifest.platformDependencies.push(alias);
      if (change === "unknown-field") manifest.unexpected = true;
      if (change === "outside-directory") alias.kind = "directory";
      if (change === "non-normalized") alias.path = value.loaderAlias + "/../interpreter";
      if (change === "alias-mode") alias.mode = 0o700;
      const bytes = JSON.stringify(manifest, null, 2) + "\n";
      await fs.writeFile(location, bytes);
      // An independently supplied checksum cannot authorize malformed members or invent observed alias targets.
      const expectedIdentity = createHash("sha256").update(bytes).digest("hex");
      await expect(inspectRelease({ root: value.root, expectedIdentity })).rejects.toThrow("RELEASE_UNVERIFIED");
    } finally { await fs.rm(value.parent, { recursive: true, force: true }); }
  });
}

test("closure checks include ELF bytes outside the initial runtime and bridge", async () => {
  const value = await fixture();
  try {
    await fs.writeFile(path.join(value.root, "native/member"), elf({ needed: "missing-transitive.so" }));
    await expect(writeReleaseManifest({ root: value.root, platformDependencies: value.dependencies })).rejects.toThrow();
  } finally { await fs.rm(value.parent, { recursive: true, force: true }); }
});

for (const hops of [16, 17]) {
  test(`interpreter resolution enforces the sixteen-hop budget at ${hops} hops`, async () => {
    const value = await fixture();
    try {
      const directory = path.dirname(value.loader);
      const dependencies = [value.libc, value.loader];
      for (let index = 0; index < hops; index++) {
        const location = path.join(directory, `hop${index}`);
        await fs.symlink(index === hops - 1 ? "ld-linux-vector.so.2" : `hop${index + 1}`, location);
        dependencies.push(location);
      }
      await fs.writeFile(value.libc, elf({ interpreter: path.join(directory, "hop0") }));
      const enrollment = writeReleaseManifest({ root: value.root, platformDependencies: dependencies });
      if (hops === 17) await expect(enrollment).rejects.toThrow();
      else await inspectRelease({ root: value.root, expectedIdentity: await enrollment });
    } finally { await fs.rm(value.parent, { recursive: true, force: true }); }
  });
}

test("interpreter traversal refuses more than 256 pathname components", async () => {
  const value = await fixture();
  try {
    const directory = path.join(value.parent, ...Array.from({ length: 257 }, () => "d"));
    await fs.mkdir(directory, { recursive: true });
    const loader = path.join(directory, "ld-linux-vector.so.2");
    await fs.writeFile(loader, elf());
    await fs.writeFile(value.libc, elf({ interpreter: loader }));
    await expect(writeReleaseManifest({ root: value.root, platformDependencies: [loader, value.libc] })).rejects.toThrow();
  } finally { await fs.rm(value.parent, { recursive: true, force: true }); }
});

test("ambiguous ELF providers cannot invent a loader search order", async () => {
  const value = await fixture();
  try {
    await fs.writeFile(path.join(value.root, "native/libc.so.6"), elf());
    await expect(writeReleaseManifest({ root: value.root, platformDependencies: value.dependencies })).rejects.toThrow();
  } finally { await fs.rm(value.parent, { recursive: true, force: true }); }
});
