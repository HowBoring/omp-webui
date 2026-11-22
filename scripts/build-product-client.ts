/**
 * Build the frozen product browser tree: the pinned DSH Web shell, the audited
 * client roster's built bundles, and a boot graph served from enrolled files.
 *
 * The upstream Host composes that graph from its Cordis Loader rows and builds
 * combo scripts on demand. This Host is a Bun server, not a Cordis Loader, so
 * the same wire is composed here, once, at build time: `bootInjections` (the
 * upstream renderer input) is reused verbatim, every inline row is externalized
 * so the CSP needs no `unsafe-inline`, and `plugins/routes.json` maps each
 * served pathname to its enrolled file.
 */
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { bootInjections, orderByModuleGraph } from "@deepseek-ai/dsh-client-modules";
import type { WebBootEntry, WebBootGraph } from "@deepseek-ai/dsh-client-modules/client";
import { verifyDshSource } from "./dsh-source.ts";

/** Repository root, so one authored tree builds identically from any working directory. */
const repoRoot = resolve(import.meta.dir, "..");

/** Audited 28-package baseline from docs/client-composition.md (package names without the scope). */
export const baselineRoster = [
  "dsh-client-modules", "dsh-client-connection", "dsh-typert-registry", "dsh-api-gateway", "dsh-api-remotes",
  "dsh-client-file-upload", "dsh-api-session-controller", "dsh-api-remote-access", "dsh-api-workspace-controller",
  "dsh-client-ui-renderer", "dsh-client-ui-settings", "dsh-client-locale", "dsh-client-ui-theme", "dsh-client-shortcuts",
  "dsh-client-ui-layout", "dsh-client-ui-session", "dsh-client-ui-conversation", "dsh-client-ui-chat",
  "dsh-client-ui-tool", "dsh-client-ui-approval", "dsh-client-ui-user-questions", "dsh-client-ui-workspace",
  "dsh-client-ui-sidebar", "dsh-client-ui-sidebar-right", "dsh-client-resources", "dsh-client-ui-context-menu",
  "dsh-client-ui-file-drag", "dsh-client-ui-input-trigger",
].map(name => `@deepseek-ai/${name}`);

