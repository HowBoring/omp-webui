/** Browser-only fixture provider. sessionStorage holds semantic records; Web Locks distinguish copied tabs. */
export async function createTabProvider({ hostContext, sourceContext, generation, prepare }) {
  const storageName = 'omp.fixture.semantic-drafts.v1';
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
      scope: binding => ({ tabOwner: owner, hostContext, sourceContext, nativeSessionId: binding.sessionId,
        projectionGeneration: generation(), storageKey: key(binding) }),
      read: async scope => persisted.records[scope.storageKey]?.record,
      write(scope, record, reason) {
        const prior = persisted.records[scope.storageKey];
        persisted.records[scope.storageKey] = { record,
          editedAt: reason === 'edit' ? Date.now() : prior?.editedAt ?? null };
        save();
      },
      prepare,
    },
    inspect: () => structuredClone(persisted),
  };
}
