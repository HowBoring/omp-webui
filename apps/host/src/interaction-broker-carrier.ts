import type { Context } from "@deepseek-ai/cordis";
import { isRemoteEventClientId, type RemoteEventClientId } from "@deepseek-ai/dsh-api-gateway/stream-protocol";
import { clientRequestSchema, type Peer } from "@deepseek-ai/dsh-client-connection";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import type { BrowserAccess, BrowserAuthority } from "../../../packages/access/index.ts";
import {
  brokerAnswerStreamEndpoint, brokerAnswerStreamHostContribution, brokerContribution, brokerHostContribution,
  brokerPendingSnapshotEndpoint, brokerSnapshotHostContribution, brokerWriteProofSchema,
} from "../../../packages/contracts/interaction-broker.ts";
import type { InteractionBroker, PageBinding } from "../../../packages/interactions/broker.ts";
import { InteractionBrokerService, interactionCaller } from "../../../packages/interactions/service.ts";
import { readBoundedRequestBody, RequestBodyError } from "./request-body.ts";

const maxBodyBytes = 16_384;
const endpoints = new Set(Object.keys(brokerContribution.methods).map(name => "/api/" + name));
const noStore = { "cache-control": "no-store" };
const refused = (message: string, status: number) => new Response(message, { status, headers: noStore });
const invalidated = () => refused("Interaction access invalidated", 401);
const invalidRequest = () => refused("Invalid Interaction request", 400);
const argsRecord = z.record(z.string(), z.unknown());
const payloadSchema = z.strictObject({ args: argsRecord });
const readyFrame = z.strictObject({
  type: z.literal("ready"),
  clientId: z.custom<RemoteEventClientId>(isRemoteEventClientId),
  host: z.strictObject({ home: z.string() }),
});

interface ReadyPage {
  readonly identity: BrowserAccess;
  readonly peer: Peer;
  readonly binding: PageBinding;
  readonly lifetime: AbortSignal;
}

export type InteractionBrokerMode = "shared-cookie-snapshot" | "shared-cookie-answer";
export type BrokerStream = "snapshot" | "answer";

/** Isolated fixture admission for credential-keyed unary or Peer-bound Broker streams. */
export class InteractionBrokerCarrier {
  readonly #pages = new Map<string, ReadyPage>();
  #revocation?: Promise<void>;

  constructor(private readonly ctx: Context, private readonly authority: BrowserAuthority,
    private readonly broker: InteractionBroker, readonly mode?: InteractionBrokerMode) {
    ctx.typert.register(mode === "shared-cookie-answer" ? brokerAnswerStreamHostContribution
      : mode === "shared-cookie-snapshot" ? brokerSnapshotHostContribution : brokerHostContribution);
    new InteractionBrokerService(ctx, broker);
  }

  handles(path: string): boolean { return !this.mode && endpoints.has(path); }

  streamKind(endpoint: string): BrokerStream | undefined {
    if (this.mode && endpoint === brokerPendingSnapshotEndpoint) return "snapshot";
    if (this.mode === "shared-cookie-answer" && endpoint === brokerAnswerStreamEndpoint) return "answer";
  }

