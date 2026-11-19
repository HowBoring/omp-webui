/**
 * Install the durable-navigation-v1 candidate validators into the strict worker tree.
 *
 * The strict runtime must validate navigation commands and replies with the real
 * generated validators; permissive probe shims are not a boundary. This installs
 * the pinned candidate artifacts, writes the wrapper the patched native code
 * imports, and records the installed bytes in the strict-runtime manifest so
 * staging never claims a file it did not produce.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const CANDIDATE = join(ROOT, "packages/contracts/candidates/durable-navigation-v1");
const RPC = join(ROOT, "vendor/omp-strict/packages/coding-agent/src/modes/rpc");
const MANIFEST = join(ROOT, "compatibility/omp/candidates/native-cohort-38/strict-runtime-inputs.json");
const MANIFEST_PREFIX = "packages/coding-agent/src/modes/rpc/";
const ARTIFACTS = [
	{ source: "navigation-command.js", target: "navigation-command.generated.js" },
	{ source: "navigation-result.js", target: "navigation-result.generated.js" },
	{ source: "navigation-preview.js", target: "navigation-preview.generated.js" },
];

const WRAPPER = `// Generated from the pinned durable-navigation-v1 candidate wire.
import command from "./navigation-command.generated.js";
import preview from "./navigation-preview.generated.js";
import result from "./navigation-result.generated.js";
import type { NavigationPreview,NavigationResult,RpcWireCommands } from "./wire/rpc-wire.generated";
type NavigationName = "navigation_inspect" | "navigate_tree_committed" | "navigation_query";
export type NavigationCommand = {[K in NavigationName]:{id?:string;type:K} & RpcWireCommands[K]["params"]}[NavigationName];
export const validNavigationCommand = (value:unknown):value is NavigationCommand => command(value);
export const validNavigationPreview = (value:unknown):value is NavigationPreview => preview(value);
export const validNavigationResult = (value:unknown):value is NavigationResult => result(value);
`;

type Artifact = { path: string; bytes: number; sha256: string };
type Candidate = { artifacts: Record<string, { bytes: number; sha256: string }> };
type Manifest = { generatedOutputs: Artifact[] };

const digest = (contents: Uint8Array) => createHash("sha256").update(contents).digest("hex");

export async function installNavigationValidators(): Promise<{ status: string; installed: Artifact[] }> {
	const candidate = JSON.parse(await readFile(join(CANDIDATE, "candidate.json"), "utf8")) as Candidate;
	const manifest = JSON.parse(await readFile(MANIFEST, "utf8")) as Manifest;
	const installed: Artifact[] = [];

	for (const artifact of ARTIFACTS) {
		const pin = candidate.artifacts[artifact.source];
		if (!pin) throw new Error(`candidate.json has no pin for ${artifact.source}`);
		const contents = new Uint8Array(await readFile(join(CANDIDATE, artifact.source)));
		if (contents.byteLength !== pin.bytes || digest(contents) !== pin.sha256)
			throw new Error(`Pinned ${artifact.source} differs from candidate.json`);
		await Bun.write(join(RPC, artifact.target), contents);
		installed.push({ path: MANIFEST_PREFIX + artifact.target, bytes: contents.byteLength, sha256: digest(contents) });
	}

	const wrapper = new TextEncoder().encode(WRAPPER);
	await Bun.write(join(RPC, "navigation.generated.ts"), wrapper);
	installed.push({ path: MANIFEST_PREFIX + "navigation.generated.ts", bytes: wrapper.byteLength, sha256: digest(wrapper) });

	for (const entry of installed) {
		const existing = manifest.generatedOutputs.find(item => item.path === entry.path);
		if (existing) Object.assign(existing, entry);
		else {
			const after = manifest.generatedOutputs.findIndex(item =>
				item.path === MANIFEST_PREFIX + "navigation-result.generated.js");
			manifest.generatedOutputs.splice(after + 1, 0, entry);
		}
	}
	await Bun.write(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
	return { status: "navigation-validators-installed", installed };
}

if (import.meta.main) console.log(JSON.stringify(await installNavigationValidators()));
