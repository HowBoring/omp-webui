/** Browser-only fixture provider. sessionStorage holds semantic records; Web Locks distinguish copied tabs. */
export async function createTabProvider({ hostContext, sourceContext, generation, prepare, identities }) {
  const storageName = 'omp.fixture.projection-drafts.v1';
  const persisted = JSON.parse(sessionStorage.getItem(storageName) ?? '{"records":{}}');
  let owner = persisted.owner ?? crypto.randomUUID();
  let release;
  let acceptOwner;
  const acquired = new Promise(resolve => { acceptOwner = resolve; });
  const lifetime = new Promise(resolve => { release = resolve; });
  // sessionStorage is copied by window.open/duplicate-tab. A live owner's lock forces a new identity.
  async function lease(candidate) {
    await navigator.locks.request(`omp.fixture.draft-owner.${candidate}`, { ifAvailable: true }, async lock => {
      if (lock === null) { owner = crypto.randomUUID(); void lease(owner); return; }
      acceptOwner();
      await lifetime;
    });
  }
  void lease(owner);
  await acquired;
  persisted.owner = owner;
  sessionStorage.setItem(storageName, JSON.stringify(persisted));
  const save = () => sessionStorage.setItem(storageName, JSON.stringify(persisted));
  const key = binding => JSON.stringify([hostContext, sourceContext, binding.sessionId]);
  return {
    owner,
    release,
    provider: {
      scope: binding => ({ tabOwner: identities.DraftTabOwner(owner), hostContext: identities.DraftHostContext(hostContext),
        sourceContext: identities.DraftSourceContext(sourceContext), nativeSessionId: identities.DraftNativeSessionId(binding.sessionId),
        projectionGeneration: identities.DraftProjectionGeneration(generation()), storageKey: identities.DraftStorageKey(key(binding)) }),
      read: async scope => {
        const value = persisted.records[scope.storageKey]?.record;
        if (value === undefined) return undefined;
        const record = identities.parseSemanticDraftRecord(value);
        if (record === undefined) throw new Error('Invalid fixture persistence record');
        return record;
      },
      write(scope, record, reason, signal) {
        if (signal?.aborted) throw new Error('Fixture publication cancelled');
        const prior = persisted.records[scope.storageKey];
        persisted.records[scope.storageKey] = { record,
          editedAt: reason === 'edit' ? Date.now() : prior?.editedAt ?? null };
        save();
      },
      beforeDispatch(scope, context, signal) {
        if (signal.aborted) throw new Error('Fixture dispatch correlation cancelled');
        persisted.dispatches ??= {};
        persisted.dispatches[context.submissionId] = { storageKey: scope.storageKey, requestId: context.requestId };
        save();
      },
      prepare,
    },
    inspect: () => structuredClone(persisted),
  };
}
