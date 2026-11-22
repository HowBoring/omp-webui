/**
 * S5 performance corpus authoring only.
 *
 * Creates real native OMP sessions through the pinned SessionManager, then assigns
 * deterministic ids/timestamps and a pinned session cwd so the corpus bytes reproduce
 * across checkouts of this generator. `generator.sha256` records which generator a
 * corpus came from, so a seed is only comparable against the same generator version.
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

type Json = Record<string, unknown>;

function normalizeHistory(contents: string): { body: string; distribution: Record<string, number> } {
	const parsed = contents.trimEnd().split("\n").map(line => JSON.parse(line) as Json);
	const ids = new Map<string, string>();
	let entryIndex = 0;
	for (const value of parsed) {
		if (value.type === "session") {
			value.id = HISTORY_ID;
			value.timestamp = HISTORY_TIMESTAMP;
			value.title = "S5 Native 10000 Entry History";
			value.titleSource = "user";
			// The session cwd is the checkout the corpus was authored in; pin it so the bytes reproduce.
			value.cwd = "/performance-fixture/project";
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
	const normalized = normalizeHistory(await readFile(file, "utf8"));
	const historyDir = dirname(file);
	const historyPath = join(historyDir, HISTORY_FILENAME);
	await writeFile(historyPath, normalized.body);
	if (resolve(historyPath) !== resolve(file)) await rm(file);
	const historyBytes = Buffer.byteLength(normalized.body);
	if (historyBytes < TARGET_BYTES) throw new Error(`PERFORMANCE_HISTORY_BELOW_TARGET:${historyBytes}`);
	const catalogFiles = (await jsonlFiles(sessions)).filter(path => path !== historyPath);
	const catalogFilesSha256 = sha256(Buffer.from((await Promise.all(catalogFiles.map(async path =>
		`${path.split("/").at(-1)}\0${(await stat(path)).size}\0${sha256(await readFile(path))}`))).sort().join("\n")));
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
			filesSha256: catalogFilesSha256,
			files: await Promise.all(catalogFiles.map(async path => ({
				path: relative(home, path), bytes: (await stat(path)).size, sha256: sha256(await readFile(path)),
			}))),
		},
		history: {
			nativeSessionId: HISTORY_ID,
			path: relative(home, historyPath),
			entries: HISTORY_ENTRIES,
			bytes: historyBytes,
			sha256: sha256(Buffer.from(normalized.body)),
			typeDistribution: normalized.distribution,
		},
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
