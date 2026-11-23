import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import { TYPERT_REMOTE } from "@deepseek-ai/dsh-commands/remote";
import { CommandId } from "@deepseek-ai/dsh-commands/brand";
import type { CommandDescriptor, CommandExecution, CommandSubmitAttachment } from "@deepseek-ai/dsh-commands/types";
import { Remote, RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertContribution } from "@deepseek-ai/dsh-typert-registry";
// These declarations merge the stock `agent` lookup (SessionId -> Agent) and the `session` resource kind.
import type {} from "@deepseek-ai/dsh-agent/types";
import type {} from "@deepseek-ai/dsh-session/types";
import type { NativeCommand } from "../compatibility/session-worker.ts";
import { requestLocalSubmission, submissionBusy, submissionConflict } from "../contracts/submission-reply.ts";
import type { SubmissionClientCommand } from "../contracts/candidates/durable-submission-v1/submission-client.ts";

/**
 * The stock commands face is exactly the Native slash-command catalog: the worker decides which
 * commands exist and can run now, while the Host only maps them and submits the chosen line back.
 */
export const commandsHostContribution: TypertContribution = {
  package: "@omp-webui/web-commands", face: "host", schemas: [], model: { services: [], events: [], objects: [] },
  invocations: TYPERT_REMOTE.descriptors.filter(value => value.namespace === "commands"),
};
export interface CommandsWorker {
  availableCommands(): Promise<readonly NativeCommand[]>;
  submitCommand(command: SubmissionClientCommand): Promise<unknown>;
}
export interface CommandsAccess {
  readonly worker: CommandsWorker;
  readonly target: { readonly sourceId: string; readonly instanceId: string; readonly nativeSessionId: string };
}

/** The client sends the whole line, as its stock handler does; only a leading slash names a command. */
const commandNamePattern = /^\s*\/(\S+)/u;

/**
 * Host-owned commands face for one browser credential. `resolve` must synchronously recheck the
 * browser, the exact live worker and its Native Session before either the catalog or a send.
 */
export class CommandsService extends TypertRemoteService {
  constructor(ctx: Context, private readonly resolve: (sessionId: string) => CommandsAccess | undefined) {
    super(ctx, "commands", { namespace: "commands" });
    ctx.inject(["typert"], type => {
      type.typert.lookups.register("agent", {
        parameter: "agent", wire: "agentId", resource: "session",
        hostTypeSymbol: "@deepseek-ai/dsh-agent#Agent",
        wireTypeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
        resolve: sessionId => ({ id: sessionId }),
      });
    });
  }
  private access(agent: { readonly id: string }): CommandsAccess {
    const invocation = this.ctx.invocation;
    if (!invocation || invocation.signal.aborted || invocation.peer.signal.aborted) {
      throw new RemoteError("gateway/bad-request", "Command authority is unavailable.", {});
    }
    let access: CommandsAccess | undefined;
    try { access = this.resolve(agent.id); } catch { access = undefined; }
    if (!access) throw new RemoteError("gateway/bad-request", "Command authority is unavailable.", {});
    return access;
  }
  @Remote("list") async list(agent: { readonly id: string }): Promise<readonly CommandDescriptor[]> {
    return (await this.access(agent).worker.availableCommands()).map(command => ({
      name: command.name, description: command.description ?? "",
      ...(command.input?.hint ? { input: { hint: command.input.hint } } : {}),
    }));
  }
  @Remote("execute") async execute(agent: { readonly id: string }, line: string,
    submittedAttachments: readonly CommandSubmitAttachment[]): Promise<CommandExecution | undefined> {
    const name = commandNamePattern.exec(line)?.[1];
    if (name === undefined) return undefined;
    const access = this.access(agent);
    if (submittedAttachments.length > 0) {
      return { commandId: CommandId(randomUUID()),
        result: { kind: "error", text: "Native commands do not accept submitted attachments." } };
    }
    const catalog = await access.worker.availableCommands();
    if (!catalog.some(command => command.name === name)) return undefined;
    const id = CommandId(randomUUID());
    // The line is submitted as a Native prompt, exactly like the stock Agent Hub: the worker resolves
    // builtin, skill, extension, custom, MCP prompt and file commands itself. Never reimplement them.
    const command: SubmissionClientCommand = { type: "submission_submit", id, ...access.target,
      clientSubmissionId: id, preparationId: `command-v1:${id}`, inputType: "prompt", idleOnly: true, message: line };
    let reply;
    try { reply = await requestLocalSubmission(access.target, command, value => access.worker.submitCommand(value)); }
    catch { reply = undefined; }
    if (reply === submissionBusy) {
      return { commandId: id, result: { kind: "error", text: "The session is busy; the command was not run." } };
    }
    if (reply === submissionConflict) {
      return { commandId: id, result: { kind: "error", text: "The command conflicted with another submission." } };
    }
    if (reply === undefined) {
      return { commandId: id, result: { kind: "error", text: "The command could not be submitted." } };
    }
    return { commandId: id, result: { kind: "success" } };
  }
}
