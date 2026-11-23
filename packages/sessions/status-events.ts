import type { TypertRemoteEventDispatch, TypertRemoteEventSource } from "@deepseek-ai/dsh-api-gateway";

/** The only running state a stock Session view can act on, scoped to the active Native Session. */
export interface SessionRunning {
  readonly sessionId: string;
  readonly running: boolean;
}

export type SessionStatusSubscription =
  (listener: (status: SessionRunning | undefined) => void) => () => void;

/**
 * Forward Host-observed Native running transitions as the stock `api-session/status` event.
 * The event shape is the stock wire shape; identity and generation stay inside the Host.
 */
export function sessionStatusEvents(subscribe: SessionStatusSubscription): TypertRemoteEventSource {
  return async function* statusEvents(signal: AbortSignal): AsyncGenerator<TypertRemoteEventDispatch> {
    const queue: TypertRemoteEventDispatch[] = [];
    let wake: (() => void) | undefined;
    let closed = false;
    const signalWake = (): void => { const resume = wake; wake = undefined; resume?.(); };
    let unsubscribe = (): void => {};
    const stop = (): void => { if (closed) return; closed = true; unsubscribe(); signalWake(); };
    unsubscribe = subscribe(status => {
      if (closed || status === undefined) return;
      queue.push({ event: "api-session/status", args: [status.sessionId, status.running] });
      signalWake();
    });
    if (signal.aborted) { stop(); return; }
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) { stop(); return; }
    try {
      while (!closed && !signal.aborted) {
        const next = queue.shift();
        if (next !== undefined) yield next;
        else {
          const waiting = Promise.withResolvers<void>();
          wake = waiting.resolve;
          await waiting.promise;
        }
      }
    } finally {
      signal.removeEventListener("abort", stop);
      stop();
    }
  };
}
