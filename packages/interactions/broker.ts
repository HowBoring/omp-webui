import { randomUUID } from "node:crypto";
import { z } from "zod";
import validPolicy from "../contracts/generated/interaction-policy.js";
import validRequest from "../contracts/generated/interaction-request.js";
import type { ExtensionUiRequest, InteractionPolicy, RespondUiParams,
  UIReplyResult } from "../contracts/generated/omp-wire.ts";
import { interactionReplySchema, pendingInteractionSchema, uiAnswerSchema,
  type PendingInteraction, type UIAnswer } from "../contracts/interactions.ts";
import { brokerScopeSchema, type BrokerScope, type BrokerResult,
  type BrokerSnapshot } from "../contracts/interaction-broker.ts";
import { nativeAnswer, validAnswer } from "./validation.ts";

export interface PageIdentity { readonly credentialId: string; readonly clientId: string; readonly peerId: string }
/** Created by authenticated Host admission; never decoded from browser arguments. */
export interface PageBinding extends PageIdentity { readonly pageGeneration: string; readonly brokerGeneration: string }
export interface BrokerNativePort {
  respondUi(params: RespondUiParams): Promise<UIReplyResult>;
  /** Requests Stop; acknowledgement does not establish native quiescence. */
  requestStop(reason: string): Promise<void>;
}
export interface BrokerClock {
  now(): number; wall(): number; schedule(delay: number, callback: () => void): () => void;
}
const clock: BrokerClock = { now: () => performance.now(), wall: () => Date.now(), schedule(delay, callback) {
  const timer = setTimeout(callback, delay); return () => clearTimeout(timer);
} };
const requestSchema = z.custom<ExtensionUiRequest>(value => validRequest(value));
type Interactive = Extract<ExtensionUiRequest, { method: "ask" | "select" | "input" | "editor" | "confirm" }>;
interface Pending { card: PendingInteraction; deadline: number; cancelTimer: () => void;
  state: "pending" | "settling"; deliveries: Map<string, string>; cancellation?: Promise<BrokerResult> }
type Outcome = BrokerSnapshot["outcomes"][number];
const interactive = new Set(["ask", "select", "input", "editor", "confirm"]);
/** Cancellation is unresolved; only the Broker's live public-evidence ledger may clear this failure. */
export class InteractionCancellationUnknownError extends Error {
  readonly code = "INTERACTION_CANCELLATION_UNKNOWN";
}

