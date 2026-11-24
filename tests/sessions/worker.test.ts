import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { InteractionBridge } from "../../packages/interactions/bridge.ts";
import { isSubmissionResult } from "../../packages/contracts/submissions.ts";
import type { SubmissionClientCommand } from "../../packages/contracts/candidates/durable-submission-v1/submission-client.ts";
import { nativeFixture } from "../catalog/fixture.ts";
import { catalog, launch } from "./worker.ts";

test("public combined worker handles genuine startup UI at root before binding then reads authoritative history", async () => {
  const home = await mkdtemp(join(tmpdir(), "session-worker-")); await nativeFixture(home);
  const discovery = await catalog(home), worker = await launch(home, join(home, "project"), true);
  const bridge = new InteractionBridge(worker);
  try {
    const selected = (await discovery.catalog.page()).items[0]!;
    const opening = worker.startup.start({ intent: "continue", reference: selected.reference, expectedCwd: join(home, "project") });
    let pending = bridge.snapshot().pending;
    for (let attempt = 0; pending.length === 0 && attempt < 1500; attempt++) {
      await Bun.sleep(10); pending = bridge.snapshot().pending;
    }
    if (!pending.length) console.error(JSON.stringify({ startup: await worker.startup.state(), buffered: worker.frames, bridge: bridge.snapshot() }));
    expect(pending[0]?.scope).toEqual({ kind: "startup" });
    expect((await worker.startup.state()).phase).toBe("opening");
    expect(await bridge.answer(bridge.generation, pending[0]!.id, { type: "value", value: "Synthetic owner" }))
      .toEqual({ status: "answered" });
    const opened = await opening;
    expect(opened).toMatchObject({ phase: "open", nativeSessionId: "native-0000", binding: {
      sourceId: selected.sourceId, instanceId: selected.instanceId, ownership: { state: "held" } } });
    bridge.bindSession(opened.nativeSessionId!);
    const history = await worker.history.open("active");
    const page = await worker.history.page(history.cursor);
    expect(JSON.stringify(page)).toContain("entry-0");
    await worker.history.close(history.snapshot);
    expect(await worker.state()).toMatchObject({ sessionId: "native-0000", isSettled: true, queuedMessageCount: 0 });
  } finally {
    bridge.dispose(); const result = await worker.close({ cooperativeMs: 30_000, terminationGraceMs: 5_000, readerGraceMs: 1000 });
    expect(result).toMatchObject({ code: 0, forced: false, stdoutEOF: true, stderrEOF: true });
    await discovery.close(); await rm(home, { recursive: true, force: true });
  }
}, 30_000);

test("the public worker lists genuine Native slash commands and executes one as a Native prompt", async () => {
  const home = await mkdtemp(join(tmpdir(), "session-worker-")); await nativeFixture(home);
  const discovery = await catalog(home), worker = await launch(home, join(home, "project"), true);
  const bridge = new InteractionBridge(worker);
  try {
    const selected = (await discovery.catalog.page()).items[0]!;
    const opening = worker.startup.start({ intent: "continue", reference: selected.reference, expectedCwd: join(home, "project") });
    let pending = bridge.snapshot().pending;
    for (let attempt = 0; pending.length === 0 && attempt < 1500; attempt++) {
      await Bun.sleep(10); pending = bridge.snapshot().pending;
    }
    expect(await bridge.answer(bridge.generation, pending[0]!.id, { type: "value", value: "Synthetic owner" }))
      .toEqual({ status: "answered" });
    const opened = await opening;
    expect(opened.phase).toBe("open");
    bridge.bindSession(opened.nativeSessionId!);
    const commands = await worker.availableCommands();
    const model = commands.find(command => command.name === "model");
    expect(model).toMatchObject({ name: "model", source: "builtin" });
    expect(model?.description?.length).toBeGreaterThan(0);
    expect(commands.every(command => command.name.length > 0 && command.source.length > 0)).toBe(true);
    const id = randomUUID();
    const target = { sourceId: selected.sourceId, instanceId: selected.instanceId, nativeSessionId: opened.nativeSessionId! };
    const command: SubmissionClientCommand = { type: "submission_submit", id, ...target,
      clientSubmissionId: id, preparationId: `command-v1:${id}`, inputType: "prompt", idleOnly: true, message: "/model" };
    const reply = await worker.submitCommand(command);
    expect(reply).toMatchObject({ type: "response", id, command: "submission_submit", success: true });
    if (typeof reply !== "object" || reply === null || !("data" in reply)) throw new Error("SUBMISSION_ENVELOPE");
    const result = reply.data;
    expect(isSubmissionResult(result) && { found: result.found, terminal: result.terminal, inputOutcome: result.inputOutcome })
      .toEqual({ found: true, terminal: true, inputOutcome: "no_input" });
  } finally {
    bridge.dispose(); const result = await worker.close({ cooperativeMs: 30_000, terminationGraceMs: 5_000, readerGraceMs: 1000 });
    expect(result).toMatchObject({ code: 0, forced: false, stdoutEOF: true, stderrEOF: true });
    await discovery.close(); await rm(home, { recursive: true, force: true });
  }
}, 30_000);
