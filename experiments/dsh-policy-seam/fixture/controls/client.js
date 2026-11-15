/** Isolated test controls. No DSH private instances, native OMP Session, or product RPC claims. */
window.__ModuleLoader__.load({ id: '@omp-webui/probe-controls', factory: (require) => {
  const React = require('react');
  function Controls({ subscribe, getSnapshot, actions }) {
    const state = React.useSyncExternalStore(subscribe, getSnapshot);
    return React.createElement('section', { id: 'policy-probe', 'aria-label': 'Isolated policy fixture',
      style: { position: 'fixed', right: 8, top: 8, width: 300, background: '#fff', color: '#111',
        border: '2px solid #555', padding: 8, zIndex: 9000, fontSize: 12 } },
      React.createElement('strong', null, 'Isolated policy fixture'),
      React.createElement('pre', { id: 'probe-state', style: { whiteSpace: 'pre-wrap' } }, JSON.stringify(state)),
      ...Object.entries(actions).map(([name, action]) => React.createElement('button', {
        key: name, 'data-probe': name, onClick: action, style: { margin: 3, border: '1px solid #555', padding: 3 },
      }, name)));
  }
  return {
    inject: ['sessions', 'uiWorkspace', 'slots', 'remote', 'connection', 'probeNavigation', 'shortcuts'],
    apply(ctx) {
      let snapshot = { startup: null, result: null, generation: null, navigation: ctx.probeNavigation.getSnapshot() };
      let lastPending;
      let live = true;
      const listeners = new Set();
      const publish = (change) => {
        if (!live) return;
        snapshot = { ...snapshot, ...change };
        for (const listener of listeners) listener();
      };
      const catalog = () => {
        const list = ctx.sessions.list.getSnapshot();
        return { phase: list.phase, ids: list.ids, retained: Object.values(list.byId).reduce((n, row) => n + (row.retainedBy.mainView ?? 0), 0) };
      };
      publish({ catalog: catalog() });
      ctx.effect(() => ctx.sessions.list.subscribe(() => publish({ catalog: catalog() })), 'probe catalog');
      const call = (endpoint, payload = {}) => ctx.connection.rpc.call('/api', endpoint, payload);
      const accept = (state, generation) => {
        if (!live || ctx.connection.generation.getSnapshot()?.id !== generation) return;
        if (snapshot.startup && state.revision <= snapshot.startup.revision) return;
        if (state.pending) lastPending = state.pending;
        publish({ startup: state });
      };
      ctx.effect(() => ctx.remote.$on('probe/startup', state => {
        const generation = ctx.connection.generation.getSnapshot()?.id;
        if (generation !== undefined) accept(state, generation);
      }), 'probe startup notifications');
      const refresh = () => {
        const generation = ctx.connection.generation.getSnapshot()?.id;
        publish({ generation: generation ?? null, ...(generation === undefined ? { startup: null } : {}) });
        if (generation === undefined) return;
        void call('probe/startup/read').then(result => {
          if (result.ok) accept(result.value, generation);
        });
      };
      ctx.effect(() => ctx.connection.generation.subscribe(refresh), 'probe generation');
      refresh();
      ctx.effect(() => ctx.probeNavigation.subscribe(() => publish({ navigation: ctx.probeNavigation.getSnapshot() })), 'probe navigation');
      const record = operation => async () => {
        publish({ result: { pending: true } });
        try { publish({ result: await operation() }); } catch (error) { publish({ result: String(error) }); }
      };
      const actions = {
        bind: record(async () => {
          const bindings = { 'session.rename': ['KeyG', ['primary', 'alt']],
            'session.fork': ['KeyF', ['primary', 'shift']], 'session.archive': ['KeyA', ['primary', 'alt']] };
          for (const [id, [code, modifiers]] of Object.entries(bindings)) {
            const result = await ctx.shortcuts.edit({ type: 'set', id, binding: { code, modifiers } }, ctx.shortcuts.config.getSnapshot().revision);
            if (result.status !== 'saved') throw new Error(`Fixture key binding failed: ${result.status}`);
          }
          return { ok: true, value: { runtime: ctx.shortcuts.runtime, platform: ctx.shortcuts.platform,
            catalog: ctx.shortcuts.catalog.getSnapshot().filter(row => Object.hasOwn(bindings, row.id)) } };
        }),
        discover: record(() => call('probe/discover')),
        authorize: record(() => call('probe/authorize', { root: '/fixture/project' })),
        register: record(() => call('probe/register', { reference: 'fixture-existing' })),
        select: record(() => ctx.uiWorkspace.openWorkspace('fixture-ws')),
        open: record(async () => {
          const result = await call('probe/open', { reference: 'fixture-existing' });
          if (result.ok) ctx.uiWorkspace.openSession(result.value.sessionId);
          return result;
        }),
        new: record(() => ctx.uiWorkspace.startSession('fixture-ws')),
        busy: record(() => call('probe/busy', { running: true })),
        idle: record(() => call('probe/busy', { running: false })),
        queue: record(() => ctx.sessions.using('fixture-existing', { source: 'controllerOperation' },
          ref => ref.binding.session.prompt([{ type: 'text', text: 'fixture queue' }], 'queue'))),
        steer: record(() => ctx.sessions.using('fixture-existing', { source: 'controllerOperation' },
          ref => ref.binding.session.prompt([{ type: 'text', text: 'fixture steer' }], 'steer'))),
        stop: record(() => ctx.sessions.using('fixture-existing', { source: 'controllerOperation' },
          ref => ref.binding.session.cancel())),
        answer: record(() => call('probe/startup/answer', { pending: snapshot.startup?.pending, answer: 'yes' })),
        stale: record(() => call('probe/startup/answer', { pending: lastPending, answer: 'old' })),
      };
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'omp-policy-probe', inject: () => ({
          subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
          getSnapshot: () => snapshot, actions,
        }),
      }, Controls));
      ctx.effect(() => () => { live = false; listeners.clear(); }, 'probe controls lifetime');
    },
  };
} });
