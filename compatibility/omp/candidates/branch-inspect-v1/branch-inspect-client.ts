import {
	type BranchInspectCommand,
	type BranchInspectParams,
	type BranchInspectPreview,
	sameBranchSource,
	validBranchInspectCommand,
	validBranchInspectResponse,
} from "./branch-inspect-wire";

type Request = (command: BranchInspectCommand & { id: string }) => Promise<unknown>;

/** Unregistered public JSONL callback client for the read-only branch inspection candidate. */
export class BranchInspectClient {
	readonly #request: Request;

	constructor(request: Request) {
		this.#request = request;
	}

	async inspect(params: BranchInspectParams): Promise<BranchInspectPreview> {
		const { source, entryId, expected } = structuredClone(params);
		const id = crypto.randomUUID();
		const command = { id, type: "branch_inspect", source, entryId, ...(expected === undefined ? {} : { expected }) } as const;
		if (!validBranchInspectCommand(command)) throw new Error("BRANCH_INSPECT_COMMAND_SCHEMA");
		const reply = await this.#request(structuredClone(command));
		if (!validBranchInspectResponse(reply) || reply.id !== id) throw new Error("BRANCH_INSPECT_RESPONSE_SCHEMA");
		if (!reply.success) throw new Error(reply.code);
		const { data } = reply;
		if (data.entryId !== entryId || !sameBranchSource(data.source, source) ||
			(expected && (data.parentId !== expected.parentId || data.targetRevision !== expected.targetRevision ||
				data.contextRevision !== expected.contextRevision))) throw new Error("BRANCH_INSPECT_RESPONSE_SCHEMA");
		return data;
	}
}
