import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseProjectionBinding } from "@deepseek-ai/dsh-api-session-controller/projection";
import { NavigationClient } from "../contracts/candidates/durable-navigation-v1/navigation-client.ts";
import { validNavigationPreview, validNavigationResult } from "../contracts/candidates/durable-navigation-v1/validators.ts";
import type { HistoryNavigationSourcePorts, NavigationAccess, NavigationOperationMetadata, NavigationScope } from "../history-navigation-source/ports.ts";
import type { StopSnapshot } from "../contracts/stop.ts";
import type { NavigationFixtureSnapshot, NavigationFixtureTreeItem } from "../contracts/navigation-fixture.ts";

export const FIXTURE_POLICY = {
  version: "durable-navigation-v1", status: "prototype", durability: "process-crash-only",
  query: "read-only-no-execution", maxOperations: 32,
} as const;

interface WorkerOptions { bun: string; cli: string; guard: string; provider: string; cwd: string; env: Record<string, string> }

/** One real strict worker speaking JSONL RPC v2 over stdio. Fixture-only; never used by the product Host. */
class Worker {
  readonly #child!: Bun.Subprocess<"pipe", "pipe", "pipe">;
  readonly #pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  #buffer = "";
  #ready = Promise.withResolvers<void>();
  #exited = Promise.withResolvers<number>();

  constructor(options: WorkerOptions, private readonly resume: string | undefined) {
    this.#child = Bun.spawn([options.bun, "--no-env-file", "--no-install",
      "--preload", options.guard, options.cli, "--mode", "rpc-ui", "--strict-start", "--offline",
      "--no-lsp", "--no-skills", "--no-rules", "--no-spotlight", "--no-judge", "--no-context-files",
      "--model", "navigation-controlled/literal", "--trusted-extension", options.provider],
      { cwd: options.cwd, env: options.env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    void this.#read();
    void (async () => { for await (const chunk of this.#child.stderr) void chunk; })();
    void this.#child.exited.then(code => this.#exited.resolve(code ?? -1));
  }

  async #read(): Promise<void> {
    const reader = this.#child.stdout.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        this.#buffer += decoder.decode(value, { stream: true });
        for (let line = this.#buffer.indexOf("\n"); line >= 0; line = this.#buffer.indexOf("\n")) {
          const text = this.#buffer.slice(0, line).trim();
          this.#buffer = this.#buffer.slice(line + 1);
          if (text) this.#frame(text);
        }
      }
    } catch { /* the exit path reports the loss */ }
    this.#exited.resolve(-1);
    for (const waiter of this.#pending.values()) waiter.reject(new Error("worker_exited"));
    this.#pending.clear();
  }

  #frame(text: string): void {
    let frame: { id?: string; type?: string; data?: unknown; code?: string; error?: string };
    try { frame = JSON.parse(text); } catch { return; }
    if (frame.type === "ready") { this.#ready.resolve(); return; }
    if (!frame.id) return;
    const waiter = this.#pending.get(frame.id);
    if (!waiter) return;
    this.#pending.delete(frame.id);
    if (frame.type === "response" && frame.code === undefined) waiter.resolve(frame.data);
    else waiter.reject(new Error(frame.code ?? "RPC_REMOTE_REJECTED"));
  }

  async ready(): Promise<void> { await this.#ready.promise; }

  request(payload: Record<string, unknown>, timeoutMs = 15_000): Promise<unknown> {
    const id = typeof payload.id === "string" ? payload.id : randomUUID();
    const outcome = Promise.withResolvers<unknown>();
    this.#pending.set(id, outcome);
    this.#child.stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
    const timer = setTimeout(() => {
      this.#pending.delete(id);
      outcome.reject(new Error("rpc_timeout"));
    }, timeoutMs);
    return outcome.promise.finally(() => clearTimeout(timer));
  }

  get exited(): Promise<number> { return this.#exited.promise; }

  kill(): void { this.#child.kill("SIGKILL"); }

  async close(): Promise<void> {
    this.kill();
    await this.exited;
  }
}

export interface NavigationFixtureOptions extends Omit<WorkerOptions, "env"> {
  readonly home: string;
  readonly project: string;
}

/**
 * Isolated navigation acceptance fixture: a real strict worker plus fixture-only seams for
 * browser scope, joint Stop state and projection. Nothing here is imported by the product Host.
 */
export class NavigationFixture {
  #worker: Worker | undefined;
  #client: NavigationClient | undefined;
  #metadata = new Map<string, NavigationOperationMetadata>();
  #sessionId = randomUUID();
  #sourceId = "";
  #instanceId = "";
  #nativeSessionId = "";
  #workerId = randomUUID();
  #contextId = randomUUID();
  #reference: string | undefined;
  #projection = { source: `navigation-fixture/${randomUUID()}`, generation: 0 };
  #authority: AbortController | undefined;
  #phase: "booting" | "idle" | "crashed" | "reopened" | "failed" = "booting";
  #starts = 0;
  #error: string | undefined;

  constructor(private readonly options: NavigationFixtureOptions) {}

  get sessionId(): string { return this.#sessionId; }

  async start(): Promise<void> {
    await rm(this.options.home, { recursive: true, force: true });
    await mkdir(join(this.options.home, ".omp/agent"), { recursive: true });
    await mkdir(this.options.project, { recursive: true });
    try {
      await this.#spawn();
      await this.#prompt("fixture prompt 1");
      await this.#prompt("fixture prompt 2");
      this.#phase = "idle";
    } catch (error) {
      this.#phase = "failed";
      this.#error = error instanceof Error ? error.message : "fixture_start_failed";
    }
  }

  async #spawn(): Promise<void> {
    this.#authority?.abort();
    this.#authority = new AbortController();
    const worker = new Worker({
      bun: this.options.bun, cli: this.options.cli, guard: this.options.guard,
      provider: this.options.provider, cwd: this.options.cwd,
      env: {
        HOME: this.options.home, TMPDIR: this.options.home,
        PI_CODING_AGENT_DIR: join(this.options.home, ".omp/agent"),
        XDG_CONFIG_HOME: join(this.options.home, "config"), XDG_CACHE_HOME: join(this.options.home, "cache"),
        XDG_DATA_HOME: join(this.options.home, "data"), PI_NOTIFICATIONS: "off", NO_COLOR: "1",
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", NODE_DISABLE_COMPILE_CACHE: "1",
        PATH: "/usr/bin:/bin",
      },
    }, this.#reference);
    this.#worker = worker;
    this.#client = new NavigationClient(command => worker.request(command as unknown as Record<string, unknown>),
      validNavigationResult, validNavigationPreview);
    this.#starts += 1;
    await worker.ready();
    await worker.request({ type: "negotiate_protocol", protocolVersion: 2 });
    const start = await worker.request(this.#reference === undefined
      ? { type: "strict_start", intent: "new", expectedCwd: this.options.project }
      : { type: "strict_start", intent: "continue", expectedCwd: this.options.project, reference: this.#reference }) as {
        binding?: { sourceId?: string; instanceId?: string; nativeSessionId?: string; reference?: string };
      };
    const binding = start.binding;
    if (!binding?.sourceId || !binding.instanceId || !binding.nativeSessionId) throw new Error("STRICT_START_BINDING");
    this.#sourceId ||= binding.sourceId;
    this.#instanceId ||= binding.instanceId;
    this.#nativeSessionId ||= binding.nativeSessionId;
    this.#reference ||= binding.reference;
  }

  async #request(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const worker = this.#worker;
    if (!worker || this.#phase === "crashed") throw new Error("worker_unavailable");
    return await worker.request(payload) as Record<string, unknown>;
  }

  async #prompt(message: string): Promise<void> {
    const clientSubmissionId = randomUUID();
    await this.#request({ type: "submission_submit", sourceId: this.#sourceId, instanceId: this.#instanceId,
      nativeSessionId: this.#nativeSessionId, clientSubmissionId, preparationId: `prep:${randomUUID()}`,
      inputType: "prompt", message, idleOnly: true });
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const query = await this.#request({ type: "submission_query", clientSubmissionId, limit: 128 }) as {
        state?: { terminal?: boolean; persistence?: string };
        terminal?: boolean;
        persistence?: string;
      };
      const state = query.state ?? query;
      if (state.terminal === true || state.persistence === "failed" || state.persistence === "unknown") return;
      await Bun.sleep(50);
    }
    throw new Error("submission_timeout");
  }

