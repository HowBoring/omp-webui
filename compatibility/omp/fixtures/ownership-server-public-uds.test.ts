import { expect, test } from "bun:test";
import * as path from "node:path";
import { loadOwnershipApproval, ownershipApprovalPin } from "../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/approval";
import { OwnershipClient } from "../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/client";
import { decodeOwnershipResponse, OWNERSHIP_LIMITS, OWNERSHIP_VERSION, type OwnershipRequest } from "../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/protocol";
import { BunOwnershipTransport } from "../../../vendor/omp-ownership/packages/coding-agent/src/launch/ownership/uds-client";

const manifestPath = process.env.OMP_OWNERSHIP_SERVER_FIXTURE_MANIFEST;

/** Opt-in real public Bun UDS→independent server C SO_PEERPIDFD→signed reply. NOT Native/global/lifetime acceptance. */
test.skipIf(!manifestPath)("public Bun client registers with an independent dispatcher and verifies signed peer identity", async () => {
	if (!manifestPath?.startsWith("/tmp/ownership-server-tracer-") || !manifestPath.endsWith("/fixture.json")) {
		throw new Error("OWNERSHIP_SERVER_FIXTURE_REQUIRED");
	}
	const fixture: unknown = await Bun.file(manifestPath).json();
	if (typeof fixture !== "object" || fixture === null || !("approval" in fixture) || !("guard" in fixture)
		|| typeof fixture.guard !== "string" || !("bunConfig" in fixture) || typeof fixture.bunConfig !== "string") {
		throw new Error("OWNERSHIP_SERVER_FIXTURE_INVALID");
	}
	const root = path.dirname(manifestPath), approval = await loadOwnershipApproval(ownershipApprovalPin(fixture.approval));
	const child = Bun.spawn([process.execPath, "--no-env-file", `--config=${fixture.bunConfig}`, `--preload=${fixture.guard}`,
		path.resolve(import.meta.dir, "../../../vendor/omp-ownership/packages/coding-agent/test/fixtures/ownership-server-runner.ts")], {
		cwd: path.join(root, "cwd"), stdin: "pipe", stdout: "pipe", stderr: "pipe",
		env: { HOME: path.join(root, "home"), PI_CODING_AGENT_DIR: path.join(root, "profile"), TMPDIR: "/tmp",
			XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"),
			XDG_STATE_HOME: path.join(root, "xdg-state"), XDG_CACHE_HOME: path.join(root, "cache"),
			PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, OMP_OWNERSHIP_SERVER_FIXTURE_MANIFEST: manifestPath },
	});
	const stderr = new Response(child.stderr).text(), transport = new BunOwnershipTransport(approval);
	const client = new OwnershipClient(approval.identity, transport);
	try {
		const reader = child.stdout.getReader();
		try {
			let ready = "";
			while (!ready.endsWith("\n")) {
				const chunk = await reader.read();
				if (chunk.done || !chunk.value || chunk.value.length + ready.length > 64) throw new Error("OWNERSHIP_SERVER_READY_MISSING");
				ready += new TextDecoder("utf-8", { fatal: true }).decode(chunk.value);
			}
			expect(ready).toBe("OWNERSHIP_SERVER_READY\n");
		} finally { reader.releaseLock(); }
		const first = await client.classify(), second = await client.classify();
		expect(first.policy).toBe("external");
		expect(first.dispatcher).toMatch(/^[a-f0-9]{64}$/);
		expect(second).toEqual(first);
		expect(await client.listScopes()).toEqual([]);
		// OwnershipClient closes on signed negative replies as well as transport failures. Observe the existing
		// public authenticated wire boundary so EOF/connect/timeout cannot masquerade as a backend refusal.
		const request: OwnershipRequest = { version: OWNERSHIP_VERSION, id: crypto.randomUUID(), identity: approval.identity,
			operation: { op: "inspect_broker", scope: { kind: "project", directory: approval.releaseRoot },
				generation: "missing-generation" } };
		const frame = await transport.exchange(JSON.stringify(request), AbortSignal.timeout(OWNERSHIP_LIMITS.requestMs));
		const refusal = decodeOwnershipResponse(frame, request);
		expect(refusal).toMatchObject({ ok: false, error: "dispatcher_unavailable" });
		expect(await client.classify()).toEqual(first);
		expect(await client.listScopes()).toEqual([]);
	} finally {
		client.close(); child.stdin.end();
		const exitCode = await child.exited, error = await stderr;
		expect(exitCode).toBe(0); expect(error).toBe("");
		process.stdout.write(JSON.stringify({ fixture: "ownership-server-public-uds", serverPid: child.pid, clientPid: process.pid,
			serverExit: exitCode, signal: child.signalCode, stdinEofSent: true, serverAwaited: true }) + "\n");
	}
}, 10_000);