/** One in-memory worker incarnation. Disconnect removes page rights, never stops admitted execution. */
export class InteractionBroker {
  readonly generation = randomUUID();
  readonly scope: BrokerScope;
  #pages = new Map<string, PageBinding>();
  #pending = new Map<string, Pending>();
  #seen = new Set<string>();
  #unresolved = new Set<string>();
  #uncertain = new Set<string>();
  #overflow = false;
  #outcomes: Outcome[] = [];
  #policy = false;
  #accepting = true;
  #closed = false;
  #stopRequested = false;
  #revoked = false;
  #inFlight = 0;
  #wait = 30 * 60 * 1000;
  constructor(scope: BrokerScope, readonly workerGeneration: string, readonly agentScope: string,
    readonly native: BrokerNativePort, readonly authorized: (page: PageIdentity, scope: BrokerScope) => boolean,
    readonly time: BrokerClock = clock) {
    this.scope = Object.freeze(brokerScopeSchema.parse(scope));
    z.string().min(1).max(128).parse(workerGeneration); z.string().min(1).max(128).parse(agentScope);
  }
  configureWait(waitMs: number): void {
    if (!Number.isFinite(waitMs) || waitMs <= 0 || waitMs > 86_400_000) throw new Error("INVALID_INTERACTION_WAIT");
    this.#wait = waitMs; // Existing records retain their absolute deadline.
  }
  attach(identity: PageIdentity): PageBinding {
    for (const value of Object.values(identity)) z.string().min(1).max(128).parse(value);
    if (!this.#accepting || !this.authorized(identity, this.scope)) throw new Error("INTERACTION_ACCESS_DENIED");
    if (!this.#pages.has(identity.clientId) && this.#pages.size >= 64) throw new Error("INTERACTION_PAGE_LIMIT");
    const previous = this.#pages.get(identity.clientId); if (previous) this.disconnect(previous);
    const binding = Object.freeze({ ...identity, pageGeneration: randomUUID(), brokerGeneration: this.generation });
    this.#pages.set(identity.clientId, binding); return binding;
  }
  disconnect(page: PageBinding): void {
    if (this.#pages.get(page.clientId) === page) this.#pages.delete(page.clientId);
    for (const entry of this.#pending.values()) entry.deliveries.delete(page.pageGeneration);
  }
  revokeCredential(credentialId: string): void {
    for (const page of this.#pages.values()) if (page.credentialId === credentialId) this.disconnect(page);
  }
  pending(page: PageBinding): BrokerSnapshot {
    return this.#projectPending(page, id => { void this.#cancel(id, "expired"); });
  }
  /** Read pending UI without settling it, even when the expiry timer is late. */
  pendingSnapshot(page: PageBinding): BrokerSnapshot {
    return this.#projectPending(page);
  }
  #projectPending(page: PageBinding, onExpired?: (id: string) => void): BrokerSnapshot {
    const allowed = this.#current(page);
    const pending: BrokerSnapshot["pending"] = [];
    if (allowed && this.#accepting) for (const [id, entry] of this.#pending) {
      if (entry.state !== "pending") continue;
      if (this.time.now() >= entry.deadline) { onExpired?.(id); continue; }
      let deliveryId = entry.deliveries.get(page.pageGeneration);
      if (!deliveryId) { deliveryId = randomUUID(); entry.deliveries.set(page.pageGeneration, deliveryId); }
      pending.push({ deliveryId, card: structuredClone(entry.card) });
    }
    return { generation: this.generation, workerGeneration: this.workerGeneration, agentScope: this.agentScope,
      scope: this.scope, policyVerified: this.#policy, accepting: allowed && this.#accepting, pending,
      outcomes: allowed ? structuredClone(this.#outcomes) : [] };
  }
  async answer(page: PageBinding, generation: string, id: string, deliveryId: string,
    input: UIAnswer): Promise<BrokerResult> {
    if (!this.#accepting || !this.#current(page)) return { status: "stale" };
    const entry = this.#pending.get(id);
    if (generation !== this.generation || !entry || entry.state !== "pending" ||
      entry.deliveries.get(page.pageGeneration) !== deliveryId) return { status: "stale" };
    if (this.time.now() >= entry.deadline) return this.#viewResult(page, this.#cancel(id, "expired"));
    const parsed = uiAnswerSchema.safeParse(input);
    if (!parsed.success || !validAnswer(entry.card, parsed.data)) return { status: "invalid" };
    if (parsed.data.type === "cancel") return this.#viewResult(page, this.#cancel(id, "explicit-cancel"));
    return this.#viewResult(page, this.#settle(id, entry, parsed.data, "explicit-answer"));
  }
  receive(frame: unknown): void {
    if (this.#closed) return;
    const head = z.object({ type: z.string() }).safeParse(frame); if (!head.success) return;
    if (head.data.type === "ready") {
      const ready = z.object({ interactionPolicy: z.custom<InteractionPolicy>(value => validPolicy(value)) })
        .safeParse(frame);
      this.#policy = ready.success; return;
    }
    if (head.data.type !== "extension_ui_request") return; // host_tool_* and host_uri_* have different contracts.
    const parsed = requestSchema.safeParse(frame);
    if (!parsed.success) { this.#requestStop("invalid-ui-contract"); return; }
    const request = parsed.data;
    if (request.method === "cancel") {
      this.#retire(request.targetId, request.reason === "expired" ? "expired" : "cancelled",
        request.reason ?? "native-cancel");
      if (request.reason === "expired") this.#requestStop("native-expired"); return;
    }
    if (!interactive.has(request.method)) return;
    // The discriminated public schema is validated above; this narrows the presentation-only variants.
    if (request.method === "ask" || request.method === "select" || request.method === "confirm" ||
      request.method === "input" || request.method === "editor") this.#open(request);
  }
  async revokeScope(reason = "authority-revoked"): Promise<void> {
    this.#revoked = true; this.#accepting = false; this.#pages.clear();
    const cancellations = [...this.#pending.keys()].map(id => this.#cancel(id, reason));
    this.#requestStop(reason); await Promise.all(cancellations);
  }
  /** Ordinary Stop boundary: fences new/late answers without recursively invoking native.requestStop. */
  async beginStop(): Promise<void> {
    this.#accepting = false;
    await Promise.all([...this.#pending.keys()].map(id => this.#cancel(id, "worker-stopping")));
    if (this.cancellationUncertain) throw new InteractionCancellationUnknownError("UI cancellation remains unresolved");
  }
  /** Includes unresolved Native UI even after a failed cancellation removed its answer rights. */
  get pendingCount(): number { return this.#unresolved.size + this.#inFlight + Number(this.#overflow); }
  get cancellationUncertain(): boolean { return this.#overflow || this.#uncertain.size > 0; }
  /** Called only after the coordinator observes joint Native/Host quiescence. */
  resumeAfterStop(): void {
    if (this.#closed || this.#revoked || this.pendingCount) throw new Error("INTERACTION_NOT_QUIESCENT");
    this.#stopRequested = false; this.#accepting = true;
  }
  close(): void {
    this.#closed = true; this.#accepting = false; this.#pages.clear(); this.#policy = false;
    for (const id of this.#pending.keys()) this.#retire(id, "unknown", "worker-ended");
  }
  #current(page: PageBinding): boolean {
    return !this.#closed && this.#pages.get(page.clientId) === page && page.brokerGeneration === this.generation &&
      this.authorized(page, this.scope);
  }
  async #viewResult(page: PageBinding, reply: Promise<BrokerResult>): Promise<BrokerResult> {
    const result = await reply;
    // Revocation cannot roll back a consumed Native answer; it does fence result application in the old view.
    return this.#current(page) ? result : { status: "stale" };
  }
  #open(request: Interactive): void {
    if (this.#seen.has(request.id)) return;
    // Never evict unresolved evidence to admit more UI or produce a false zero busy count.
    if (this.#seen.size >= 4096) {
      this.#overflow = true; this.#requestStop("ui-tracking-overflow"); return;
    }
    this.#seen.add(request.id); this.#unresolved.add(request.id);
    if (!this.#accepting || !this.#policy || this.#pending.size >= 16) {
      void this.#settle(request.id, undefined, { type: "cancel" }, "ui-not-admitted");
      this.#requestStop("ui-not-admitted"); return;
    }
    const wait = Math.max(0, Math.min(this.#wait, request.timeout ?? this.#wait)), createdAt = this.time.wall();
    const questions = request.method === "ask" ? request.questions.map(question => ({
      id: question.id, question: question.question, options: question.options.map(option => ({ label: option.label })),
      ...(question.multi === undefined ? {} : { multi: question.multi }),
    })) : undefined;
    const parsed = pendingInteractionSchema.strip().safeParse({ ...request, questions, generation: this.generation,
      family: "extension-ui", scope: this.scope.kind === "session" ? this.scope : { kind: "startup" },
      title: "title" in request ? request.title : "Native ask", createdAt, deadline: createdAt + wait,
      reason: "explicit-answer-required" });
    if (!parsed.success) {
      void this.#settle(request.id, undefined, { type: "cancel" }, "ui-presentation-incompatible");
      this.#requestStop("ui-presentation-incompatible"); return;
    }
    const card = parsed.data;
    const entry: Pending = { card, deadline: this.time.now() + wait, cancelTimer: () => {},
      state: "pending", deliveries: new Map() };
    this.#pending.set(request.id, entry);
    entry.cancelTimer = this.time.schedule(wait, () => { void this.#cancel(request.id, "expired"); });
  }
  async #cancel(id: string, reason: string): Promise<BrokerResult> {
    const entry = this.#pending.get(id); if (!entry) return { status: "stale" };
    if (entry.cancellation) return entry.cancellation;
    const answer: UIAnswer = reason === "expired" ? { type: "cancel", timedOut: true } : { type: "cancel" };
    entry.cancellation = this.#settle(id, entry, answer, reason);
    if (reason === "expired") this.#requestStop(reason);
    return entry.cancellation;
  }
  async #settle(id: string, entry: Pending | undefined, answer: UIAnswer, reason: string): Promise<BrokerResult> {
    if (entry) entry.state = "settling";
    if (entry && answer.type === "cancel") { entry.deliveries.clear(); entry.cancelTimer(); }
    try {
      const result = interactionReplySchema.parse(await this.#respondUi({ targetId: id,
        answer: nativeAnswer(answer) }));
      if (result.status === "invalid") {
        if (answer.type === "cancel") {
          this.#retire(id, "unknown", "native-cancel-incompatible"); this.#requestStop("native-cancel-incompatible");
          return { status: "unknown" };
        }
        if (!entry || this.#closed || this.#pending.get(id) !== entry) return result;
        if (!entry.cancellation && this.time.now() >= entry.deadline) void this.#cancel(id, "expired");
        else if (!entry.cancellation && this.#accepting) { entry.state = "pending"; entry.deliveries.clear(); }
      } else this.#retire(id, result.status, reason);
      if (result.status === "expired") this.#requestStop("native-expired");
      return result;
    } catch {
      this.#retire(id, "unknown", "native-reply-lost"); this.#requestStop("native-reply-lost");
      return { status: "unknown" };
    }
  }
  #retire(id: string, status: string, reason: string): void {
    if (!this.#unresolved.has(id)) return;
    const entry = this.#pending.get(id);
    entry?.cancelTimer(); this.#pending.delete(id);
    if (status === "unknown") this.#uncertain.add(id);
    else { this.#unresolved.delete(id); this.#uncertain.delete(id); }
    this.#outcomes.push({ id, status, reason, stop: "none" });
    if (this.#outcomes.length > 64) this.#outcomes.shift();
  }
  async #respondUi(params: RespondUiParams): Promise<UIReplyResult> {
    this.#inFlight++;
    try { return await this.native.respondUi(params); } finally { this.#inFlight--; }
  }
  #requestStop(reason: string): void {
    if (this.#closed || this.#stopRequested) return;
    this.#stopRequested = true; this.#accepting = false;
    for (const id of this.#pending.keys()) void this.#cancel(id, "worker-stopping");
    const outcome: Outcome = { id: "worker-stop", status: "stopping", reason, stop: "requested" };
    this.#outcomes.push(outcome); if (this.#outcomes.length > 64) this.#outcomes.shift();
    try {
      void this.native.requestStop(reason).then(() => { outcome.stop = "acknowledged"; },
        () => { outcome.stop = "failed"; });
    } catch { outcome.stop = "failed"; }
  }
}
