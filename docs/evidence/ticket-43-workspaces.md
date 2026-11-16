# Ticket #43 — isolated authenticated directory/Workspace component

Current component evidence is on integration `2842168abe27d733c353c6fe14153f0e660f1d8a`, including accepted
#33/#34 native changes and #39/#42/#31/#30. #43 remains **unmerged/unclosed pending #41**. Protected open,
real registration/index persistence and Session worker revocation remain #44 composition work. The default Host
continues to deny private Session capabilities.

This narrow follow-up preserves every grant/catalog feature. The Workspace builder now consumes shared
`BuildIdentities`, `assetIdentities` and `sha256`, while independently verifying the actual resolved DSH source
root against the complete c0 candidate. Its 239 consumed browser inputs and client/index assets remain byte-identical.
The authenticated carrier remains local: `DshEventsCarrier` has no credential attachment/per-message revalidation
hooks, so reusing it directly would drop current authorization semantics. Unary whitelist, auth/CSRF, per-message
credential checks, eight-Peer/one-stream/16-KiB limits and generation rejection remain explicit and unchanged.

The owned native checkout was reset to the pinned base and rebuilt from declared patches 0001–0004 without
installing dependencies. It now reports source `8960c74b6c74dcadc585a0e68e2aba8687129107ddd449b85ae93d98f0d4c424`,
patch `bf08fb3c51d284169093a58164c161f4f8d5c0b24fad273db5b9817cea877a95` and schema
`8345aa426ee69f310e787d247df0dcee0902fbb13d8e1196348fae0d2b5aa25b`. Native catalog shape is unchanged;
this executable still launches only `--rpc-catalog` in its fixed synthetic HOME/source configuration. No history,
Interaction, provider, model or ordinary Session execution is admitted. DSH uses the immutable reviewed #39 c0
compiled closure and declarations; no upstream eight-artifact/two-aggregate rebuild or install was run.

## Current affected checks

- `bun scripts/prepare-compatibility.ts --reset --source-only`, `bun scripts/build-compatibility.ts`, and
  `bun scripts/build-compatibility.ts --check`: PASS, current declared source/schema/client identity.
- `bun run workspaces:build` and `bun run diagnostics:build`: PASS. Workspace has 239 browser inputs and Host 256;
  the actual resolved DSH candidate tree is `c0b09e15c170a82894608c397a363a7a96e5d05c`.
- `bun run typecheck`: PASS on the current integration.
- Affected `bun test`: PASS, 62 tests/906 assertions across 17 files: `tests/workspaces`, `tests/access`, catalog
  build and DSH/native source provenance, preflight/assets, native catalog/layout/protocol/transport tests.
  This includes real public-native descriptions across a concurrent directory revoke and credential revocation
  during a pending HTTP confirmation body. Mutation tests use only owned negative source clones.
- `BUN_EXECUTABLE=... python3 scripts/trace-catalog.py`: PASS with two actual SessionManager-authored isolated
  native files. The new 240-line trace has zero writes/ordinary runtime imports, zero listener binds, zero non-Unix
  connects, two readonly native ownership observations, one exec, zero stderr and ready + three correlated replies.
- `python3 tests/workspaces/browser.py`: PASS on the current source, all 12 scenarios, 47 discovered rows,
  35 explicitly synthetic index references, 36 real DSH Remote calls and zero page errors. Actual Linux Chromium
  156.0.8078.79/Bun 1.4.4 verifies SIGKILL Host restart, absolute credential/grant persistence, readonly child exit,
  canonical-root replacement denial, revoke + second restart, native cursor error and a labelled correlation fault.
  Native inode/mtime/content manifests remain unchanged; all owned processes are stopped. The complete result is
  [linux-browser.json](../../apps/workspaces/evidence/linux-browser.json).

The earlier full `bun run check` result of 116 tests/944 assertions belongs to the previous integration/native
combination; it is **historical, not a new full-suite claim**. Its original `12c72dc…`/`f2066f6…` tuple, browser proof
and native trace remain in [before-rebase-2842168](../../apps/workspaces/evidence/before-rebase-2842168/tuple.json).
Current exact source/build/schema/runtime/client/Host/installation identities are in
[tuple.json](../../apps/workspaces/evidence/tuple.json), with [native trace summary](../../apps/workspaces/evidence/native-trace.json).
Raw per-input manifests, bundles, syscall logs and screenshots remain ignored under `vendor/`.

## Acceptance scope

| #43 criterion | Component evidence and scope |
| --- | --- |
| Directory grants separate from Session Sources | PASS: fixed local profile/source configuration; grant/forged-source browser checks never expand discovery. |
| Canonical descendants, symlink/replacement, unknown/missing cwd | PASS: path-segment and inode/birth-time grants, current checks, actual browser replacement and complementary fault cases. |
| Unauthorized cwd is metadata only; protected entry points refuse | PASS: explicit directory reasons, discovered/registered metadata and held/unknown observations; history/open/execution remain globally blocked. |
| Actual pagination, partial/error and Host/DSH mapping | PASS: native pages preserve partial failures/errors; separate synthetic index input exercises actual public describe results without implicit registration/create. |
| Readonly native safety/budgets and persistent grants | PASS: current native trace/tests and process-restart browser proof; Session worker revocation remains BLOCKED on #44. |

The fixture has 47 discovered rows, including two actual SessionManager-authored files and explicit unknown,
missing, descendant, prefix and escaping-symlink cwd cases, malformed native metadata and an invalid source.
The separately labelled 35-record synthetic Session Index input is metadata only: actual public describe returns
valid/held, replaced, missing, source-unavailable and invalid-reference facts. It does not pretend real registration
or protected open exists. No Host Session-file parser, private OMP SDK, shadow transcript/tree, DSH private-instance
transport, raw native RPC tunnel or new Agent is introduced. See [component contract](../../packages/workspaces/README.md)
and [runbook](../../apps/workspaces/README.md).

No real profile, provider/model or global installation was used. Formal complete-product/native-write/global-install,
reference-hardware performance and Windows Chrome/WSL2 acceptance are NOT RUN here; Windows remains owner-deferred.
Current readonly/source fixture evidence cannot unlock #41 or claim #44 worker stop/cleanup behavior.
