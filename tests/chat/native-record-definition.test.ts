import { expect, test } from "bun:test";
import { Context } from "@deepseek-ai/cordis";
import type { ConversationMatch, ConversationNodeContext, ConversationStartMatch } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { ConversationNodeAssembler } from "@deepseek-ai/dsh-client-ui-conversation/src/client/conversation/assembler.ts";
import { ConversationEventRegistry } from "@deepseek-ai/dsh-client-ui-conversation/src/client/conversation/event-registry.ts";
import { ConversationViewRegistry } from "@deepseek-ai/dsh-client-ui-conversation/src/client/conversation/view-registry.ts";
import { trajectoryViewDefinition } from "@deepseek-ai/dsh-client-ui-trajectory/src/client/trajectory-snapshot-builder.ts";
import { SessionSeq } from "@deepseek-ai/dsh-session/types";
import { trajectoryNativeRecordDefinition } from "../../apps/chat/src/trajectory-native-record-definition.ts";

test("structural native records remain visible in an otherwise empty trajectory window", () => {
  const event = {
    type: "omp/native-record", seq: SessionSeq(7), time: 1,
    data: { id: "usage-7", kind: "structural", text: "cached input tokens" }, surfaceOp: "append",
  } satisfies ConversationMatch["event"];
  expect(trajectoryNativeRecordDefinition.match(event)).toEqual({ id: "7", role: "start" });
  const match: ConversationStartMatch = { event, role: "start", location: { kind: "unresolved" } };
  const context: ConversationNodeContext<ConversationMatch> = {
    key: "native-7", kind: trajectoryNativeRecordDefinition.kind, id: "7",
    matches: [match], start: match, state: match, current: new Map(),
  };
  expect(trajectoryNativeRecordDefinition.buildViewNode?.(context)).toMatchObject({
    key: "native-7", target: "trajectory", anchorSeq: 7,
    data: { kind: "node", node: event },
  });

  const ctx = new Context();
  const events = new ConversationEventRegistry(ctx);
  const views = new ConversationViewRegistry(ctx);
  events.register(trajectoryNativeRecordDefinition);
  views.register(trajectoryViewDefinition);
  const assembler = new ConversationNodeAssembler(events, views);
  assembler.replaceWindow([{ event }], true);
  assembler.activateTarget("trajectory");
  expect(assembler.snapshot("trajectory")).toMatchObject({ eventNodes: [event] });
});
