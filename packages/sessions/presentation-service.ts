import { Remote, TypertRemoteService, RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import type { SessionFollowRequest, SessionPageRequest, SessionControlFrame, SessionFollowFrame,
  SessionListRequest, SessionProjectionsRequest } from "@deepseek-ai/dsh-api-session-controller/types";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import type { BrowserAccess } from "../access/index.ts";
import type { SessionSupervisor } from "./supervisor.ts";
import { sessionCaller } from "./service.ts";
export class SessionPresentationService extends TypertRemoteService {
  constructor(ctx: Context, readonly supervisor: SessionSupervisor) { super(ctx, "sessionController", { namespace: "session" }); }
  private identity(): BrowserAccess { const identity = sessionCaller.getStore(); if (!identity) throw new Error("SESSION_AUTH_REQUIRED"); return identity; }
  private addressId(address: SessionFollowRequest["address"]): string {
    if (address.kind !== "session") throw new Error("SESSION_ADDRESS_DENIED"); return address.sessionId;
  }
  @Remote("list") async list(_request: SessionListRequest) {
    const current = await this.supervisor.listed(this.identity());
    return { items: current ? [{ sessionId: SessionId(current.view.registration.nativeSessionId),
      updatedAt: Date.parse(current.view.registration.observedAt), agentAvailable: true, running: current.running,
      blank: current.blank, formatStatus: "current" as const }] : [] };
  }
  @Remote("projections") async projections(request: SessionProjectionsRequest) {
    const journal = await this.supervisor.presentation(this.identity(), request.sessionId);
    return { kind: "sequenced" as const, projection: journal.projection, asOfSeq: journal.cursor, values: {} };
  }
  @Remote("page") async page(request: SessionPageRequest) {
    const journal = await this.supervisor.presentation(this.identity(), this.addressId(request.address));
    return { cursor: request.throughSeq ?? journal.cursor, ...journal.page(request) };
  }
  @Remote({ mode: "stream" }) async *control(signal: AbortSignal): AsyncGenerator<SessionControlFrame> {
    yield { type: "baseline", value: { projections: {} } };
    while (!signal.aborted) await Bun.sleep(100);
  }
  @Remote({ mode: "stream" }) async *follow(request: SessionFollowRequest, signal: AbortSignal): AsyncGenerator<SessionFollowFrame> {
    const identity = this.identity(), id = this.addressId(request.address), journal = await this.supervisor.presentation(identity, id);
    const queue: SessionFollowFrame[] = []; let bytes = 0;
    const dispose = journal.subscribe(frame => {
      const size = Buffer.byteLength(JSON.stringify(frame));
      if (queue.length >= 256 || bytes + size > 1_048_576) journal.invalidate("live_follow_buffer_overflow");
      else { queue.push(frame); bytes += size; }
    });
    try {
      yield journal.snapshot();
      while (!signal.aborted) {
        this.supervisor.requirePresentation(identity, id, journal);
        if (journal.failure) throw new RemoteError("gateway/bad-request", "Session history changed; manually reopen the full view.", {});
        while (queue.length) { this.supervisor.requirePresentation(identity, id, journal); const frame = queue.shift()!;
          bytes -= Buffer.byteLength(JSON.stringify(frame)); yield frame; }
        await this.supervisor.pollPresentation(identity, id, journal); await Bun.sleep(100);
      }
    } finally { dispose(); }
  }
}
