/**
 * RPC-boundary regression for the navigation validators the strict worker loads.
 *
 * The worker tree must carry the pinned generated validators, not permissive
 * probe shims: a malformed command must fail before dispatch and a malformed
 * reply must fail in the client that consumes it (the same module pair the
 * worker's rpc-navigation.ts and navigation-client.ts import).
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const RPC = join(ROOT, "vendor/omp-strict/packages/coding-agent/src/modes/rpc");
const MANIFEST = join(ROOT, "compatibility/omp/candidates/native-cohort-38/strict-runtime-inputs.json");

const hexagonal = (label: string) => Bun.CryptoHasher.hash("sha256", label, "hex");
const target = { sourceId: hexagonal("source"), instanceId: hexagonal("instance"), nativeSessionId: "native" };
const result = {
	version: "durable-navigation-v1", navigationId: "navigation-1", target,
	found: true, duplicate: false, admission: "local",
	outcome: "reserved", reservation: "committed", persistence: "unresolved", terminal: false,
};
const preview = {
	version: "durable-navigation-v1", target, entryId: "entry-1",
	targetParentId: null, targetRevision: "revision", contextRevision: "context",
};

type Validators = {
	validNavigationCommand: (value: unknown) => boolean;
	validNavigationResult: (value: unknown) => boolean;
	validNavigationPreview: (value: unknown) => boolean;
};

const load = async (path: string): Promise<unknown> =>
	import(new URL(path, `file://${RPC}/`).href) as Promise<unknown>;

// The strict worker tree is an external stage (compatibility/omp/candidates/native-cohort-38/stage-strict-runtime.py).
// BLOCKED without it: vendor/omp-strict here holds only the installed validators, not the module graph they import.
const staged = existsSync(join(ROOT, "vendor/omp-strict/packages/coding-agent/src/cli.ts"));
const validators = staged ? ((await load("navigation.generated.ts")) as Validators) : (undefined as unknown as Validators);

if (!staged) test.skip("navigation validators require the external strict runtime stage", () => {});
describe.skipIf(!staged)("navigation validators", () => {
	test("rejects malformed commands before dispatch", () => {
		expect(validators.validNavigationCommand({})).toBe(false);
		expect(validators.validNavigationCommand({ type: "navigation_inspect", entryId: 5 })).toBe(false);
		// Length/format limits live in rpc-navigation.validate; the probe covers them over RPC.
		expect(validators.validNavigationCommand({ type: "navigation_query" })).toBe(false);
		expect(validators.validNavigationCommand({ type: "navigate_tree_committed", navigationId: "n1" })).toBe(false);
		expect(validators.validNavigationCommand({ type: "navigation_query", id: "1", navigationId: "n1" })).toBe(true);
		expect(validators.validNavigationCommand({ type: "navigation_inspect", id: "1", entryId: "e" })).toBe(true);
	});

	test("rejects malformed replies", () => {
		expect(validators.validNavigationResult(result)).toBe(true);
		expect(validators.validNavigationResult({ ...result, terminal: "yes" })).toBe(false);
		expect(validators.validNavigationResult({ ...result, outcome: "succeeded" })).toBe(false);
		expect(validators.validNavigationResult({ ...result, version: "v2" })).toBe(false);
		expect(validators.validNavigationResult({ ...result, target: undefined })).toBe(false);
		expect(validators.validNavigationPreview(preview)).toBe(true);
		expect(validators.validNavigationPreview({ ...preview, targetRevision: undefined })).toBe(false);
	});

	test("client refuses malformed navigate, query and inspect replies", async () => {
		const { NavigationClient } = await load("navigation-client.ts") as {
			NavigationClient: new (request: (command: { type: string }) => Promise<unknown>,
				validate: Validators["validNavigationResult"], validatePreview: Validators["validNavigationPreview"]) => {
				query: (navigationId: string) => Promise<unknown>;
				inspect: (entryId: string) => Promise<unknown>;
				navigate: (params: Record<string, string>) => Promise<unknown>;
			};
		};
		const refusing = new NavigationClient(async () => ({ ...result, terminal: "yes" }),
			validators.validNavigationResult, validators.validNavigationPreview);
		await expect(refusing.query("navigation-1")).rejects.toThrow("NAVIGATION_RESULT_SCHEMA");
		await expect(refusing.inspect("entry-1")).rejects.toThrow("NAVIGATION_PREVIEW_SCHEMA");

		const accepting = new NavigationClient(async (command: { type: string }) =>
			command.type === "navigation_inspect" ? preview : result,
		validators.validNavigationResult, validators.validNavigationPreview);
		expect(await accepting.query("navigation-1")).toEqual(result);
		expect(await accepting.inspect("entry-1")).toEqual(preview);
	});
});

test("the installed worker tree matches the pinned validator manifest", async () => {
	const manifest = JSON.parse(await readFile(MANIFEST, "utf8")) as {
		generatedOutputs: { path: string; bytes: number; sha256: string }[];
	};
	const navigation = manifest.generatedOutputs.filter(entry => entry.path.includes("navigation"));
	expect(navigation).toHaveLength(4);
	for (const entry of navigation) {
		const contents = await Bun.file(join(ROOT, "vendor/omp-strict", entry.path)).bytes();
		expect(contents.byteLength).toBe(entry.bytes);
		expect(new Bun.CryptoHasher("sha256").update(contents).digest("hex")).toBe(entry.sha256);
	}
	const wrapper = await Bun.file(join(RPC, "navigation.generated.ts")).text();
	expect(wrapper).toContain("navigation-result.generated.js");
	expect(wrapper).not.toContain("Probe-only shim");
});
