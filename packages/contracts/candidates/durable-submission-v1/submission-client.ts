/** Public bounded native submission API; query never retransmits input. */
import type { RpcWireCommands, SubmissionResult } from "./omp-wire";
export type SubmissionClientName = "submission_submit" | "submission_query";
export type SubmissionClientCommand = { [K in SubmissionClientName]: { id: string; type: K } & RpcWireCommands[K]["params"] }[SubmissionClientName];
export class SubmissionClient {
  constructor(private readonly send: (command: SubmissionClientCommand) => Promise<unknown>,
    private readonly validate: (value: unknown) => value is SubmissionResult) {}
  async #request(command: SubmissionClientCommand): Promise<SubmissionResult> {
    const result = await this.send(command);
    if (!this.validate(result) || result.clientSubmissionId !== command.clientSubmissionId) throw new Error("SUBMISSION_RESULT_INVALID");
    return result;
  }
  submit(input: RpcWireCommands["submission_submit"]["params"]): Promise<SubmissionResult> {
    return this.#request({ ...input, id: crypto.randomUUID(), type: "submission_submit" });
  }
  query(clientSubmissionId: string, offset = 0, limit = 64): Promise<SubmissionResult> {
    return this.#request({ id: crypto.randomUUID(), type: "submission_query", clientSubmissionId, offset, limit });
  }
}
