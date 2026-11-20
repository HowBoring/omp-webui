/** Loopback Browser View against the owned Session carrier with synthetic catalog metadata and no worker. */
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { startSessionComponentServer } from "../../apps/host/src/session-component-server.ts";
import { identifyAsset, type InstallationManifest } from "../../packages/compatibility/installation.ts";
import { CatalogClient } from "../../packages/contracts/generated/catalog-client.ts";
import type { CatalogDescriptor } from "../../packages/contracts/generated/omp-wire.ts";
import { DirectoryGrants } from "../../packages/workspaces/grants.ts";

const now = "2026-01-01T00:00:00Z";
const observed = { observedAt: now, createdAt: now, modifiedAt: now };
const root = await mkdtemp(join(tmpdir(), "workspace-browser-"));
const assets = join(root, "browser");
const manifest = join(root, "trust", "component", "manifest.json");
const dataDir = join(root, "state");
const project = join(root, "project");
const other = join(root, "other");

function descriptor(id: string, title: string, cwd = project): CatalogDescriptor {
  return { ...observed, reference: id, sourceId: "synthetic-source", instanceId: "synthetic-instance",
    nativeSessionId: id, title, cwd: { status: "known", recorded: cwd, canonical: cwd }, aliases: [],
    ownership: { state: "free", observedAt: now } };
}

const items = [descriptor("verified", "Cached verified title"), descriptor("replaced", "Cached replacement title"),
  descriptor("missing", "Cached missing title", other),
  ...Array.from({ length: 32 }, (_, i) => descriptor(`fixture-${i}`, `Saved Session ${i}`))];
const discovered = descriptor("discovered-only", "Unregistered discovery", other);
const all = [...items, discovered];
const catalog = new CatalogClient(async command => {
  if (command.type === "describe_session") {
    const item = all.find(row => row.reference === command.reference);
    if (!item || item.nativeSessionId === "missing") return { status: "missing", observedAt: now };
    const current = item.nativeSessionId === "replaced"
      ? { ...item, title: "Unrelated replacement title", instanceId: "replacement-instance" }
      : item.nativeSessionId === "verified"
        ? { ...item, title: "Current verified title", ownership: { state: "held", observedAt: now } } : item;
    return { status: "verified", observedAt: now, item: current };
  }
  if (command.type === "catalog_page") {
    if (command.cursor !== undefined && command.cursor !== "catalog-next") throw new Error("UNEXPECTED_CATALOG_CURSOR");
    const offset = command.cursor === undefined ? 0 : 32;
    const page = all.slice(offset, offset + (command.pageSize ?? 32));
    return { status: offset === 0 ? "partial" : "complete", snapshot: "synthetic", observedAt: now,
      expiresAt: "2099-01-01T00:00:00Z", examined: page.length, failures: [], items: page,
      ...(offset + page.length < all.length ? { nextCursor: "catalog-next" } : {}) };
  }
  throw new Error("UNEXPECTED_PUBLIC_RPC");
});

async function trustBrowserAssets(): Promise<void> {
  await Promise.all([mkdir(assets), mkdir(dirname(manifest), { recursive: true })]);
  const files = await Promise.all(["client.js", "index.html"].map(async file => {
    await copyFile(join("vendor/dsh-sessions", file), join(assets, file));
    return identifyAsset(root, join("browser", file), manifest);
  }));
  const digest = "0".repeat(64);
  // Only static assets are used here. No runtime, launcher or Native execution is selected.
  const trust: InstallationManifest = { format: "omp-webui-s0-v1", base: "57771ae562b9345e0579bceb2d68d585e3e6927e",
    patch: digest, schema: digest, launcher: "unused", target: "unused",
    runtime: { path: "unused", kind: "file", identity: digest, mode: 0 }, assets: files, runtimeDependencies: [],
    platform: process.platform, arch: process.arch };
  await writeFile(manifest, JSON.stringify(trust));
}

try {
  await Promise.all([mkdir(project), mkdir(other), trustBrowserAssets()]);
  const grants = new DirectoryGrants(dataDir);
  try { grants.confirm(grants.preview(project).confirmation); } finally { grants.close(); }
  const host = await startSessionComponentServer({ catalog, dataDir, assets, port: 0, manifest,
    launcher: "unused", async launch() { throw new Error("UNEXPECTED_WORKER_LAUNCH"); } });
  try {
    for (const item of items) {
      const record = host.index.register(item);
      if (item.nativeSessionId === "replaced") {
        host.index.observe(record.id, { state: "outcome_unknown", code: "SESSION_HOST_RESTARTED_MANUAL_OPEN_REQUIRED" });
      }
    }
    const browser = Bun.spawn([process.env.OMP_WEB_PYTHON ?? "python3", "tests/sessions/workspace-browser.py", project],
      { stdin: "pipe", stdout: "inherit", stderr: "inherit" });
    browser.stdin.write(host.bootstrapLink() + "\n");
    await browser.stdin.end();
    if (await browser.exited !== 0) throw new Error("WORKSPACE_BROWSER_FAILED");
    if (host.supervisor.starts !== 0) throw new Error("UNEXPECTED_WORKER_LAUNCH");
  } finally { await host.stop(); }
} finally { await rm(root, { recursive: true, force: true }); }
