/**
 * S5 performance corpus authoring only.
 *
 * Creates real native OMP sessions through the pinned SessionManager, then assigns
 * deterministic ids/timestamps and one shared checkout cwd. Recorded digests tokenize
 * that checkout path, so they compare across checkouts of this generator while the
 * on-disk sessions keep the real path the product Host grants. `generator.sha256`
 * records which generator a corpus came from.
 * The Host never imports this file and never edits session files at runtime.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { nativeFixture } from "../tests/catalog/fixture.ts";

const ROOT = resolve(import.meta.dir, "..");
const CATALOG_SESSIONS = 1000;
const HISTORY_ENTRIES = 10_000;
const TARGET_BYTES = 100 * 1024 * 1024;
const HISTORY_ID = "10000000-0000-4000-8000-000000000000";
const HISTORY_TIMESTAMP = "2026-02-01T00:00:00.000Z";
const HISTORY_FILENAME = "2026-02-01T00-00-00-000Z_10000000-0000-4000-8000-000000000000.jsonl";
const SEED = "omp-webui-s5-performance-v1";
/** Sessions carry the corpus project path because the gate grants exactly `<corpus>/project` and its
 * descendants, so the list only shows Sessions inside it. Digests tokenize the checkout prefix:
 * `canonical` is the cross-checkout identity, the on-disk bytes are per-checkout. */
const CHECKOUT_TOKEN = "<checkout>";
/** The only checkout-specific bytes are the corpus project path, which every Session records as its cwd. */
const canonical = (contents: string, home: string): string =>
	contents.replaceAll(join(home, "project"), "<corpus>/project");

type Json = Record<string, unknown>;

function normalizeHistory(contents: string, home: string): { body: string; distribution: Record<string, number> } {
	const parsed = contents.trimEnd().split("\n").map(line => JSON.parse(line) as Json);
	const ids = new Map<string, string>();
	let entryIndex = 0;
	for (const value of parsed) {
		if (value.type === "session") {
			value.id = HISTORY_ID;
			value.timestamp = HISTORY_TIMESTAMP;
			value.title = "S5 Native 10000 Entry History";
			value.titleSource = "user";
			value.cwd = join(home, "project");
		} else if (value.type === "title") {
			value.updatedAt = HISTORY_TIMESTAMP;
			value.title = "S5 Native 10000 Entry History";
		} else {
			if (typeof value.id !== "string") throw new Error("PERFORMANCE_ENTRY_ID_MISSING");
			const id = `e${String(entryIndex++).padStart(7, "0")}`;
			ids.set(value.id, id);
			value.id = id;
			value.timestamp = new Date(1_767_225_601_000 + entryIndex * 1_000).toISOString();
		}
	}
	for (const value of parsed) {
		for (const key of ["parentId", "activeLeafId", "firstKeptEntryId", "providerReplayThroughEntryId"]) {
			const old = value[key];
			if (typeof old === "string" && ids.has(old)) value[key] = ids.get(old);
		}
	}
	const distribution: Record<string, number> = {};
	const count = (key: string) => { distribution[key] = (distribution[key] ?? 0) + 1; };
	for (const value of parsed) {
		if (value.type === "session" || value.type === "title") continue;
		count(String(value.type));
		if (value.type === "custom") count(`custom:${String(value.customType)}`);
		if (value.type === "message") {
			const message = value.message as { role?: string; content?: Array<{ type?: string }> };
			count(`message:${String(message.role)}`);
			for (const part of message.content ?? []) if (part.type === "toolCall") count("toolCall");
		}
		if (value.activeLeafId !== undefined) count("branch");
	}
	if (entryIndex !== HISTORY_ENTRIES) throw new Error(`PERFORMANCE_HISTORY_ENTRY_COUNT:${entryIndex}`);
	return { body: parsed.map(value => JSON.stringify(value)).join("\n") + "\n", distribution };
}

/**
 * Catalog sessions keep native formatting, so the only checkout-specific bytes are their absolute cwd
 * values; rewrite every one (header and nested entry fields) to this checkout's root.
 */
