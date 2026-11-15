# ADR 0003: Separate native discovery, registration and execution

- Status: Accepted product choices; public RPC extensions and implementation pending
- Date: 2026-11-15
- Decision: [原生会话目录契约：发现范围、导入、索引与占用状态](https://github.com/HowBoring/omp-webui/issues/17)

The MVP discovers native Sessions from one OMP configuration/profile selected at Host startup,
including its default Session directory and custom Session directories explicitly authorized in
Host configuration. Cross-profile aggregation is deferred. OMP resolves and reads these sources;
the Host does not reproduce directory resolution or scan native storage.

Discovery shows candidates without registering or opening them. First open automatically registers
the native reference, then attempts continuation; a failed continuation retains the registration and
its reason. This removes a separate import step while preserving a durable list of chosen Sessions.
It must never turn a stale reference into a new native conversation.

While another process owns a Session, the MVP shows catalog metadata and the ownership observation.
History and tree browsing wait until that owner exits. Read-only browsing of an externally owned
Session would require another public RPC contract and is deferred, together with live takeover.

These choices limit discovery to configured sources and require fewer first-open actions. They leave
cross-profile navigation and live historical inspection outside this MVP. The [catalog contract](../session-catalog-contract.md)
records implementation targets and gates; it does not claim these missing capabilities exist in the
pinned OMP release. Detailed access controls remain a separate decision.
