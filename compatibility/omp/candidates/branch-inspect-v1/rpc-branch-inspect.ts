import {
	branchInspectRequestId,
	type BranchInspectErrorCode,
	type BranchInspectPreview,
	type BranchInspectResponse,
	type BranchInspectSource,
	sameBranchSource,
	validBranchInspectCommand,
	validBranchInspectPreview,
} from "./branch-inspect-wire";

interface Entry {
	type: string;
	parentId: string | null;
	message?: { role: string };
}

/** Read-only subset of the Native SessionManager. */
interface BranchInspection {
	assertNavigationSource(): void;
	getSubmissionTarget(): BranchInspectSource;
	getEntry(id: string): Entry | undefined;
	navigationTarget(id: string): { entryId: string; parentId: string | null; targetRevision: string };
	navigationContextRevision(): string;
}

class BranchInspectionError extends Error {
	readonly code: BranchInspectErrorCode;
	constructor(code: BranchInspectErrorCode) {
		super(code);
		this.code = code;
	}
}

function refuse(code: BranchInspectErrorCode): never {
	throw new BranchInspectionError(code);
}

function sourceIdentity(manager: BranchInspection): BranchInspectSource {
	try {
		manager.assertNavigationSource();
		return manager.getSubmissionTarget();
	} catch {
		return refuse("BRANCH_SOURCE_UNAVAILABLE");
	}
}

function readTarget(manager: BranchInspection, entryId: string) {
	const entry = manager.getEntry(entryId);
	if (!entry) return refuse("BRANCH_TARGET_MISSING");
	if (entry.type !== "message" || entry.message?.role !== "user") return refuse("BRANCH_TARGET_NOT_USER");
	if (entry.parentId !== null && (entry.parentId === entryId || !manager.getEntry(entry.parentId)))
		return refuse("BRANCH_TARGET_UNAVAILABLE");
	try {
		const target = manager.navigationTarget(entryId);
		if (target.entryId === entryId && target.parentId === entry.parentId) return target;
	} catch {
		// The native target may exceed its content revision budget or become unreadable.
	}
	return refuse("BRANCH_TARGET_UNAVAILABLE");
}

/** Synchronous preview or revalidation using the current protected Native Session. */
export function inspectBranch(value: unknown, manager: BranchInspection, isBusy: () => boolean): BranchInspectPreview {
	if (!validBranchInspectCommand(value)) return refuse("BRANCH_INSPECT_COMMAND_SCHEMA");
	const source = sourceIdentity(manager);
	if (!sameBranchSource(source, value.source)) return refuse("BRANCH_SOURCE_CHANGED");
	const { entryId, expected } = value;
	if (expected && isBusy()) return refuse("session_busy");
	const target = readTarget(manager, entryId);
	const contextRevision = sourceContext(manager);
	const preview = { version: "branch-inspect-v1", source, ...target, contextRevision };
	if (!validBranchInspectPreview(preview)) return refuse("BRANCH_TARGET_UNAVAILABLE");
	if (expected && (expected.parentId !== preview.parentId || expected.targetRevision !== preview.targetRevision))
		return refuse("BRANCH_STALE_TARGET");
	if (expected && expected.contextRevision !== contextRevision) return refuse("BRANCH_STALE_CONTEXT");
	return preview;
}

function sourceContext(manager: BranchInspection): string {
	try {
		return manager.navigationContextRevision();
	} catch {
		return refuse("BRANCH_SOURCE_UNAVAILABLE");
	}
}

export function respondBranchInspect(value: unknown, manager: BranchInspection, isBusy: () => boolean): BranchInspectResponse {
	const id = branchInspectRequestId(value);
	const envelope = { ...(id === undefined ? {} : { id }), type: "response", command: "branch_inspect" } as const;
	try {
		return { ...envelope, success: true, data: inspectBranch(value, manager, isBusy) };
	} catch (failure) {
		const code = failure instanceof BranchInspectionError ? failure.code : "BRANCH_SOURCE_UNAVAILABLE";
		return { ...envelope, success: false, code, error: code };
	}
}
