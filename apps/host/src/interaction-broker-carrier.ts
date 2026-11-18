import type { Context } from "@deepseek-ai/cordis";
import { isRemoteEventClientId } from "@deepseek-ai/dsh-api-gateway/stream-protocol";
import { clientRequestSchema, type Peer } from "@deepseek-ai/dsh-client-connection";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import type { BrowserAccess, BrowserAuthority } from "../../../packages/access/index.ts";
import { brokerContribution, brokerHostContribution } from "../../../packages/contracts/interaction-broker.ts";
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

interface ReadyPage {
  readonly identity: BrowserAccess;
  readonly peer: Peer;
  readonly binding: PageBinding;
  readonly lifetime: AbortSignal;
}

/** Isolated fixture only. Each independently issued credential is used by one Browser View. */
export class InteractionBrokerCarrier {
  readonly #pages = new Map<string, ReadyPage>();
  #revocation?: Promise<void>;

  constructor(private readonly ctx: Context, private readonly authority: BrowserAuthority,
    private readonly broker: InteractionBroker) {
    ctx.typert.register(brokerHostContribution);
    new InteractionBrokerService(ctx, broker);
  }

  handles(path: string): boolean { return endpoints.has(path); }

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
    if (this.#revocation) return;
    if (typeof value !== "object" || value === null || !("type" in value) || value.type !== "ready" ||
      !("clientId" in value) || !isRemoteEventClientId(value.clientId)) {
      throw new Error("DSH event readiness required");
    }
    const lifetime = AbortSignal.any([stream, peer.signal]);
    const { credentialId } = identity;
    if (lifetime.aborted || !this.authority.revalidate(identity) || this.#pages.has(credentialId)) {
      throw new Error("Interaction page unavailable");
    }
    const binding = this.broker.attach({ credentialId, clientId: value.clientId, peerId: peer.id });
    const page = { identity, peer, binding, lifetime };
    const detach = () => {
      if (this.#pages.get(credentialId) === page) this.#pages.delete(credentialId);
      this.broker.disconnect(binding);
    };
    if (lifetime.aborted) { detach(); throw new Error("Interaction page ended"); }
    this.#pages.set(credentialId, page);
    lifetime.addEventListener("abort", detach, { once: true });
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

  #current(page: ReadyPage, identity: BrowserAccess, signal: AbortSignal): boolean {
    try {
      return !this.#revocation && !signal.aborted && this.#pages.get(identity.credentialId) === page &&
        this.authority.revalidate(identity) && this.authority.revalidate(page.identity) &&
        this.broker.authorized(page.binding, this.broker.scope);
    } catch { return false; }
  }
}
