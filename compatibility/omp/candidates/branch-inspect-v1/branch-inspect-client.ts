import {
	type BranchInspectCommand,
	type BranchInspectErrorCode,
	type BranchInspectParams,
	type BranchInspectPreview,
	sameBranchSource,
	validBranchInspectParams,
	validBranchInspectResponse,
} from "./branch-inspect-wire";

type Request = (command: BranchInspectCommand & { id: string }) => Promise<unknown>;
export type BranchInspectClientErrorCode = BranchInspectErrorCode | "BRANCH_INSPECT_RESPONSE_SCHEMA";

export class BranchInspectClientError extends Error {
	readonly code: BranchInspectClientErrorCode;
	constructor(code: BranchInspectClientErrorCode) {
		super(code);
		this.name = "BranchInspectClientError";
		this.code = code;
	}
}

/** Unregistered public JSONL callback client for the read-only branch inspection candidate. */
export class BranchInspectClient {
	readonly #request: Request;

	constructor(request: Request) {
		this.#request = request;
	}

	async inspect(params: BranchInspectParams): Promise<BranchInspectPreview> {
		if (!validBranchInspectParams(params)) throw new BranchInspectClientError("BRANCH_INSPECT_COMMAND_SCHEMA");
		const id = crypto.randomUUID();
		const command = { ...structuredClone(params), id, type: "branch_inspect" } as const;
		const { source, entryId, expected } = command;
		const reply = await this.#request(structuredClone(command));
		if (!validBranchInspectResponse(reply) || reply.id !== id)
			throw new BranchInspectClientError("BRANCH_INSPECT_RESPONSE_SCHEMA");
		if (!reply.success) throw new BranchInspectClientError(reply.code);
		const { data } = reply;
		if (data.entryId !== entryId || !sameBranchSource(data.source, source) ||
			(expected && (data.parentId !== expected.parentId || data.targetRevision !== expected.targetRevision ||
				data.contextRevision !== expected.contextRevision))) throw new BranchInspectClientError("BRANCH_INSPECT_RESPONSE_SCHEMA");
		return data;
	}
}