  async #tree(): Promise<{ items: NavigationFixtureTreeItem[]; activeId: string | null }> {
    const opened = await this.#request({ type: "history_snapshot_open", scope: "tree" }) as {
      snapshot?: string; cursor?: string | null;
    };
    if (!opened.snapshot) throw new Error("HISTORY_OPEN_SCHEMA");
    const items: NavigationFixtureTreeItem[] = [];
    let cursor = opened.cursor ?? null;
    for (let page = 0; cursor !== null && page < 64; page += 1) {
      const result = await this.#request({ type: "history_snapshot_page", cursor }) as {
        items?: { id: string; parentId: string | null; kind: string; active: boolean; text?: string; role?: string; entryId?: string }[];
        cursor?: string | null;
      };
      for (const item of result.items ?? []) items.push({ id: item.id, parentId: item.parentId,
        kind: item.kind, active: item.active, entryId: item.entryId ?? null,
        text: item.text ?? null, role: item.role ?? null });
      cursor = result.cursor ?? null;
    }
    await this.#request({ type: "history_snapshot_close", snapshot: opened.snapshot });
    return { items, activeId: items.find(item => item.active)?.id ?? null };
  }

  async snapshot(): Promise<NavigationFixtureSnapshot> {
    if (this.#phase === "crashed" || this.#phase === "failed") {
      return { phase: this.#phase, sessionId: this.#sessionId, starts: this.#starts,
        nativeSessionId: this.#nativeSessionId, tree: [], activeId: null,
        hooks: await this.#hooks(), providerCalls: await this.#providerCalls(),
        ...(this.#error === undefined ? {} : { error: this.#error }) };
    }
    try {
      const tree = await this.#tree();
      return { phase: this.#phase, sessionId: this.#sessionId, starts: this.#starts,
        nativeSessionId: this.#nativeSessionId, tree: tree.items, activeId: tree.activeId,
        hooks: await this.#hooks(), providerCalls: await this.#providerCalls() };
    } catch (error) {
      return { phase: "failed", sessionId: this.#sessionId, starts: this.#starts,
        nativeSessionId: this.#nativeSessionId, tree: [], activeId: null,
        hooks: await this.#hooks(), providerCalls: await this.#providerCalls(),
        error: error instanceof Error ? error.message : "fixture_read_failed" };
    }
  }

  async #hooks(): Promise<{ before: number; tree: number } | null> {
    try {
      return JSON.parse(await readFile(join(this.options.cwd, "navigation-hooks.json"), "utf8")) as { before: number; tree: number };
    } catch { return null; }
  }

  async #providerCalls(): Promise<number | null> {
    try {
      const effects = JSON.parse(await readFile(join(this.options.cwd, "navigation-provider-effects.json"), "utf8")) as { calls?: number };
      return typeof effects.calls === "number" ? effects.calls : null;
    } catch { return null; }
  }

  async crash(): Promise<void> {
    const worker = this.#worker;
    if (!worker) return;
    worker.kill();
    await worker.exited;
    this.#worker = undefined;
    this.#authority?.abort();
    this.#phase = "crashed";
  }

  async reopen(): Promise<void> {
    if (this.#phase !== "crashed") throw new Error("reopen_requires_crash");
    await this.#spawn();
    this.#phase = "reopened";
  }

  get ports(): HistoryNavigationSourcePorts {
    return {
      authorize: (): NavigationAccess => {
        const worker = this.#worker;
        if (!worker || this.#phase === "crashed" || this.#phase === "failed") throw new Error("navigation_unavailable");
        const generation = this.#projection.generation;
        const scope: NavigationScope = {
          browser: "navigation-fixture-browser", grant: "synthetic-navigation-grant",
          directory: this.options.project, epoch: "1", sourceId: this.#sourceId,
          instanceId: this.#instanceId, nativeSessionId: this.#nativeSessionId,
          sessionId: this.#sessionId, workerId: this.#workerId, workerGeneration: this.#authorityGeneration(),
          contextId: this.#contextId,
          projection: parseProjectionBinding({ source: this.#projection.source, generation: `generation-${generation}` }),
        };
        return {
          scope,
          client: this.#client!,
          authoritySignal: this.#authority!.signal,
          matchedCohort: "SYNTHETIC_NAVIGATION_FIXTURE",
          policy: { ...FIXTURE_POLICY },
        };
      },
      idle: (scope): StopSnapshot => ({
        generation: String(this.#starts), workerGeneration: scope.workerGeneration,
        scope: { kind: "session", sessionId: this.#sessionId },
        status: "idle", nativeSettled: true, acceptingWork: true,
        pending: { interactions: 0, history: 0, queued: 0, other: 0 },
        failures: [], forceAvailable: true, restored: null, draftConflict: false,
      }),
      repository: {
        reserveUnknown: async (record, maxOperations) => {
          if (this.#metadata.size >= Math.min(maxOperations, FIXTURE_POLICY.maxOperations)) return false;
          this.#metadata.set(record.navigationId, { ...record });
          return true;
        },
        read: async navigationId => {
          const record = this.#metadata.get(navigationId);
          return record === undefined ? undefined : { ...record };
        },
        recordResult: async record => { this.#metadata.set(record.navigationId, { ...record }); },
      },
      projectionOwner: {
        invalidateAll: () => { /* the committed generation stays bound until rebuild commits the next one */ },
        rebuild: async (scope, navigationId) => {
          const tree = await this.#tree();
          if (tree.items.length === 0) throw new Error("navigation_projection_unavailable");
          const previousGeneration = this.#projection.generation;
          this.#projection = { source: this.#projection.source, generation: previousGeneration + 1 };
          return {
            navigationId, sessionId: scope.sessionId,
            previous: parseProjectionBinding({ source: this.#projection.source, generation: `generation-${previousGeneration}` }),
            current: parseProjectionBinding({ source: this.#projection.source, generation: `generation-${this.#projection.generation}` }),
            activeSnapshotId: randomUUID(), liveHandoff: `fixture-live-handoff-${randomUUID()}`,
            publishedTo: "all_holders", retiredWriters: "rejected",
          };
        },
      },
    };
  }

  #authorityGeneration(): string { return `worker-generation-${this.#starts}`; }

  async close(): Promise<void> {
    await this.#worker?.close();
    this.#worker = undefined;
    await writeFile(join(this.options.home, "navigation-fixture-closed"), "");
  }
}
