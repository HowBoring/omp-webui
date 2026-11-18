import assert from "node:assert/strict";
import { inspectBranch } from "./rpc-branch-inspect";

const source = { sourceId: "a".repeat(64), instanceId: "b".repeat(64), nativeSessionId: "session-original" };
const targetRevision = "c".repeat(64);
const contextRevision = "d".repeat(64);
const entries = {
	"chosen-user": { type: "message", message: { role: "user" }, parentId: "prior-assistant" },
	"prior-assistant": { type: "message", message: { role: "assistant" }, parentId: null },
	"root-user": { type: "message", message: { role: "user" }, parentId: null },
	"custom-user": { type: "custom_message", message: { role: "user" }, parentId: "prior-assistant" },
	"orphan-user": { type: "message", message: { role: "user" }, parentId: "missing-parent" },
};

function getEntry(entryId: string) {
	return Object.hasOwn(entries, entryId) ? entries[entryId as keyof typeof entries] : undefined;
}

const native = {
	assertNavigationSource() {},
	getSubmissionTarget: () => source,
	getEntry,
	navigationTarget: (entryId: string) => {
		const entry = getEntry(entryId);
		if (!entry) throw new Error("NAVIGATION_ENTRY_NOT_FOUND");
		return { entryId, parentId: entry.parentId, targetRevision };
	},
	navigationContextRevision: () => contextRevision,
};

const request = { type: "branch_inspect", id: "request-1", source, entryId: "chosen-user" };
const cut = { parentId: "prior-assistant", targetRevision, contextRevision };
const preview = { version: "branch-inspect-v1", source, entryId: "chosen-user", ...cut };
const send = (value: unknown) => inspectBranch(value, native, () => false);

assert.deepEqual(send(request), preview, "preview identifies the selected user's prior native parent");
assert.deepEqual(send({ ...request, expected: cut }), preview, "same cut can be revalidated read-only");
assert.equal(send({ ...request, entryId: "root-user" }).parentId, null, "null parent is explicit");
assert.throws(() => send({ ...request, entryId: "prior-assistant" }), { message: "BRANCH_TARGET_NOT_USER" });
assert.throws(() => send({ ...request, entryId: "custom-user" }), { message: "BRANCH_TARGET_NOT_USER" });
assert.throws(() => send({ ...request, entryId: "missing-entry" }), { message: "BRANCH_TARGET_MISSING" });
assert.throws(() => send({ ...request, entryId: "orphan-user" }), { message: "BRANCH_TARGET_UNAVAILABLE" });
assert.throws(() => send({ ...request, expected: { ...cut, parentId: null } }), { message: "BRANCH_STALE_TARGET" });
assert.throws(() => send({ ...request, expected: { ...cut, targetRevision: "f".repeat(64) } }),
	{ message: "BRANCH_STALE_TARGET" });
assert.throws(() => inspectBranch({ ...request, expected: cut }, {
	...native, navigationContextRevision: () => "e".repeat(64),
}, () => false), { message: "BRANCH_STALE_CONTEXT" });
assert.throws(() => inspectBranch({ ...request, expected: cut }, {
	...native, getSubmissionTarget: () => ({ ...source, instanceId: "f".repeat(64) }),
}, () => false), { message: "BRANCH_SOURCE_CHANGED" });
assert.throws(() => inspectBranch(request, {
	...native, assertNavigationSource() { throw new Error("STRICT_SOURCE_REPLACED"); },
}, () => false), { message: "BRANCH_SOURCE_UNAVAILABLE" });
assert.throws(() => inspectBranch({ ...request, expected: cut }, native, () => true), { message: "session_busy" });
assert.deepEqual(inspectBranch(request, native, () => true), preview, "inspection can still read while busy");
assert.throws(() => send({ ...request, expected: { parentId: cut.parentId } }), { message: "BRANCH_INSPECT_COMMAND_SCHEMA" });
assert.throws(() => send({ ...request, source: { ...source, path: "/fixture/private" } }),
	{ message: "BRANCH_INSPECT_COMMAND_SCHEMA" });
assert.throws(() => send({ ...request, destinationPath: "/fixture/private" }), { message: "BRANCH_INSPECT_COMMAND_SCHEMA" });
assert.deepEqual(send(request), preview, "refused validation leaves the source and current cut usable");