/** The one CMS boot package the HTML preloads and materializes first. */
const BOOTSTRAP_ID = "@deepseek-ai/dsh-client-modules";
/** Upstream combo URLs stay below conservative browser request-target limits. */
const MAX_COMBO_URL_BYTES = 3 * 1024;
const REV_LENGTH = 12;
/** Source-map trailers name a file this build does not serve. */
const SOURCE_MAP_TRAILER = /(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/;

interface ClientDeclaration {
  platform: string;
  inject?: string[];
  external?: string[];
  immediately?: boolean;
}

export interface PackagedPlugin {
  id: string;
  /** Absolute path of the built browser bundle. */
  bundle: string;
  inject?: string[];
  external?: string[];
  immediately?: boolean;
}

export interface ProductClientBuild {
  outdir: string;
  graph: WebBootGraph;
  /** Served pathname → enrolled file, relative to the product directory. */
  routes: Record<string, string>;
  /** Package ids in module-graph order, as served. */
  roster: string[];
}

/** Short content hash used as the immutable revision in every generated URL. */
function revisionOf(parts: readonly (string | Buffer)[]): string {
  const hash = createHash("sha1");
  for (const part of parts) hash.update(typeof part === "string" ? part : part).update("\0");
  return hash.digest("hex").slice(0, REV_LENGTH);
}

/** Document-relative plugin reference, identical to the upstream composer's wire. */
const comboReference = (ids: readonly string[], rev: string): string =>
  `plugins/??${ids.map(id => `${id}/client.js`).join(",")}&rev=${rev}`;

/** Resolve one package's declared browser bundle through its own manifest. */
async function packageBundle(name: string): Promise<PackagedPlugin> {
  const directory = resolve(repoRoot, "node_modules", name);
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as {
    name: string; exports?: Record<string, string | { default?: string }>; dsh?: { client?: ClientDeclaration };
  };
  const declaration = manifest.dsh?.client;
  if (declaration?.platform !== "web") throw new Error(`product client: ${name} declares no web dsh.client half`);
  const exported = manifest.exports?.["./client"];
  const entry = typeof exported === "string" ? exported : exported?.default;
  if (entry === undefined) throw new Error(`product client: ${name} declares dsh.client without a ./client export`);
  return {
    id: name,
    bundle: resolve(directory, entry),
    ...(declaration.inject === undefined ? {} : { inject: declaration.inject }),
    ...(declaration.external === undefined ? {} : { external: declaration.external }),
    ...(declaration.immediately === true ? { immediately: true } : {}),
  };
}

/** Copy the stock shell tree, dropping the page (rebuilt below) and debug maps. */
async function copyShell(dist: string, outdir: string): Promise<void> {
  for (const entry of await readdir(dist, { withFileTypes: true })) {
    if (entry.name === "index.html" || entry.name === "preview.html" || entry.name === "preview") continue;
    if (entry.name.endsWith(".map")) continue;
    await cp(join(dist, entry.name), join(outdir, entry.name), { recursive: true, filter: source => !source.endsWith(".map") });
  }
}

/** Partition graph rows into combo batches without exceeding the URL limit. */
function partition(entries: readonly WebBootEntry[]): WebBootEntry[][] {
  const batches: WebBootEntry[][] = [];
  for (const entry of entries) {
    const current = batches.at(-1);
    const projected = comboReference([...(current ?? []).map(row => row.id), entry.id], "0".repeat(REV_LENGTH));
    if (current !== undefined && Buffer.byteLength(projected) <= MAX_COMBO_URL_BYTES) current.push(entry);
    else batches.push([entry]);
  }
  return batches;
}

/** Externalize one inline script row into an enrolled file, preserving execution order. */
async function externalize(outdir: string, name: string, text: string): Promise<string> {
  const file = `boot/${name}.js`;
  await mkdir(dirname(join(outdir, file)), { recursive: true });
  await writeFile(join(outdir, file), `${text}\n`);
  return file;
}

/** Splice rendered rows after the opening head/body tag, as the upstream renderer does. */
function splice(html: string, match: RegExp, markup: string): string {
  const open = match.exec(html);
  return open === null ? `${markup}${html}` : `${html.slice(0, open.index + open[0].length)}${markup}${html.slice(open.index + open[0].length)}`;
}

/** Compose the served index page: stock shell markup plus the externalized boot graph. */
async function renderIndex(outdir: string, dist: string, graph: WebBootGraph, title: string): Promise<void> {
  let head = "";
  let body = "";
  let scripts = 0;
  for (const row of bootInjections(graph)) {
    if (row.kind === "script") {
      const file = await externalize(outdir, `injection-${scripts++}`, row.text);
      const tag = `<script src="./${file}"></script>`;
      if (row.placement === "head") head += tag; else body += tag;
    } else if (row.kind === "script-src") {
      const tag = `<script src="${row.src.replaceAll('"', "&quot;")}"></script>`;
      if (row.placement === "head") head += tag; else body += tag;
    } else if (row.kind === "script-preload") {
      head += `<link rel="preload" as="script" href="${row.src.replaceAll('"', "&quot;")}">`;
    } else if (row.kind === "global") {
      const file = await externalize(outdir, `graph-${row.name.replaceAll(/[^A-Za-z0-9_-]/g, "-")}`,
        `globalThis[${JSON.stringify(row.name)}] = ${JSON.stringify(row.value).replaceAll("<", "\\u003c")};`);
      head += `<script src="./${file}"></script>`;
    } else if (row.kind === "style") {
      head += `<style>${row.text}</style>`;
    } else {
      if (row.placement === "head") head += row.html; else body += row.html;
    }
  }
  const ready = await externalize(outdir, "ready",
    "(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()");
  body += `<script src="./${ready}"></script>`;
  const stock = await readFile(join(dist, "index.html"), "utf8");
  const titled = stock.replace("<title>DSH Local Build</title>", `<title>${title}</title>`);
  if (!titled.includes(`<title>${title}</title>`)) throw new Error("product client: stock index.html lost its title element");
  const html = splice(splice(titled, /<head(?:\s[^>]*)?>/i, head), /<body(?:\s[^>]*)?>/i, body);
  await writeFile(join(outdir, "index.html"), html);
}

/** Enumerate every non-map file under the built product directory as a served path. */
async function staticRoutes(outdir: string, routes: Record<string, string>): Promise<void> {
  const walk = async (directory: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { await walk(path); continue; }
      const file = relative(outdir, path);
      if (file.startsWith("plugins/") || file.endsWith(".map")) continue;
      routes[`/${file}`] = file;
    }
  };
  await walk(outdir);
}

