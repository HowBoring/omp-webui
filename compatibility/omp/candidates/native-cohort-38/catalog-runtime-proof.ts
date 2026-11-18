import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { CatalogTransport } from "../../../../packages/compatibility/catalog-transport.ts";
import { verifyCatalogRuntime } from "./catalog-runtime-identity.ts";

const [candidate, output] = process.argv.slice(2);
assert.ok(candidate && output && process.argv.length === 4, "expected staged candidate and empty proof directory");
const root = realpathSync(candidate);
const proof = realpathSync(output);
assert.equal(proof, resolve(output));
assert.ok(proof !== root && !proof.startsWith(root + sep));
assert.deepEqual(readdirSync(proof), []);

const home = join(proof, "home"), cwd = join(proof, "working"), profile = join(home, "profile");
const bucket = join(profile, "sessions", "misleading-directory-name");
mkdirSync(bucket, { recursive: true, mode: 0o700 });
mkdirSync(cwd, { mode: 0o700 });
const journal = join(bucket, "synthetic.jsonl"), id = "catalog-synthetic-a", title = "Synthetic catalog title";
const contents = JSON.stringify({ type: "session", version: 3, id, title, cwd,
  timestamp: "2026-01-01T00:00:00.000Z" }) + "\n";
writeFileSync(journal, contents, { mode: 0o600, flag: "wx" });
const entriesBefore = readdirSync(home, { recursive: true }).sort();
const journalBefore = statSync(journal, { bigint: true });

const audit = join(proof, "guard-audit.json"), auditSource = join(proof, "audit-preload.ts");
writeFileSync(auditSource, `import { writeFileSync } from "node:fs";
const guard = Reflect.get(globalThis, Symbol.for("omp.s0.network-guard"));
if (!guard || !process.env.OMP_FIXTURE_AUDIT) throw Error("missing catalog guard");
process.once("exit", () => writeFileSync(process.env.OMP_FIXTURE_AUDIT!, JSON.stringify({
  denied: guard.denied(), dispatched: guard.dispatched(),
}), { mode: 0o600, flag: "wx" }));
`, { mode: 0o600, flag: "wx" });
const identity = verifyCatalogRuntime(candidate);
const transport = await CatalogTransport.open({
  argv: [process.execPath, "--no-env-file", "--no-install", "--preload", join(root, "no-provider.ts"),
    "--preload", auditSource, join(root, "vendor/omp-candidate/cli.js"), "--rpc-catalog"],
  env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", HOME: home, TMPDIR: home, PI_CODING_AGENT_DIR: profile,
    XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache"), XDG_DATA_HOME: join(home, "data"),
    PI_NATIVES_DIR: join(home, "natives"), PI_NATIVE_VARIANT: "baseline", OMP_FIXTURE_AUDIT: audit,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", NODE_DISABLE_COMPILE_CACHE: "1" },
  cwd, timeoutMs: 5000,
});
const originalPid = transport.processId;
let drain: Awaited<ReturnType<typeof transport.close>>;
let budgets: Awaited<ReturnType<typeof transport.catalog.sources>>["budgets"];
try {
  const sources = await transport.catalog.sources();
  assert.equal(sources.profile, "default");
  assert.equal(sources.sources.length, 1);
  const source = sources.sources[0];
  assert.ok(source);
  assert.deepEqual(source, { sourceId: source.sourceId, kind: "default", aliases: [join(profile, "sessions")],
    status: "ready" });
  budgets = sources.budgets;
  const page = await transport.catalog.page({ pageSize: 32 });
  assert.equal(page.status, "complete");
  assert.deepEqual(page.failures, []);
  assert.equal(page.items.length, 1);
  const item = page.items[0];
  assert.ok(item);
  assert.equal(item.nativeSessionId, id);
  assert.equal(item.title, title);
  assert.equal(item.sourceId, source.sourceId);
  assert.deepEqual(item.cwd, { recorded: cwd, canonical: cwd, status: "known" });
  assert.equal(item.ownership.state, "free");
  const described = await transport.catalog.describe(item.reference);
  assert.equal(described.status, "verified");
  assert.equal(described.item?.reference, item.reference);
  assert.equal(described.item?.instanceId, item.instanceId);
  assert.equal(described.item?.nativeSessionId, id);
} finally {
  drain = await transport.close();
}
assert.deepEqual(drain, { code: 0, forced: false, stderrBytes: 0, terminationSent: false, forceSent: false,
  stdoutEOF: true, stderrEOF: true });
assert.deepEqual(readdirSync(home, { recursive: true }).sort(), entriesBefore);
assert.deepEqual(readdirSync(cwd), []);
assert.equal(readFileSync(journal, "utf8"), contents);
const journalAfter = statSync(journal, { bigint: true });
assert.equal(journalAfter.mtimeNs, journalBefore.mtimeNs);
assert.equal(journalAfter.ctimeNs, journalBefore.ctimeNs);
const network: unknown = JSON.parse(readFileSync(audit, "utf8"));
assert.deepEqual(network, { denied: 0, dispatched: 0 });
console.log(JSON.stringify({ status: "PASS_UNREGISTERED_CATALOG_RUNTIME", protocol: 2, originalPid,
  actions: ["catalog_sources", "catalog_page", "describe_session"], nativeSessionId: id, ownership: "free",
  unchangedFixture: true, identity, budgets, network, drain }));
