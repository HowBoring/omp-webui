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
const outstandingBuiltins = new Set<Promise<void>>();
const roundTrip = (frame: object): unknown => JSON.parse(JSON.stringify(frame));
const client = new BranchInspectClient(async command => {
	return roundTrip(respondBranchInspect(roundTrip(command), manager, () => busy, outstandingBuiltins.size));
});

const preview = await client.inspect({ source, entryId });
assert.deepEqual(preview, { version: "branch-inspect-v1", source, entryId, ...expected });
assert.deepEqual(await client.inspect({ source, entryId, expected }), preview);

let settleBuiltin: (() => void) | undefined;
const builtinWork = new Promise<void>(resolve => { settleBuiltin = resolve; });
outstandingBuiltins.add(builtinWork);
const acknowledgedBuiltin = { agentInvoked: false, settle: builtinWork.finally(() => outstandingBuiltins.delete(builtinWork)) };
assert.equal(acknowledgedBuiltin.agentInvoked, false);
await assert.rejects(client.inspect({ source, entryId, expected }), { code: "session_busy" });
assert.deepEqual(await client.inspect({ source, entryId }), preview);
assert.ok(settleBuiltin);
settleBuiltin();
await acknowledgedBuiltin.settle;
assert.deepEqual(await client.inspect({ source, entryId, expected }), preview);

busy = true;
await assert.rejects(client.inspect({ source, entryId, expected }), { code: "session_busy" });
const typo = { source, entryId, expectedCut: expected };
const validationOnlyClient = new BranchInspectClient(async () => assert.fail("invalid parameters reached the wire"));
await assert.rejects(validationOnlyClient.inspect(typo), { code: "BRANCH_INSPECT_COMMAND_SCHEMA" });
const hiddenCut = Object.defineProperty({ source, entryId }, "expected", { value: expected });
await assert.rejects(validationOnlyClient.inspect(hiddenCut), { code: "BRANCH_INSPECT_COMMAND_SCHEMA" });
assert.deepEqual(await client.inspect({ source, entryId }), preview);
busy = false;
await assert.rejects(client.inspect({ source, entryId, expected: { ...expected, parentId: null } }),
	{ code: "BRANCH_STALE_TARGET" });

function clientWithLostTarget(message: string): BranchInspectClient {
	return new BranchInspectClient(async command => roundTrip(respondBranchInspect(roundTrip(command), {
		...manager,
		navigationTarget() { throw new Error(message); },
	}, () => false, 0)));
}

await assert.rejects(clientWithLostTarget("STRICT_SOURCE_DRIFT_OUTCOME_UNKNOWN").inspect({ source, entryId, expected }),
	{ code: "BRANCH_SOURCE_UNAVAILABLE" });
await assert.rejects(clientWithLostTarget("NAVIGATION_ENTRY_NOT_FOUND").inspect({ source, entryId, expected }),
	{ code: "BRANCH_TARGET_MISSING" });
await assert.rejects(clientWithLostTarget("NAVIGATION_TARGET_TOO_LARGE").inspect({ source, entryId, expected }),
	{ code: "BRANCH_TARGET_UNAVAILABLE" });

const wrongReply = new BranchInspectClient(async command => ({
	id: command.id, type: "response", command: command.type, success: true,
	data: { ...preview, source: { ...source, nativeSessionId: "other" } },
}));
await assert.rejects(wrongReply.inspect({ source, entryId }), { code: "BRANCH_INSPECT_RESPONSE_SCHEMA" });

const uncorrelatedReply = new BranchInspectClient(async command => ({
	id: "different-request", type: "response", command: command.type, success: true, data: preview,
}));
await assert.rejects(uncorrelatedReply.inspect({ source, entryId }), { code: "BRANCH_INSPECT_RESPONSE_SCHEMA" });

const malformedSuccess = new BranchInspectClient(async command => ({
	id: command.id, type: "response", command: command.type, success: true,
	data: { ...preview, destinationSessionId: "unverified" },
}));
await assert.rejects(malformedSuccess.inspect({ source, entryId }), { code: "BRANCH_INSPECT_RESPONSE_SCHEMA" });

const staleSuccess = new BranchInspectClient(async command => ({
	id: command.id, type: "response", command: command.type, success: true,
	data: { ...preview, contextRevision: "e".repeat(64) },
}));
await assert.rejects(staleSuccess.inspect({ source, entryId, expected }), { code: "BRANCH_INSPECT_RESPONSE_SCHEMA" });

const badWire = respondBranchInspect({ id: "malformed", type: "branch_inspect", source, entryId, destinationPath: "/private" },
	manager, () => false, 0);
assert.deepEqual(roundTrip(badWire), {
	id: "malformed", type: "response", command: "branch_inspect", success: false,
	code: "BRANCH_INSPECT_COMMAND_SCHEMA", error: "BRANCH_INSPECT_COMMAND_SCHEMA",
});

console.log("branch_inspect public wire fixture passed");
