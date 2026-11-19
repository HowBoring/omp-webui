/** Public preparation client. It owns no path, Session, Agent or provider authority. */
import type { RpcWireCommands, AttachmentReceipt, AttachmentRepresentation } from "./omp-wire";
export type AttachmentCommand = { id?: string; type: "attachment_prepare" } & RpcWireCommands["attachment_prepare"]["params"]
	| { id?: string; type: "attachment_cancel"; preparationId: string };
export class AttachmentClient {
	constructor(private readonly send: (command: AttachmentCommand) => Promise<unknown>,
		private readonly validateReceipt: (value: unknown) => value is AttachmentReceipt) {}
	async prepare(input: RpcWireCommands["attachment_prepare"]["params"]): Promise<AttachmentReceipt> {
		const result = await this.send({ ...input, id: crypto.randomUUID(), type: "attachment_prepare" });
		if (!this.validateReceipt(result) || result.preparationId !== input.preparationId || result.draftId !== input.draftId ||
			result.draftRevision !== input.draftRevision || result.authorityGeneration !== input.authorityGeneration ||
			result.budgetVersion !== "attachment-budgets-v1" || result.items.length !== input.objects.length ||
			(result.status === "ready") !== result.items.every(item => item.status === "ready")) {
			throw new Error("ATTACHMENT_RECEIPT_INVALID");
		}
		for (let index = 0; index < result.items.length; index++) {
			const item = result.items[index]!, original = input.objects[index]!;
			if (item.originalId !== original.originalId || item.originalSha256 !== original.sha256 ||
				(item.status === "ready" && await representationDigest(item.representation) !== item.preparedSha256)) {
				throw new Error("ATTACHMENT_RECEIPT_INVALID");
			}
		}
		return result;
	}
	async cancel(preparationId: string): Promise<{ cancelled: boolean }> {
		const result = await this.send({ id: crypto.randomUUID(), type: "attachment_cancel", preparationId });
		if (!result || typeof result !== "object" || !("cancelled" in result) || typeof result.cancelled !== "boolean") {
			throw new Error("ATTACHMENT_CANCEL_INVALID");
		}
		return { cancelled: result.cancelled };
	}
}

async function representationDigest(value: AttachmentRepresentation): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
	return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
