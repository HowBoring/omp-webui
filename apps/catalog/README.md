# Isolated native catalog acceptance page (#31)

This executable displays **synthetic native data only** through the pinned DSH Connection, Typert Registry,
ClientRemote, Gateway, Peer and `$events` mux. The Host calls the additive public OMP readonly catalog over stdio.
The product/default Host and diagnostic service remain separate; this page grants no private Session admission.
Source configuration is fixed locally before startup; no browser parameter selects a profile, source path, executable
or argv. Discovery never registers/opens a Session. The page shows the selected native profile and actual sources,
recorded/canonical cwd or its honest unknown/missing status, partial source failures, stable pages, native/copy
identity and timestamped held/free/unknown observations. Description rechecks native identity and ownership.

From the repository root, with the exact tools in `compatibility/README.md` on PATH:

```sh
bun run compat:prepare --reset
bun run compat:build
bun scripts/build-compatibility.ts --check
bun scripts/check-catalog-native.ts
bun run diagnostics:build
bun run catalog:fixture-data
bun run catalog:build
bun run diagnostics:enroll --catalog-fixture
bun run catalog:fixture
# In another terminal, after the Host prints its listening address:
python3 tests/browser/catalog-browser.py
```

`catalog:fixture-data` is an explicit **test fixture authoring** tool, not a Host service. It replaces only the owned
ignored `vendor/catalog-fixture` with 1000 native Sessions in 1000 buckets, a custom same-ID copy and unknown-cwd
Session, verified aliases, malformed metadata and an invalid custom source. Never point this fixture at real data.
The acceptance Host is fixed at `http://127.0.0.1:3181`; the synthetic HOME/source paths are fixed in its local entry.
The source-mode native child receives only this isolated HOME/cwd/TMPDIR and explicit source configuration, with
Bun transpiler caching disabled. The ordinary preflight uses its own empty synthetic HOME and never reads Sessions.

DSH source/build reuse in this environment: `vendor/dsh` is a read-only symlink to ticket 30's complete, clean pinned
`vendor/dsh-clean`, already proven by ticket 30's eight artifact gates. No DSH source or shared artifact is modified.
The fixture independently compiles its 238 browser source inputs into its own ignored `vendor/dsh-catalog`, checks
DSH base/clean tracked source and records every consumed input/asset identity. A fresh environment may prepare its
own pinned DSH clone with the existing `dsh:prepare` / `dsh:link` commands instead. OMP source is a distinct owned
ignored clone; local frozen runtime dependencies were copied transparently from ticket 30 then revalidated/reused.
No global installation is changed, no provider/model/tool is configured or invoked, and no real profile/history is read.

The enrollment includes this acceptance Host/client and the complete native source/dependency closure. Stop the
fixture before rebuilding or changing its enrolled tuple. Browser calls use genuine DSH envelopes and typed results;
there is no parallel REST Session protocol. Native errors become bounded typed fixture outcomes, including stale/
expired/scope cursors. Wrong correlation is tested as a separately labelled intercepted carrier fault. This isolated
anonymous loopback fixture is not the product's authorization implementation.

See [native contract and budgets](../../compatibility/CATALOG.md) and
[Linux evidence](../../docs/evidence/ticket-31-catalog.md). Raw bundles, syscall logs, screenshots and installation
manifests stay ignored under vendor; summaries and exact hashes are tracked. Windows Chrome/WSL2 was explicitly
deferred by the owner, so no Windows PASS is claimed. Formal complete-product/native-write/performance acceptance
remains in later tickets; this page proves the readonly slice only.
