/** Public external-navigation provider: this client-only fixture never creates Sessions. */
window.__ModuleLoader__.load({ id: '@omp-webui/projection-navigation', factory: () => ({
  apply(ctx) { ctx.provide('workspaceNavigation', { request() {} }); },
}) });
