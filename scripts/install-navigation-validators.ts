/**
 * Install the durable-navigation-v1 candidate validators into the strict worker tree.
 *
 * The strict runtime must validate navigation commands and replies with the real
 * generated validators; permissive probe shims are not a boundary. This installs
 * the pinned candidate artifacts, writes the wrapper the patched native code
 * imports, stages the public client the pinned OMP patch adds, and records the
 * installed bytes in the strict-runtime manifest so staging never claims a file it
 * did not produce.
 *
 * Every byte comes from a checked-in pin: a fresh checkout stages the navigation
 * boundary of the strict worker without the 38-archive native build.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
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
/** The pinned OMP patch adds the public client the strict worker and its tests import. */
const CLIENT_PATCH = "compatibility/omp/0008-durable-navigation.patch";
const CLIENT_FILE = "packages/coding-agent/src/modes/rpc/navigation-client.ts";

type Artifact = { path: string; bytes: number; sha256: string };
type Candidate = { artifacts: Record<string, { bytes: number; sha256: string }>;
	source: { patches: { path: string; bytes: number; sha256: string }[] } };
type Manifest = { generatedOutputs: Artifact[] };

const digest = (contents: Uint8Array) => createHash("sha256").update(contents).digest("hex");

/** Bytes a patch adds for one path, so the staged client is the pinned source delta, not a copy. */
function addedFile(patch: string, path: string): Uint8Array {
	const start = patch.indexOf(`diff --git a/${path} b/${path}`);
	if (start < 0) throw new Error(`Patch does not add ${path}`);
	const end = patch.indexOf("\ndiff --git ", start + 1);
	const body = patch.slice(start, end < 0 ? undefined : end);
	const lines = body.split("\n").filter(line => line.startsWith("+") && !line.startsWith("+++"));
	if (lines.length === 0) throw new Error(`Patch adds no lines for ${path}`);
	return new TextEncoder().encode(`${lines.map(line => line.slice(1)).join("\n")}\n`);
}

export async function installNavigationValidators(): Promise<{ status: string; installed: Artifact[] }> {
	const candidate = JSON.parse(await readFile(join(CANDIDATE, "candidate.json"), "utf8")) as Candidate;
	const manifest = JSON.parse(await readFile(MANIFEST, "utf8")) as Manifest;
	const installed: Artifact[] = [];
	await mkdir(RPC, { recursive: true });
	const patchPin = candidate.source.patches.find(entry => entry.path === CLIENT_PATCH);
	if (!patchPin) throw new Error(`candidate.json has no pin for ${CLIENT_PATCH}`);
	const patchBytes = new Uint8Array(await readFile(join(ROOT, CLIENT_PATCH)));
	if (patchBytes.byteLength !== patchPin.bytes || digest(patchBytes) !== patchPin.sha256)
		throw new Error(`Pinned ${CLIENT_PATCH} differs from candidate.json`);
	await Bun.write(join(ROOT, CLIENT_FILE), addedFile(new TextDecoder().decode(patchBytes), CLIENT_FILE));

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
