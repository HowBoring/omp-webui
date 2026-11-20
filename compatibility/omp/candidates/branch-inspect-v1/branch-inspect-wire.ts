/** Protected current Native Session identity, using the public SubmissionTarget fields. */
export interface BranchInspectSource {
	sourceId: string;
	instanceId: string;
	nativeSessionId: string;
}

export interface BranchInspectCut {
	parentId: string | null;
	targetRevision: string;
	contextRevision: string;
}

export interface BranchInspectParams {
	source: BranchInspectSource;
	entryId: string;
	/** Revalidate the entire selected cut and current idle state. */
	expected?: BranchInspectCut;
}

export interface BranchInspectCommand extends BranchInspectParams {
	type: "branch_inspect";
	id?: string;
}

export interface BranchInspectPreview extends BranchInspectCut {
	version: "branch-inspect-v1";
	source: BranchInspectSource;
	entryId: string;
}

const errorCodes = [
	"BRANCH_INSPECT_COMMAND_SCHEMA",
	"BRANCH_SOURCE_CHANGED",
	"BRANCH_SOURCE_UNAVAILABLE",
	"BRANCH_TARGET_MISSING",
	"BRANCH_TARGET_NOT_USER",
	"BRANCH_TARGET_UNAVAILABLE",
	"BRANCH_STALE_TARGET",
	"BRANCH_STALE_CONTEXT",
	"session_busy",
	"NAVIGATION_BUSY",
] as const;

export type BranchInspectErrorCode = (typeof errorCodes)[number];
export type BranchInspectResponse = { id?: string; type: "response"; command: "branch_inspect" } & (
	| { success: true; data: BranchInspectPreview }
	| { success: false; code: BranchInspectErrorCode; error: string }
);

function record(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function only(value: Record<string, unknown>, fields: readonly string[]): boolean {
	return Reflect.ownKeys(value).every(key => typeof key === "string" && fields.includes(key) &&
		Object.prototype.propertyIsEnumerable.call(value, key));
}

function bounded(value: unknown, max: number): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= max;
}

function revision(value: unknown): value is string {
	return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function branchInspectRequestId(value: unknown): string | undefined {
	return record(value) && bounded(value.id, 96) ? value.id : undefined;
}

function validSource(value: unknown): value is BranchInspectSource {
	return record(value) && only(value, ["sourceId", "instanceId", "nativeSessionId"]) &&
		revision(value.sourceId) && revision(value.instanceId) && bounded(value.nativeSessionId, 128);
}

function hasCut(value: Record<string, unknown>): boolean {
	return (value.parentId === null || bounded(value.parentId, 128)) &&
		revision(value.targetRevision) && revision(value.contextRevision);
}

export function sameBranchSource(left: BranchInspectSource, right: BranchInspectSource): boolean {
	return left.sourceId === right.sourceId && left.instanceId === right.instanceId &&
		left.nativeSessionId === right.nativeSessionId;
}

function hasBranchInspectParams(value: Record<string, unknown>): boolean {
	if (!validSource(value.source) || !bounded(value.entryId, 128)) return false;
	return !Object.hasOwn(value, "expected") || (record(value.expected) &&
		only(value.expected, ["parentId", "targetRevision", "contextRevision"]) && hasCut(value.expected));
}

export function validBranchInspectParams(value: unknown): value is BranchInspectParams {
	return record(value) && only(value, ["source", "entryId", "expected"]) && hasBranchInspectParams(value);
}

export function validBranchInspectCommand(value: unknown): value is BranchInspectCommand {
	if (!record(value) || value.type !== "branch_inspect" || !only(value, ["id", "type", "source", "entryId", "expected"]))
		return false;
	return (!Object.hasOwn(value, "id") || branchInspectRequestId(value) !== undefined) && hasBranchInspectParams(value);
}

export function validBranchInspectPreview(value: unknown): value is BranchInspectPreview {
	return record(value) && value.version === "branch-inspect-v1" &&
		only(value, ["version", "source", "entryId", "parentId", "targetRevision", "contextRevision"]) &&
		validSource(value.source) && bounded(value.entryId, 128) && hasCut(value);
}

export function validBranchInspectResponse(value: unknown): value is BranchInspectResponse {
	if (!record(value) || value.type !== "response" || value.command !== "branch_inspect" ||
		(Object.hasOwn(value, "id") && branchInspectRequestId(value) === undefined)) return false;
	const envelope = ["id", "type", "command", "success"];
	if (value.success === true) return only(value, [...envelope, "data"]) && validBranchInspectPreview(value.data);
	return value.success === false && only(value, [...envelope, "code", "error"]) && bounded(value.error, 128) &&
		errorCodes.some(code => code === value.code);
}
