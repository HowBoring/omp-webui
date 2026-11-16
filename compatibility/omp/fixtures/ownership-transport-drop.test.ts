import { expect, test } from "bun:test";
import { loadOwnershipApproval, ownershipApprovalPin } from "../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/approval";
import { decodeOwnershipChallenge, signOwnershipReply } from "../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/authentication";
import { OwnershipClient } from "../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/client";
import { OwnershipFrames } from "../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/framing";
import { decodeOwnershipResponse, OWNERSHIP_LIMITS, OWNERSHIP_VERSION, type OwnershipRequest } from "../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/protocol";
import { loadOwnershipSigningKey } from "../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/server-key";
import { BunOwnershipTransport } from "../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/uds-client";

// Separate opt-in: never selected by the one-attempt C server tracer. Real public UDS, no internal mocks/FFI.
const manifestPath = process.env.OMP_OWNERSHIP_TRANSPORT_FAULT_FIXTURE_MANIFEST;
test.skipIf(!manifestPath)("a peer dropping after signed empty scopes cannot supply an authenticated inspect refusal", async () => {
	if (!manifestPath?.startsWith("/tmp/ownership-server-tracer-") || !manifestPath.endsWith("/fixture.json")) {
		throw new Error("OWNERSHIP_SERVER_FIXTURE_REQUIRED");
	}
	const fixture: unknown = await Bun.file(manifestPath).json();
	if (typeof fixture !== "object" || fixture === null || !("approval" in fixture) || !("key" in fixture)) {
		throw new Error("OWNERSHIP_SERVER_FIXTURE_INVALID");
	}
	const approval = await loadOwnershipApproval(ownershipApprovalPin(fixture.approval));
	const privateKey = await loadOwnershipSigningKey(ownershipApprovalPin(fixture.key), approval);
	const generation = "1".repeat(64), registration = { dispatcher: generation, registration: "external-registration",
		generation: "external-generation", policy: "external" };
	let listed = false, peerFailure: unknown;
	const server = Bun.listen<{ frames: OwnershipFrames; tail: Promise<void> }>({ unix: approval.endpoint, socket: {
		open(socket) { socket.data = { frames: new OwnershipFrames(), tail: Promise.resolve() }; },
		data(socket, bytes) {
			for (const frame of socket.data.frames.push(bytes)) socket.data.tail = socket.data.tail.then(async () => {
				// A real EOF after the successful listing reproduces the old false-PASS, including its preliminary classify.
				if (listed) { socket.end(); return; }
				const challenge = await decodeOwnershipChallenge(frame, approval), op = challenge.request.operation.op;
				if (op !== "classify" && op !== "list_scopes") throw new Error("UNEXPECTED_FAULT_PEER_OPERATION");
				const result = op === "classify" ? { op, registration } : { op, scopes: [] };
				const reply = await signOwnershipReply(challenge, JSON.stringify({ version: OWNERSHIP_VERSION,
					id: challenge.request.id, ok: true, identity: approval.identity, result }), {
					installation: approval.installation, identity: approval.identity, serverGeneration: generation, privateKey });
				socket.write(reply + "\n"); listed = op === "list_scopes";
			}).catch(error => { peerFailure = error; socket.terminate(); });
		},
	} });
	const transport = new BunOwnershipTransport(approval), client = new OwnershipClient(approval.identity, transport);
	try {
		expect((await client.classify()).policy).toBe("external");
		expect(await client.listScopes()).toEqual([]);
		const request: OwnershipRequest = { version: OWNERSHIP_VERSION, id: crypto.randomUUID(), identity: approval.identity,
			operation: { op: "inspect_broker", scope: { kind: "project", directory: approval.releaseRoot },
				generation: "missing-generation" } };
		// Decode only a resolved authenticated frame. Never catch a transport error as a negative response body.
		const response = transport.exchange(JSON.stringify(request), AbortSignal.timeout(OWNERSHIP_LIMITS.requestMs))
			.then(frame => decodeOwnershipResponse(frame, request));
		await expect(response).rejects.toMatchObject({ code: "dispatcher_unavailable" });
		expect(peerFailure).toBeUndefined();
	} finally { client.close(); server.stop(true); }
}, 10_000);