/**
 * Compose the product browser tree.
 * @param options - output directory, stock shell dist, page title, and extra plugins (OMP modules).
 * @returns the served graph, route table, and package order.
 */
export async function buildProductClient(options: {
  outdir?: string; dist?: string; title?: string; plugins?: readonly PackagedPlugin[];
} = {}): Promise<ProductClientBuild> {
  const outdir = resolve(options.outdir ?? join(repoRoot, "vendor/dsh-product"));
  const dist = resolve(options.dist ?? join(repoRoot, "vendor/dsh/apps/web/dist"));
  const extra = options.plugins ?? [];
  await rm(outdir, { recursive: true, force: true });
  await mkdir(join(outdir, "plugins", "singles"), { recursive: true });
  await mkdir(join(outdir, "plugins", "batches"), { recursive: true });
  await copyShell(dist, outdir);

  const packaged = [...await Promise.all(baselineRoster.map(name => packageBundle(name))), ...extra];
  const seen = new Set<string>();
  for (const plugin of packaged) {
    if (seen.has(plugin.id)) throw new Error(`product client: duplicate roster package ${plugin.id}`);
    seen.add(plugin.id);
  }
  const contents = new Map<string, Buffer>();
  for (const plugin of packaged) contents.set(plugin.id, await readFile(plugin.bundle));

  const entries = orderByModuleGraph(packaged.map((plugin): WebBootEntry => ({
    id: plugin.id,
    rev: revisionOf([contents.get(plugin.id) ?? Buffer.alloc(0)]),
    url: "",
    ...(plugin.inject === undefined ? {} : { inject: plugin.inject }),
    ...(plugin.external === undefined ? {} : { external: plugin.external }),
    ...(plugin.immediately === true ? { immediately: true } : {}),
  })).map(entry => ({ ...entry, url: comboReference([entry.id], entry.rev) })));

  /** Executable registration bytes for one row, without a map reference this tree does not serve. */
  const sourceOf = (entry: WebBootEntry): string =>
    (contents.get(entry.id) ?? Buffer.alloc(0)).toString("utf8").replace(SOURCE_MAP_TRAILER, "").replace(/\n?$/, "\n");

  const routes: Record<string, string> = {};
  for (const [index, entry] of entries.entries()) {
    const file = `plugins/singles/${String(index)}.js`;
    await writeFile(join(outdir, file), sourceOf(entry));
    routes[`/${entry.url}`] = file;
  }

  const bootstrap = entries.filter(entry => entry.id === BOOTSTRAP_ID);
  const application = entries.filter(entry => entry.id !== BOOTSTRAP_ID);
  const batches = [
    ...partition(bootstrap).map(rows => ({ phase: "bootstrap" as const, rows })),
    ...partition(application).map(rows => ({ phase: "application" as const, rows })),
  ];
  const descriptors = [];
  for (const [index, batch] of batches.entries()) {
    const rev = revisionOf(batch.rows.map(row => row.rev));
    const url = comboReference(batch.rows.map(row => row.id), rev);
    const file = `plugins/batches/${String(index)}.js`;
    await writeFile(join(outdir, file), batch.rows.map(sourceOf).join(""));
    routes[`/${url}`] = file;
    descriptors.push({ phase: batch.phase, url, rev, entries: batch.rows.map(row => row.id) });
  }
  const graph: WebBootGraph = {
    rev: revisionOf([JSON.stringify(entries), JSON.stringify(descriptors)]),
    release: { version: "0.1.0", commit: (await verifyDshSource(join(repoRoot, "vendor/dsh"), "candidate")).sourceTree },
    entries,
    batches: descriptors,
  };

  await renderIndex(outdir, dist, graph, options.title ?? "OMP WebUI");
  await staticRoutes(outdir, routes);
  const sorted = Object.fromEntries(Object.keys(routes).sort().map(key => [key, routes[key] ?? ""]));
  await writeFile(join(outdir, "plugins", "routes.json"), `${JSON.stringify(sorted, null, 2)}\n`);
  return { outdir, graph, routes, roster: entries.map(entry => entry.id) };
}

if (import.meta.main) {
  const build = await buildProductClient();
  console.log(JSON.stringify({ outdir: build.outdir, roster: build.roster.length, batches: build.graph.batches.length,
    routes: Object.keys(build.routes).length, rev: build.graph.rev }));
}
