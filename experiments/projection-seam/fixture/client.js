/** Public Client/provider/Remote fault controls over actual built DSH modules. */
import { interactionsContribution } from '../../../packages/contracts/interactions.ts';
import { createTabProvider } from './tab-provider.js';
window.__ModuleLoader__.load({ id: '@omp-webui/projection-fixture', factory: require => {
  const React = require('react');
  const identities = require('@deepseek-ai/dsh-client-ui-conversation');
  function Controls({ source, actions }) {
    const state = React.useSyncExternalStore(source.subscribe, source.getSnapshot);
    return React.createElement('section', { id: 'projection-fixture', style: {
      position: 'fixed', top: 4, right: 4, width: 450, maxHeight: 390, overflow: 'auto', zIndex: 9999,
      background: 'white', color: 'black', border: '2px solid black', fontSize: 10, padding: 6,
    } }, React.createElement('strong', null, 'PUBLIC PROJECTION FIXTURE — synthetic source and originals'),
    React.createElement('pre', { id: 'projection-state', style: { whiteSpace: 'pre-wrap' } }, JSON.stringify(state)),
    ...Object.entries(actions).map(([name, action]) => React.createElement('button', {
      key: name, 'data-projection': name, onClick: action, style: { margin: 2, border: '1px solid black' },
    }, name)));
  }
  return {
    inject: ['remote', 'sessions', 'conversation', 'uiWorkspace', 'uiSession', 'slots'],
    async apply(ctx) {
      const info = await (await fetch('/fixture/info')).json();
      let nativeRemote;
      if (info.native) {
        await ctx.remote.$mount(interactionsContribution);
        await new Promise(resolve => ctx.inject(['remote.ompInteractions'], remoteCtx => {
          nativeRemote = remoteCtx.remote.ompInteractions; resolve();
        }));
      }
      const listeners = new Set();
      let snapshot = { ready: false };
      let binding;
      let initialBinding;
      let initialScope;
      let live = true;
      let references = [];
      const prepareReleases = [];
      let holdPreparation = false;
      let lastNativeCard;
      const source = {
        getSnapshot: () => snapshot,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      };
      const publish = update => {
        if (!live) return;
        snapshot = { ...snapshot, ...update };
        for (const listener of listeners) listener();
      };
      const tab = await createTabProvider({ hostContext: 'persistent-projection-fixture',
        sourceContext: info.source, generation: () => 'stock-fallback', identities,
        prepare: async (_scope, refs, signal) => {
          if (holdPreparation) {
            publish({ preparationHeld: true });
            if (prepareReleases.length >= 16) throw new Error('Fixture preparation budget');
            await new Promise(resolve => { prepareReleases.push(resolve); });
          }
          return Promise.all(refs.map(async ref => {
            const response = await fetch(`/fixture/originals/${encodeURIComponent(ref.id)}`, { signal });
            if (!response.ok) return { status: 'invalid', reason: 'Synthetic original unavailable' };
            return { status: 'ready', file: new File([await response.blob()], ref.name, { type: ref.mediaType }) };
          }));
        },
      });
      const provider = tab.provider;
      const input = ctx.conversation.input;
      const withdraw = input.registerDraftProvider(ctx, provider);
      const update = () => {
        if (!binding) return;
        const projection = binding.projection.getSnapshot();
        const semantic = input.draft(binding).getSnapshot();
        const pending = ctx.uiSession.sessionStatus.getSnapshot().get(binding.sessionId)?.pendingInteraction;
        publish({ ready: true, id: binding.sessionId, projection: {
          phase: projection.phase, binding: projection.binding, aborted: projection.signal?.aborted,
          error: projection.error?.message,
        }, semantic, saved: tab.inspect(), bindingStable: binding === initialBinding,
        scopeStable: binding.ctx === initialScope, retains: ctx.sessions.retainInfo(binding.sessionId).getSnapshot(),
        pending: pending ? { key: pending.key, kind: pending.kind } : null,
        journal: binding.eventSource.getSnapshot().entries.map(entry => ({ type: entry.event.type, seq: entry.event.seq })),
        });
      };
      const operation = fn => async () => {
        publish({ result: { status: 'pending' } });
        try { publish({ result: await fn() ?? { status: 'done' } }); update(); }
        catch (error) { publish({ result: { status: 'error', message: String(error) } }); }
      };
      const fault = op => operation(async () => {
        const result = await fetch(`/fixture/action?op=${encodeURIComponent(op)}`);
        if (!result.ok) throw new Error('Fixture action failed');
        return result.json();
      });
      async function open() {
        await ctx.sessions.refresh();
        const reference = ctx.sessions.retain(info.sessionId, { source: 'controllerOperation' });
        references.push(reference);
        await reference.ready;
        binding = reference.binding;
        initialBinding ??= binding;
        initialScope ??= binding.ctx;
        const stops = [binding.projection.subscribe(update), binding.session.subscribe(update),
          binding.eventSource.subscribe(update), input.draft(binding).subscribe(update),
          ctx.sessions.retainInfo(binding.sessionId).subscribe(update), ctx.uiSession.sessionStatus.subscribe(update)];
        ctx.effect(() => () => { for (const stop of stops) stop(); });
        ctx.uiWorkspace.openSession(binding.sessionId);
        update();
      }
      const hydrate = record => {
        const current = input.draft(binding).getSnapshot();
        return input.hydrateDraft({ binding, scope: current.scope, expectedRevision: current.revision, record });
      };
      const sample = () => ({ draft: { text: 'Independent tab draft with ordered originals', references: [] }, originals: [
        { id: identities.DraftOriginalId('original-b'), name: 'second.txt', mediaType: 'text/plain' },
        { id: identities.DraftOriginalId('original-a'), name: 'first.txt', mediaType: 'text/plain' },
        { id: identities.DraftOriginalId('original-b'), name: 'second.txt', mediaType: 'text/plain' },
      ] });
      const actions = Object.fromEntries(['invalidate', 'rewritten', 'fail', 'unfail', 'hold-open', 'release-open',
        'hold-page', 'release-page', 'interaction', 'old-control', 'physical-restart', 'connection-ready', 'surface-replace']
        .map(op => [op, fault(op)]));
      Object.assign(actions, {
        retry: operation(() => ctx.sessions.retryProjection(binding.sessionId)),
        sample: operation(() => hydrate(sample())),
        'newer-edit': operation(() => input.for(binding.ctx).setDraft(`Newer edit in ${tab.owner}`)),
        'load-older': operation(() => binding.session.loadOlder({ deferConsumption: true })),
        'consume-older': operation(() => binding.session.consumeOlder()),
        retain: operation(async () => {
          const reference = ctx.sessions.retain(binding.sessionId, { source: 'controllerOperation' });
          references.push(reference); await reference.ready;
          return { sameBinding: reference.binding === binding };
        }),
        'release-extra': operation(() => { if (references.length > 1) references.pop().release(); }),
        'delay-prepare': operation(() => { holdPreparation = true; }),
        'release-prepare': operation(() => { holdPreparation = false; for (const release of prepareReleases.splice(0)) release(); publish({ preparationHeld: false }); }),
        'native-chosen': operation(async () => {
          const card = snapshot.nativeInteraction?.pending[0];
          if (!card) throw new Error('No pending native Interaction');
          lastNativeCard = card;
          const result = await nativeRemote.answer(card.generation, card.id, {type: 'value', value: card.method === 'select' ? 'chosen' : 'explicit native reason'});
          if (!result.ok) throw result.error;
          return result.value;
        }),
        'native-repeat': operation(async () => {
          if (!lastNativeCard) throw new Error('No prior native answer');
          const result = await nativeRemote.answer(lastNativeCard.generation, lastNativeCard.id, {type: 'value', value: 'duplicate'});
          if (!result.ok) throw result.error; return result.value;
        }),
        submit: operation(() => { input.for(binding.ctx).submit(); }),
      });
      ctx.slots.register({ name: 'shell.overlay', id: 'projection-fixture', order: 9999,
        inject: () => ({ source, actions }) }, Controls);
      ctx.effect(() => () => { live = false; withdraw(); tab.release(); for (const release of prepareReleases.splice(0)) release();
        for (const reference of references) reference.release(); references = []; });
      await open();
      if (info.native) {
        let querying = false;
        const timer = setInterval(async () => {
          if (!live || querying) return; querying = true;
          try { const result = await nativeRemote.snapshot(); if (result.ok) publish({ nativeInteraction: result.value }); }
          finally { querying = false; }
        }, 50);
        ctx.effect(() => () => clearInterval(timer));
      }
    },
  };
} });
