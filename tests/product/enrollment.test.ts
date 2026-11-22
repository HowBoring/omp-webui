/**
 * The stock product enrollment plugin must read the mounted Remote namespaces from a fiber that
 * declares them: `remote.ompSessions` is provided as a service name, and an undeclared property read
 * throws `cannot get property "remote.ompSessions" without inject`. This mounts the plugin through
 * its real export shape against sibling-provided namespace services — the topology the product shell
 * uses — and proves attach and projection renewal happen.
 */
import { expect, test } from "bun:test";
import { Context, Service, type Plugin } from "@deepseek-ai/cordis";
import type { TypertRemoteContribution } from "@deepseek-ai/dsh-typert-protocol";
import type { ChatAttachment } from "../../packages/contracts/chat-component.ts";

interface PluginDefinition { inject?: string[]; apply(ctx: Context): void }

const loaded: PluginDefinition[] = [];
const storage = new Map<string, string>();
// Bun's module-loader boundary: the browser module registers itself on globals that a test does not have.
Object.defineProperty(globalThis, "__ModuleLoader__", { configurable: true,
  value: { load: (entry: { factory: () => PluginDefinition }) => { loaded.push(entry.factory()); } } });
Object.defineProperty(globalThis, "sessionStorage", { configurable: true,
  value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } } });
// Static import cannot run the browser module's Loader registration before the capture above exists.
await import("../../apps/chat/src/product-enrollment.js");
const definition = loaded[0]!;

interface View {
  workerId: string;
  generation: string;
  state: string;
  registration: { nativeSessionId: string };
}
interface ProjectionBinding { source: string; generation: string }
interface Snapshot { phase: string; binding: ProjectionBinding }



/** One namespace contribution as `ClientRemote.$mount` installs it: a sibling-provided service. */
class RemoteStub extends Service {
  readonly calls: ChatAttachment[] = [];
  readonly attached = Promise.withResolvers<void>();
  view: View | undefined;
  constructor(ctx: Context) { super(ctx, "remote"); }
  async $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
    const namespace = contribution.descriptors[0]!.namespace;
    const service = namespace === "ompSessions"
      ? { current: async () => ({ ok: true as const, value: this.view === undefined ? undefined : { view: this.view } }) }
      : { attach: async (input: ChatAttachment) => {
          this.calls.push(input);
          this.attached.resolve();
          return { ok: true as const, value: { owner: "owner", workerId: input.workerId,
            sessionId: input.projection.source, generation: input.projection.generation, draftId: input.draftId } };
        } };
    const fiber = this.ctx.plugin({ inject: [], apply: ctx => { ctx.provide(`remote.${namespace}`, service); } });
    await fiber;
    return async () => { await fiber.dispose(); };
  }
}

const sessionId = "native-1";

async function fixture() {
  const ctx = new Context();
  const remote = new RemoteStub(ctx);
  let listener = () => {};
  let subscribed = false;
  let snapshot: Snapshot = { phase: "ready", binding: { source: sessionId, generation: "g1" } };
  ctx.provide("sessions", {
    retain: (id: string) => ({ id, ready: Promise.resolve({ projection: {
      getSnapshot: () => snapshot,
      subscribe: (next: () => void) => { listener = next; subscribed = true; return () => { listener = () => {}; }; },
    } }), release: () => {} }),
  });
  ctx.provide("uiSession", { adapter: { current: { getSnapshot: () => ({ key: sessionId }), subscribe: () => () => {} } } });
  remote.view = { workerId: "worker-1", generation: "g1", state: "open", registration: { nativeSessionId: sessionId } };
  const plugin: Plugin = definition;
  await ctx.plugin(plugin);
  return {
    ctx, remote,
    subscribed: () => subscribed,
    renew(generation: string) {
      snapshot = { phase: "ready", binding: { source: sessionId, generation } };
      remote.view = { ...remote.view!, generation };
      listener();
    },
    dispose: () => ctx.fiber.dispose(),
  };
}

const flush = async (condition: () => boolean) => {
  for (let turn = 0; turn < 10_000 && !condition(); turn++) await Promise.resolve();
};

test("enrollment attaches the ready stock projection through declared Remote namespaces", async () => {
  const f = await fixture();
  try {
    await flush(() => f.remote.calls.length > 0);
    expect(f.remote.calls).toHaveLength(1);
    expect(f.remote.calls[0]!.workerId).toBe("worker-1");
    expect(f.remote.calls[0]!.projection).toEqual({ source: sessionId, generation: "g1" });
    expect(f.remote.calls[0]!.draftId.length).toBeGreaterThan(0);
    await flush(() => f.subscribed());
    f.renew("g2");
    await flush(() => f.remote.calls.length > 1);
    expect(f.remote.calls).toHaveLength(2);
    expect(f.remote.calls[1]!.projection).toEqual({ source: sessionId, generation: "g2" });
  } finally { await f.dispose(); }
});