function normalizeCatalog(contents: string, home: string): string {
	return contents.replaceAll(/"cwd":"[^"]*"/g, `"cwd":${JSON.stringify(join(home, "project"))}`);
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

async function jsonlFiles(root: string): Promise<string[]> {
	const result: string[] = [];
	for (const name of await readdir(root, { recursive: true })) {
		const path = join(root, name);
		if ((await stat(path)).isFile() && path.endsWith(".jsonl")) result.push(path);
	}
	return result.sort();
}

async function main(): Promise<void> {
	const home = resolve(process.env.OMP_PERF_HOME ?? "vendor/performance-fixture");
	const sessions = join(home, "sessions");
	await rm(home, { recursive: true, force: true });
	await mkdir(join(home, "project"), { recursive: true });
	await nativeFixture(home, CATALOG_SESSIONS);
	await rename(join(home, ".omp/agent/sessions"), sessions);
	const child = Bun.spawn([
		process.execPath, "--no-env-file", join(import.meta.dir, "author-performance-history.ts"), home,
	], {
		env: {
			HOME: home, TMPDIR: home, PI_CODING_AGENT_DIR: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
			PATH: "/usr/bin:/bin", NO_COLOR: "1",
		},
		stdin: "ignore", stdout: "pipe", stderr: "pipe",
	});
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
	]);
	if (code !== 0) throw new Error(`PERFORMANCE_HISTORY_AUTHORING_FAILED:${err.slice(0, 1_024)}`);
	const { file } = JSON.parse(out) as { file: string };
	const normalized = normalizeHistory(await readFile(file, "utf8"), home);
	const historyDir = dirname(file);
	const historyPath = join(historyDir, HISTORY_FILENAME);
	await writeFile(historyPath, normalized.body);
	if (resolve(historyPath) !== resolve(file)) await rm(file);
	const historyBytes = Buffer.byteLength(normalized.body);
	if (historyBytes < TARGET_BYTES) throw new Error(`PERFORMANCE_HISTORY_BELOW_TARGET:${historyBytes}`);
	const canonicalBody = canonical(normalized.body, home);
	const catalogFiles = (await jsonlFiles(sessions)).filter(path => path !== historyPath);
	for (const path of catalogFiles) {
		const contents = await readFile(path, "utf8");
		const normalizedCatalog = normalizeCatalog(contents, home);
		if (normalizedCatalog !== contents) await writeFile(path, normalizedCatalog);
	}
	/* Raw bytes/sha256 describe this checkout; canonical bytes/sha256 are the reproducible identity. */
	const fileDigests = await Promise.all(catalogFiles.map(async path => {
		const raw = await readFile(path), canonicalContents = canonical(raw.toString("utf8"), home);
		return { path: relative(home, path), bytes: raw.byteLength, sha256: sha256(raw),
			canonicalBytes: Buffer.byteLength(canonicalContents), canonicalSha256: sha256(Buffer.from(canonicalContents)) };
	}));
	const canonicalFilesSha256 = sha256(Buffer.from(fileDigests.map(file =>
		`${file.path.split("/").at(-1)}\0${file.canonicalBytes}\0${file.canonicalSha256}`).sort().join("\n")));
	const corpus = {
		kind: "S5-native-performance-corpus",
		privateData: false,
		generator: { path: "scripts/create-performance-corpus.ts",
			sha256: sha256(await readFile(join(ROOT, "scripts/create-performance-corpus.ts"))) },
		seed: SEED,
		reference: { cpus: 4, memoryMiB: 8_192, storage: "SSD", note: "Declared acceptance profile; actual runner recorded by the harness." },
		limits: { catalogSessions: CATALOG_SESSIONS, historyEntries: HISTORY_ENTRIES, historyBytes: TARGET_BYTES },
		catalog: {
			sessions: catalogFiles.length,
			root: relative(home, sessions),
			idsSha256: sha256(Buffer.from(catalogFiles.map(path => path.split("/").at(-1)!.replace(/\.jsonl$/, "")).sort().join("\n"))),
			canonicalFilesSha256,
			files: fileDigests,
		},
		history: {
			nativeSessionId: HISTORY_ID,
			path: relative(home, historyPath),
			entries: HISTORY_ENTRIES,
			bytes: historyBytes,
			sha256: sha256(Buffer.from(normalized.body)),
			canonicalBytes: Buffer.byteLength(canonicalBody),
			canonicalSha256: sha256(Buffer.from(canonicalBody)),
			typeDistribution: normalized.distribution,
		},
		canonicalization: { checkoutToken: CHECKOUT_TOKEN,
			note: "Recorded digests and byte counts tokenize this checkout's path; on-disk sessions keep it because the Host only lists granted directories." },
		home,
		createdAt: new Date().toISOString(),
	};
	await writeFile(join(home, "fixture-marker.json"), JSON.stringify({ kind: "S5-native-performance-corpus", privateData: false }) + "\n");
	await writeFile(join(home, "corpus.json"), JSON.stringify(corpus, null, 2) + "\n");
	const base = Date.UTC(2026, 0, 1) / 1_000;
	for (const [index, path] of catalogFiles.entries()) await utimes(path, base + index, base + index);
	await utimes(historyPath, Date.UTC(2026, 1, 1) / 1_000, Date.UTC(2026, 1, 1) / 1_000);
	console.info(JSON.stringify({
		status: "performance-corpus-created", catalog: catalogFiles.length, historyEntries: HISTORY_ENTRIES,
		historyBytes, home, historyPath,
	}));
}

await main();
