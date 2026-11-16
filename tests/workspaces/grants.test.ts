import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DirectoryGrants } from "../../packages/workspaces/grants.ts";

// Confirmed seams: public Host policy/module contract + actual authenticated browser/DSH/Bun/public OMP.
// This complementary contract test observes authorization and durable state, never SQLite internals.
test("explicit canonical grant persists, includes descendants, rejects prefix confusion and revokes durably", async () => {
  const home = await mkdtemp(join(tmpdir(), "omp-grants-"));
  const root = join(home, "project"), child = join(root, "child"), other = join(home, "project-other");
  await mkdir(child, { recursive: true }); await mkdir(other);
  let grants = new DirectoryGrants(join(home, "state"));
  try {
    expect(grants.authorize(root).status).toBe("ungranted");
    const preview = grants.preview(root);
    expect(preview.path).toBe(root);
    expect(grants.authorize(root).status).toBe("ungranted");
    grants.confirm(preview.confirmation);
    expect(grants.authorize(child).status).toBe("authorized");
    expect(grants.authorize(other).status).toBe("ungranted");
    grants.close(); grants = new DirectoryGrants(join(home, "state"));
    expect(grants.authorize(child).status).toBe("authorized");
    grants.revoke(grants.list()[0]!.id);
    grants.close(); grants = new DirectoryGrants(join(home, "state"));
    expect(grants.authorize(child).status).toBe("ungranted");
  } finally { grants.close(); await rm(home, { recursive: true, force: true }); }
});

test("symlink escape, source cwd replacement and canonical-root replacement never inherit old rights", async () => {
  const home = await mkdtemp(join(tmpdir(), "omp-grants-paths-"));
  const root = join(home, "project"), outside = join(home, "outside"), link = join(root, "link");
  await mkdir(root); await mkdir(outside); await symlink(outside, link);
  const grants = new DirectoryGrants(join(home, "state"));
  try {
    grants.confirm(grants.preview(root).confirmation);
    expect(grants.authorize(link).status).toBe("ungranted");
    expect(grants.authorize(link, root).status).toBe("changed");
    expect(grants.authorize().status).toBe("unknown");
    expect(grants.authorize(join(home, "missing")).status).toBe("missing");
    const pending = grants.preview(root);
    await rename(root, join(home, "moved"));
    expect(grants.authorize(root).status).toBe("missing");
    await mkdir(root);
    expect(() => grants.confirm(pending.confirmation)).toThrow("DIRECTORY_CHANGED");
    expect(grants.list()[0]!.status).toBe("changed");
    expect(grants.authorize(root).status).toBe("changed");
    grants.confirm(grants.preview(root).confirmation);
    expect(grants.authorize(root).status).toBe("authorized");
  } finally { grants.close(); await rm(home, { recursive: true, force: true }); }
});

test("confirmation expiry, single use and lost durable state fail closed", async () => {
  const home = await mkdtemp(join(tmpdir(), "omp-grants-expiry-"));
  let now = Date.UTC(2026, 0, 1);
  const grants = new DirectoryGrants(join(home, "state"), () => now);
  try {
    const expired = grants.preview(home); now += 60_000;
    expect(() => grants.confirm(expired.confirmation)).toThrow("GRANT_PREVIEW_EXPIRED");
    const fresh = grants.preview(home); grants.confirm(fresh.confirmation);
    expect(() => grants.confirm(fresh.confirmation)).toThrow("GRANT_PREVIEW_EXPIRED");
    expect(grants.authorize(home).status).toBe("authorized");
    await rm(join(home, "state", "directory-grants.sqlite"));
    expect(() => grants.authorize(home)).toThrow();
  } finally { grants.close(); await rm(home, { recursive: true, force: true }); }
});

test("revoking an ancestor preserves only separately granted descendants", async () => {
  const home = await mkdtemp(join(tmpdir(), "omp-grants-overlap-"));
  const child = join(home, "child"), sibling = join(home, "sibling");
  await mkdir(child); await mkdir(sibling);
  const grants = new DirectoryGrants(join(home, "state"));
  try {
    const ancestor = grants.confirm(grants.preview(home).confirmation);
    grants.confirm(grants.preview(child).confirmation);
    grants.revoke(ancestor.id);
    expect(grants.authorize(child).status).toBe("authorized");
    expect(grants.authorize(sibling).status).toBe("ungranted");
  } finally { grants.close(); await rm(home, { recursive: true, force: true }); }
});
