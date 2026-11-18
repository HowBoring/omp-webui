import assert from "node:assert/strict";
import { BranchInspectClient } from "./branch-inspect-client";
import { respondBranchInspect } from "./rpc-branch-inspect";

const source = { sourceId: "a".repeat(64), instanceId: "b".repeat(64), nativeSessionId: "original" };
const entryId = "user-from-sibling";
const expected = { parentId: "assistant-before-user", targetRevision: "c".repeat(64), contextRevision: "d".repeat(64) };
const user = { type: "message", message: { role: "user" }, parentId: expected.parentId };
const parent = { type: "message", message: { role: "assistant" }, parentId: null };
const entries = new Map<string, typeof user | typeof parent>([[entryId, user], [expected.parentId, parent]]);
const manager = {
	assertNavigationSource() {},
	getSubmissionTarget: () => source,
	getEntry: (id: string) => entries.get(id),
	navigationTarget: () => ({ entryId, parentId: expected.parentId, targetRevision: expected.targetRevision }),
	navigationContextRevision: () => expected.contextRevision,
};

let busy = false;
const roundTrip = (frame: object): unknown => JSON.parse(JSON.stringify(frame));
const client = new BranchInspectClient(async command => {
	return roundTrip(respondBranchInspect(roundTrip(command), manager, () => busy));
});

const preview = await client.inspect({ source, entryId });
assert.deepEqual(preview, { version: "branch-inspect-v1", source, entryId, ...expected });
assert.deepEqual(await client.inspect({ source, entryId, expected }), preview);

busy = true;
await assert.rejects(client.inspect({ source, entryId, expected }), { message: "session_busy" });
assert.deepEqual(await client.inspect({ source, entryId }), preview);
busy = false;
await assert.rejects(client.inspect({ source, entryId, expected: { ...expected, parentId: null } }),
	{ message: "BRANCH_STALE_TARGET" });

const wrongReply = new BranchInspectClient(async command => ({
	id: command.id, type: "response", command: command.type, success: true,
	data: { ...preview, source: { ...source, nativeSessionId: "other" } },
}));
await assert.rejects(wrongReply.inspect({ source, entryId }), { message: "BRANCH_INSPECT_RESPONSE_SCHEMA" });

const uncorrelatedReply = new BranchInspectClient(async command => ({
	id: "different-request", type: "response", command: command.type, success: true, data: preview,
}));
await assert.rejects(uncorrelatedReply.inspect({ source, entryId }), { message: "BRANCH_INSPECT_RESPONSE_SCHEMA" });

const malformedSuccess = new BranchInspectClient(async command => ({
	id: command.id, type: "response", command: command.type, success: true,
	data: { ...preview, destinationSessionId: "unverified" },
}));
await assert.rejects(malformedSuccess.inspect({ source, entryId }), { message: "BRANCH_INSPECT_RESPONSE_SCHEMA" });

const staleSuccess = new BranchInspectClient(async command => ({
	id: command.id, type: "response", command: command.type, success: true,
	data: { ...preview, contextRevision: "e".repeat(64) },
}));
await assert.rejects(staleSuccess.inspect({ source, entryId, expected }), { message: "BRANCH_INSPECT_RESPONSE_SCHEMA" });

const badWire = respondBranchInspect({ id: "malformed", type: "branch_inspect", source, entryId, destinationPath: "/private" },
	manager, () => false);
assert.deepEqual(roundTrip(badWire), {
	id: "malformed", type: "response", command: "branch_inspect", success: false,
	code: "BRANCH_INSPECT_COMMAND_SCHEMA", error: "BRANCH_INSPECT_COMMAND_SCHEMA",
});

console.log("branch_inspect public wire fixture passed");
