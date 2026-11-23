/** Public stock commands Remote: the Native catalog plus one chosen line submitted to the exact worker. */
import { expect, test } from "bun:test";
import { Context } from "@deepseek-ai/cordis";
import TypertRegistry from "@deepseek-ai/dsh-typert-registry";
import RemoteAccessService from "@deepseek-ai/dsh-api-remote-access";
import { TypertGatewayService } from "@deepseek-ai/dsh-api-gateway";
import { Peer } from "@deepseek-ai/dsh-client-connection";
import { TYPERT_REMOTE } from "@deepseek-ai/dsh-commands/remote";
import { installConnection } from "@deepseek-ai/dsh-client-connection/client";
import { apply as registry } from "@deepseek-ai/dsh-typert-registry/client";
import { apply as gateway } from "@deepseek-ai/dsh-api-gateway/client";
import { dispatchSessionRequest } from "../../apps/host/src/session-remote-dispatch.ts";
import { sessionsContribution, sessionsHostContribution } from "../../packages/contracts/sessions.ts";
import { SessionsService, sessionCaller } from "../../packages/sessions/service.ts";
import { commandsHostContribution, CommandsService } from "../../packages/commands/service.ts";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import type { SubmissionClientCommand } from "../../packages/contracts/candidates/durable-submission-v1/submission-client.ts";
import { sourceFixture } from "../sessions/source-fixture.ts";

const commandsRemote = { package: TYPERT_REMOTE.package,
  descriptors: TYPERT_REMOTE.descriptors.filter(value => value.namespace === "commands"),
  methods: { "commands/list": TYPERT_REMOTE.methods["commands/list"],
    "commands/execute": TYPERT_REMOTE.methods["commands/execute"] } };

async function fixture() {
  const f = await sourceFixture(), host = new Context(), client = new Context();
  let authorized = true;
  await host.plugin(TypertRegistry); await host.plugin(RemoteAccessService); await host.plugin(TypertGatewayService, {});
  host.typert.register(sessionsHostContribution); host.typert.register(commandsHostContribution);
  new SessionsService(host, f);
  new CommandsService(host, sessionId => authorized ? f.supervisor.commandsAccess(f.identity, sessionId) : undefined);
  const peer = new Peer(host, { principal: { kind: "owner" }, interactions: "none" });
  installConnection(client, { interactions: "none", transport: {
    async fetch(url, init) {
      const request = new Request(new URL(url, f.origin), { ...init, headers: { "content-type": "application/json" } });
      return sessionCaller.run(f.identity,
        () => dispatchSessionRequest(request, host, peer, () => authorized && f.authority.revalidate(f.identity)));
    }, openStream: async function* () {},
  } });
  registry(client); gateway(client);
  await client.remote.$mount(sessionsContribution); await client.remote.$mount(commandsRemote);
  const page = await client.remote.ompSessions.catalog({});
  if (!page.ok) throw page.error;
  const opened = await client.remote.ompSessions.open(page.value.choices[0]!.selectionId);
  if (!opened.ok) throw opened.error;
  return { ...f, session: SessionId(f.controls.sessionId), remote: client.remote.commands, revoke: () => { authorized = false; },
    async close() { await client.fiber.dispose(); await peer.dispose(); await host.fiber.dispose(); await f.close(); } };
}

test("the stock commands face lists the Native catalog minus the stock client's own slash names", async () => {
  const f = await fixture();
  try {
    const listed = await f.remote.list(f.session);
    // `model` is a stock client contribution in this frozen DSH shell; repeating it in the host
    // catalog makes the stock command menu throw, so the face omits it.
    expect(listed.ok && listed.value).toEqual([{ name: "context", description: "Show context usage" }]);
  } finally { await f.close(); }
});

test("a known command is submitted as the exact Native prompt and an unknown line is not sent", async () => {
  const f = await fixture();
  try {
    let submitted: SubmissionClientCommand | undefined;
    f.controls.submissionReply = command => {
      if (command.type !== "submission_submit") throw new Error("UNEXPECTED_SUBMISSION");
      submitted = command;
      const target = { sourceId: command.sourceId, instanceId: command.instanceId, nativeSessionId: command.nativeSessionId };
      return { type: "response", id: command.id, command: command.type, success: true, data: {
        version: "durable-submission-v1", clientSubmissionId: command.clientSubmissionId, target,
        found: true, duplicate: false, admission: "local", reservation: "committed", inputOutcome: "no_input",
        operationOutcome: "succeeded", persistence: "committed", terminal: true, nextOffset: null,
        origin: { ...target, clientSubmissionId: command.clientSubmissionId },
        relations: [{ relationId: "entry:consumed", role: "input", status: "no_entry",
          persistence: "committed", reason: "native_builtin_consumed" }] } };
    };
    for (const line of ["/missing", "/model", "model", " / "]) {
      const missed = await f.remote.execute(f.session, line, []);
      expect(missed.ok && missed.value).toBeUndefined();
    }
    expect(submitted).toBeUndefined();
    const executed = await f.remote.execute(f.session, "/context", []);
    expect(executed.ok && executed.value?.result).toEqual({ kind: "success" });
    expect(submitted).toMatchObject({ type: "submission_submit", inputType: "prompt", idleOnly: true,
      message: "/context", sourceId: "source", instanceId: "instance", nativeSessionId: "native-session" });
  } finally { await f.close(); }
});

test("a busy Native reservation and revoked browser authority report no success", async () => {
  const f = await fixture();
  try {
    f.controls.submissionReply = command => ({ type: "response", id: command.id, command: command.type, success: false, code: "SUBMISSION_BUSY" });
    const busy = await f.remote.execute(f.session, "/context", []);
    expect(busy.ok && busy.value?.result).toEqual({ kind: "error", text: "The session is busy; the command was not run." });
    f.revoke();
    expect((await f.remote.list(f.session)).ok).toBe(false);
    expect((await f.remote.execute(f.session, "/context", [])).ok).toBe(false);
  } finally { await f.close(); }
});
