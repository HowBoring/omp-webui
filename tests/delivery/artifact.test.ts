import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { cp, link, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureRelease } from "./fixtures.ts";
import { inspectRelease, writeReleaseManifest } from "../../packages/delivery/artifact.ts";

/** Approved seam: real filesystem release enrollment/verification; no executable or native Session is opened. */

const enroll = (root: string) => writeReleaseManifest({ root, platformDependencies: [] });

test("held release remains valid after an unrelated sibling directory is created", async () => {
  const parent = await mkdtemp(join(tmpdir(), "delivery-sibling-"));
  try {
    const root = await fixtureRelease(parent);
    const expectedIdentity = await enroll(root);
    const release = await inspectRelease({ root, expectedIdentity });
    await fs.mkdir(join(parent, "unrelated-sibling"));
    await release.verify();
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("a release directory gains a full snapshot when first inventoried and retains it during parent checks", async () => {
  const parent = await mkdtemp(join(tmpdir(), "delivery-member-role-"));
  try {
    const root = await fixtureRelease(parent), transient = join(root, "transient");
    const expectedIdentity = await enroll(root);
    const original = fs.open;
    let changed = false;
    const mock = spyOn(fs, "open").mockImplementation(async (location, flags, mode) => {
      if (!changed && location === join(root, "release.json")) {
        changed = true;
        // Before inventory, root is only a canonical ancestor of the manifest.
        await fs.mkdir(transient); await rm(transient, { recursive: true });
      }
      return original(location, flags, mode);
    });
    let release;
    try { release = await inspectRelease({ root, expectedIdentity }); }
    finally { mock.mockRestore(); }
    await release.verify();
    // The same final child roster after enrollment must not erase a member's changed full snapshot.
    await fs.mkdir(transient); await rm(transient, { recursive: true });
    await expect(release.verify()).rejects.toThrow("RELEASE_UNVERIFIED");
    await expect(release.verify()).rejects.toThrow("RELEASE_UNVERIFIED");
  } finally { await rm(parent, { recursive: true, force: true }); }
});

for (const mutation of ["parent-mode", "parent-replacement", "parent-symlink", "parent-file", "member-entry"] as const) {
  test(`held public release permanently refuses ${mutation}`, async () => {
    const outer = await mkdtemp(join(tmpdir(), "delivery-parent-control-")), parent = join(outer, "owned");
    try {
      const root = await fixtureRelease(parent);
      await fs.chmod(parent, 0o755);
      const expectedIdentity = await enroll(root);
      const release = await inspectRelease({ root, expectedIdentity });
      if (mutation === "parent-mode") await fs.chmod(parent, 0o700);
      if (["parent-replacement", "parent-symlink", "parent-file"].includes(mutation)) {
        const retained = join(outer, "retained");
        await rename(parent, retained);
        if (mutation === "parent-replacement") {
          await fs.mkdir(parent); await rename(join(retained, "release"), root);
        }
        if (mutation === "parent-symlink") await symlink("retained", parent);
        if (mutation === "parent-file") await writeFile(parent, "not a traversal directory");
      }
      if (mutation === "member-entry") await fs.mkdir(join(root, "worker/unlisted"));
      await expect(release.verify()).rejects.toThrow("RELEASE_UNVERIFIED");
      if (mutation === "parent-mode") await fs.chmod(parent, 0o755);
      await expect(release.verify()).rejects.toThrow("RELEASE_UNVERIFIED");
    } finally { await rm(outer, { recursive: true, force: true }); }
  });
}

test("independently approved exhaustive release inventory survives relocation", async () => {
  const parent = await mkdtemp(join(tmpdir(), "delivery-release-"));
  try {
    const root = await fixtureRelease(parent);
    const expectedIdentity = await enroll(root);
    const relocated = join(parent, "relocated");
    await cp(root, relocated, { recursive: true });
    const release = await inspectRelease({ root: relocated, expectedIdentity });
    expect(release.manifest.stage).toBe("unaccepted-artifact");
    expect(release.target).toBe(join(relocated, "worker/cli.js"));
    await release.verify();
  } finally { await rm(parent, { recursive: true, force: true }); }
});


test("enrollment refuses hardlinked bytes whose external owner could modify the release", async () => {
  const parent = await mkdtemp(join(tmpdir(), "delivery-hardlink-"));
  try {
    const root = await fixtureRelease(parent);
    await writeFile(join(parent, "outside"), "mutable outside owner");
    await link(join(parent, "outside"), join(root, "worker/shared.js"));
    await expect(enroll(root)).rejects.toThrow("RELEASE_HARDLINK_UNSUPPORTED");
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("enrollment rejects absolute link dependencies that would still name the old release after relocation", async () => {
  const parent = await mkdtemp(join(tmpdir(), "delivery-absolute-link-"));
  try {
    const root = await fixtureRelease(parent);
    await symlink(join(root, "worker/cli.js"), join(root, "worker/alias.js"));
    await expect(enroll(root)).rejects.toThrow("RELEASE_LINK_ABSOLUTE");
  } finally { await rm(parent, { recursive: true, force: true }); }
});


test("a held release verification refuses manifest-path replacement with a same-byte symlink", async () => {
  const parent = await mkdtemp(join(tmpdir(), "delivery-manifest-path-"));
  try {
    const root = await fixtureRelease(parent);
    const expectedIdentity = await enroll(root);
    const release = await inspectRelease({ root, expectedIdentity });
    await rename(join(root, "release.json"), join(parent, "manifest-copy"));
    await symlink(join(parent, "manifest-copy"), join(root, "release.json"));
    await expect(release.verify()).rejects.toThrow();
  } finally { await rm(parent, { recursive: true, force: true }); }
});

for (const mutation of ["same-version-bytes", "unlisted-dependency", "mode", "omitted-native", "stale-trust"] as const) {
  test(`release verification refuses ${mutation}`, async () => {
    const parent = await mkdtemp(join(tmpdir(), "delivery-negative-"));
    try {
      const root = await fixtureRelease(parent);
      const expectedIdentity = await enroll(root);
      if (mutation === "same-version-bytes") await writeFile(join(root, "worker/cli.js"), "same version changed bytes");
      if (mutation === "unlisted-dependency") await writeFile(join(root, "worker/unlisted.js"), "unreviewed");
      if (mutation === "mode") await (await import("node:fs/promises")).chmod(join(root, "runtime/bun"), 0o644);
      if (mutation === "omitted-native") {
        const path = join(root, "release.json");
        const manifest = JSON.parse(await readFile(path, "utf8"));
        manifest.assets = manifest.assets.filter((asset: { path: string }) => !asset.path.startsWith("native"));
        await writeFile(path, JSON.stringify(manifest));
        // Even independently accepting this malformed inventory cannot hide omitted physical bytes.
        const { digest } = await import("../../packages/compatibility/installation.ts");
        await expect(inspectRelease({ root, expectedIdentity: digest(await readFile(path)) }))
          .rejects.toThrow("RELEASE_UNVERIFIED");
        return;
      }
      if (mutation === "stale-trust") {
        await writeFile(join(root, "worker/cli.js"), "newly inventoried but not approved");
        await enroll(root);
      }
      await expect(inspectRelease({ root, expectedIdentity })).rejects.toThrow("RELEASE_UNVERIFIED");
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
}

test("explicit enrollment refuses an existing linked manifest without overwriting its outside target", async () => {
  const parent = await mkdtemp(join(tmpdir(), "delivery-enroll-path-"));
  try {
    const root = await fixtureRelease(parent);
    const outside = join(parent, "outside-manifest");
    await writeFile(outside, "preserve outside bytes");
    await symlink(outside, join(root, "release.json"));
    await expect(enroll(root)).rejects.toThrow("RELEASE_MANIFEST_PATH_UNSUPPORTED");
    expect(await readFile(outside, "utf8")).toBe("preserve outside bytes");
  } finally { await rm(parent, { recursive: true, force: true }); }
});
