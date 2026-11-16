/** Actual DSH Client fixture plugin; controlled originals/Remote only, never a product Host store. */
import { createTabProvider } from './tab-provider.js';
window.__ModuleLoader__.load({ id: '@omp-webui/draft-fixture', factory: require => {
  const React = require('react');
  function Controls({ source, actions }) {
    const state = React.useSyncExternalStore(source.subscribe, source.getSnapshot);
    return React.createElement('section', { id: 'draft-fixture', 'aria-label': 'Public draft provider fixture',
      style: { position: 'fixed', top: 4, right: 4, width: 390, maxHeight: 390, overflow: 'auto', zIndex: 9999,
        background: 'white', color: 'black', border: '2px solid black', fontSize: 11, padding: 6 } },
      React.createElement('strong', null, 'PUBLIC DSH DRAFT FIXTURE — synthetic originals / Remote'),
      React.createElement('pre', { id: 'draft-state', style: { whiteSpace: 'pre-wrap' } }, JSON.stringify(state)),
      ...Object.entries(actions).map(([name, action]) => React.createElement('button', {
        key: name, 'data-draft': name, onClick: action, style: { margin: 2, border: '1px solid black' },
      }, name)));
  }
  return {
    inject: ['sessions', 'conversation', 'uiWorkspace', 'slots'],
    async apply(ctx) {
      let live = true;
      let snapshot = { ready: false, result: null, active: null, semantic: null };
      const listeners = new Set();
      const source = {
        getSnapshot: () => snapshot,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      };
      const publish = update => {
        if (!live) return;
        snapshot = { ...snapshot, ...update };
        for (const listener of listeners) listener();
      };
      let generation = 'fixture-projection-1';
      let prepareRelease;
      let delayPreparation = false;
      const tab = await createTabProvider({ hostContext: 'persistent-fixture-host-origin-data',
        sourceContext: 'native-fixture-source-a', generation: () => generation,
        prepare: async (_scope, refs, signal) => {
          if (delayPreparation) await new Promise(resolve => { prepareRelease = resolve; });
          return Promise.all(refs.map(async ref => {
            const response = await fetch(`/fixture/originals/${encodeURIComponent(ref.id)}`, { signal });
            if (response.status === 404) return { status: 'invalid', reason: 'Original missing or expired' };
            if (!response.ok) throw new Error('Fixture original fetch failed');
            return { status: 'ready', file: new File([await response.blob()], ref.name, { type: ref.mediaType }) };
          }));
        },
      });
      ctx.conversation.input.registerDraftProvider(ctx, tab.provider);
      const held = new Map();
      let binding;
      let stop;
      const input = ctx.conversation.input;
      const record = fn => async () => {
        publish({ result: { status: 'pending' } });
        try { const result = await fn(); publish({ result: result ?? { status: 'done' }, saved: tab.inspect() }); }
        catch (error) { publish({ result: { status: 'error', message: String(error) } }); }
      };
      async function open(id) {
        let ref = held.get(id);
        if (!ref) { ref = ctx.sessions.retain(id, { source: 'controllerOperation' }); held.set(id, ref); }
        await ref.ready;
        binding = ref.binding;
        stop?.();
        const draft = input.draft(binding);
        stop = draft.subscribe(() => publish({ semantic: draft.getSnapshot(), saved: tab.inspect() }));
        publish({ active: id, semantic: draft.getSnapshot() });
        ctx.uiWorkspace.openSession(id);
        return input.restoreDraft(binding);
      }
      const sample = () => ({ draft: {
        text: '/saved @a @a\n> quoted', command: { token: '/saved ' },
        references: [7, 10].map(offset => ({ source: 'reference', ref: 'repeated', label: 'a',
          clipboardText: '@a', offset, length: 2 })),
        quotes: [{ offset: 13, length: 8, text: 'quoted' }],
      }, originals: [
        { id: 'original-b', name: 'second.txt', mediaType: 'text/plain' },
        { id: 'original-a', name: 'first.txt', mediaType: 'text/plain' },
        { id: 'original-b', name: 'second.txt', mediaType: 'text/plain' },
      ] });
      const hydrate = record => input.hydrateDraft({ binding, scope: tab.provider.scope(binding),
        expectedRevision: input.draft(binding).getSnapshot().revision, record });
      const actions = {
        'open-a': record(() => open('fixture-existing')),
        'open-b': record(() => open('fixture-second')),
        sample: record(() => hydrate(sample())),
        missing: record(() => hydrate({ ...sample(), originals: [{ id: 'missing', name: 'lost.txt', mediaType: 'text/plain' }] })),
        clear: record(() => hydrate({ draft: { text: '', references: [] }, originals: [] })),
        restore: record(() => input.restoreDraft(binding)),
        delay: record(() => { delayPreparation = true; }),
        release: record(() => { delayPreparation = false; prepareRelease?.(); }),
        generation: record(() => { generation = 'fixture-projection-2'; }),
        duplicate: () => window.open(location.href, '_blank'),
      };
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'public-draft-fixture', inject: () => ({ source, actions }),
      }, Controls));
      ctx.effect(() => () => {
        live = false; stop?.(); prepareRelease?.(); tab.release();
        for (const ref of held.values()) ref.release();
        listeners.clear();
      }, 'draft fixture resources');
      publish({ ready: true, owner: tab.owner });
    },
  };
} });