  /** Fence synchronously, then join the same cancellation until it completes. */
  revokeAll(): Promise<void> {
    if (this.#revocation) return this.#revocation;
    const pending = Promise.withResolvers<void>();
    this.#revocation = pending.promise;
    pending.resolve(this.broker.revokeScope("all-browser-access-revoked"));
    return pending.promise;
  }

  /** The first item from the Host Gateway's actual $events stream. */
  ready(value: unknown, peer: Peer, identity: BrowserAccess, stream: AbortSignal): void {
    if (this.#revocation) {
      if (this.mode) throw new Error("Interaction page unavailable");
      return;
    }
    const { clientId } = readyFrame.parse(value);
    const lifetime = AbortSignal.any([stream, peer.signal]);
    const key = this.mode ? peer.id : identity.credentialId;
    if (lifetime.aborted || !this.authority.revalidate(identity) || this.#pages.has(key)) {
      throw new Error("Interaction page unavailable");
    }
    const binding = this.broker.attach({ credentialId: identity.credentialId, clientId, peerId: peer.id });
    const page = { identity, peer, binding, lifetime };
    const detach = () => {
      if (this.#pages.get(key) === page) this.#pages.delete(key);
      this.broker.disconnect(binding);
    };
    if (lifetime.aborted) { detach(); throw new Error("Interaction page ended"); }
    this.#pages.set(key, page);
    lifetime.addEventListener("abort", detach, { once: true });
  }

  async runStream(kind: BrokerStream, payload: unknown, peer: Peer, identity: BrowserAccess,
    signal: AbortSignal, run: (current: () => boolean, lifetime: AbortSignal) => Promise<void>): Promise<void> {
    const page = this.#pages.get(peer.id);
    if (!this.mode || page?.peer !== peer || page.identity !== identity) {
      throw new Error("Interaction page unavailable");
    }
    const csrf = kind === "answer" ? brokerWriteProofSchema.parse(payloadSchema.parse(payload).args.csrf) : undefined;
    const lifetime = kind === "answer" ? AbortSignal.any([signal, page.lifetime]) : signal;
    const current = () => this.#current(page, identity, lifetime, csrf);
    if (!current()) throw new Error("Interaction page unavailable");
    await interactionCaller.run({ page: page.binding, current }, () => run(current, lifetime));
  }

  async dispatch(request: Request, identity: BrowserAccess): Promise<Response> {
    const page = this.#pages.get(identity.credentialId);
    if (!page) return invalidated();
    const signal = AbortSignal.any([request.signal, page.lifetime]);
    const current = () => this.#current(page, identity, signal);
    if (!current()) return invalidated();
    if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
      return refused("JSON required", 415);
    }
    let decoded;
    try {
      const body = await readBoundedRequestBody(request, signal, current, maxBodyBytes);
      const envelope = clientRequestSchema.parse(body);
      const method = brokerContribution.methods[envelope.method];
      if (!method || new URL(request.url).pathname !== "/api/" + envelope.method) {
        throw new Error("Interaction endpoint mismatch");
      }
      const payload = payloadSchema.parse(envelope.payload);
      const args = argsRecord.parse(method.input({ strict: true }).create().parse(payload.args));
      decoded = { rpcId: envelope.rpcId, method, args };
    } catch (error) {
      if (!current()) return invalidated();
      return error instanceof RequestBodyError ? refused(error.message, error.status) : invalidRequest();
    }
    if (!current()) return invalidated();
    return await this.#invoke(decoded, page, signal, current);
  }

  async #invoke({ rpcId, method, args }: {
    rpcId: string; method: (typeof brokerContribution.methods)[string]; args: Record<string, unknown>;
  }, page: ReadyPage, signal: AbortSignal, current: () => boolean): Promise<Response> {
    try {
      const value = await interactionCaller.run({ page: page.binding, current }, () => this.ctx.typertGateway.invoke({
        namespace: method.namespace, method: method.method, args, peer: page.peer, signal,
      }));
      if (!current()) return invalidated();
      return Response.json({ type: "server-response", rpcId, result: { ok: true, value } }, { headers: noStore });
    } catch {
      if (!current()) return invalidated();
      const failure = new RemoteError("gateway/internal", "Interaction request failed.", {});
      const error = this.ctx.typertGateway.wireStream.failure(failure);
      return Response.json({ type: "server-response", rpcId, result: { ok: false, error } }, { headers: noStore });
    }
  }

  #current(page: ReadyPage, identity: BrowserAccess, signal: AbortSignal, csrf?: string): boolean {
    try {
      const key = this.mode ? page.peer.id : identity.credentialId;
      return !this.#revocation && !signal.aborted && !page.lifetime.aborted && this.#pages.get(key) === page &&
        (csrf === undefined ? this.authority.revalidate(identity) : this.authority.revalidateWrite(identity, csrf)) &&
        (identity === page.identity || this.authority.revalidate(page.identity)) &&
        this.broker.authorized(page.binding, this.broker.scope);
    } catch { return false; }
  }
}
