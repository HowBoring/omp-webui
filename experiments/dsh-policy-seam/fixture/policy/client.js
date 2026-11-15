/** Fixture embedding, using only public Cordis services and navigation events. */
window.__ModuleLoader__.load({ id: '@omp-webui/probe-policy', factory: () => ({
  apply(ctx) {
    const intents = [];
    const listeners = new Set();
    let snapshot = { intents: [], error: null };
    const publish = (error = null) => {
      snapshot = { intents: intents.map(({ kind, signal }) => ({ kind, aborted: signal.aborted })), error };
      for (const listener of listeners) listener();
    };
    const tasks = new Set();
    ctx.provide('probeNavigation', {
      getSnapshot: () => snapshot,
      subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    });
    ctx.provide('workspaceNavigation', { request(request) {
      intents.push(request);
      publish();
      request.signal.addEventListener('abort', () => publish(), { once: true });
      // Discovery/selection/restoration never authorize, register or create.
      if (request.kind !== 'new') return;
      const task = (async () => {
        if (request.signal.aborted) return;
        const id = await ctx.get('sessions').create({ workspaceId: request.workspaceId ?? 'fixture-ws' });
        if (request.signal.aborted) return;
        ctx.get('uiWorkspace').openSession(id);
      })().catch(error => publish(String(error))).finally(() => tasks.delete(task));
      tasks.add(task);
    } });
    ctx.effect(() => async () => { await Promise.allSettled(tasks); listeners.clear(); }, 'probe policy lifetime');
  },
}) });
