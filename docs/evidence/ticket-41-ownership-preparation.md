# Ticket 41 execution ownership source preparation

Status: **INCOMPLETE / NO RUNTIME OR GLOBAL CAPABILITY**. This checkpoint implements the first public contract
slice of [ADR 0018](../adr/0018-native-execution-ownership.md). It does not complete #41, #48, #61 or any private admission gate.

The reproducible source identity is [execution-ownership.preparation.json](../../compatibility/omp/execution-ownership.preparation.json).
The patch applies after the exact stable six Native patches listed there. Patches 7–9 are deliberately absent from
this preparation; `scripts/omp-source.ts` and the active/final compatibility tuple are unchanged. Do not call this
a composed final 1–10 build. The canonical Native cache was read only; changes use an owned lightweight sparse clone.

Authored Native public source comprises strict request/response/schema validation, bounded UTF-8/LF framing,
immutable-registration client, dispatcher decisions and helper durable-fence/publication permits. The experimental
`--execution-dispatcher` selector explicitly refuses with `ownership_backend_unavailable` before the normal runtime
graph. The selected OS/storage/server transport does not yet exist. The same-source C/FFI bridge prepares direct
socket ownership, actual SO_PEERPIDFD/credentials, retained/revalidated ancestry, generational opaque handles and
aggregate descriptor limits. **It was not compiled, loaded or executed.** It grants no signal/wait authority.

The accepted seams remain public Native module/schema behavior, then actual public CLI/RPC/TUI and real browser
acceptance. Current tests use synthetic disk/kernel facts at the system seam and pure wire exchange; those fixtures
prove decision behavior only. They do not establish actual ancestry, env-i classification, service preservation,
maintenance protection, worker cleanup, actual provider/tool behavior or a production dispatcher.

| Check | Actual result | Scope |
| --- | --- | --- |
| Pure ownership module tests | PASS: 13 tests, 39 assertions, 4 files, 22 ms | No CLI/runtime/provider/kernel imports |
| Public request/response schema corpus | PASS: 8 request + 6 response cases | AJV 8.17.1 and strict request decoder |
| Focused source type check | PASS: `bun check --no-script`, 10 files, 0 errors, 88.31 ms | New ownership TS/test files only; C and CLI graph excluded |
| Host repository type check | PASS: `bun run typecheck`, exit 0 | Host source compile only |
| Ordered patch application | PASS: private index, base + 1–6 + 0010 | Prepared tree recorded in identity JSON |
| Whitespace check | PASS: owned Native diff and repository diff | Source only |
| C/FFI compile/load, SO_PEERPIDFD, helper/ancestry/FD fixtures | NOT RUN | Runtime window held |
| Corrected actual dispatcher CLI | NOT RUN | Requires pre-import guard + isolated environment before any Native import |
| All-mode broker client no-auto-spawn and broker publication entry | NOT IMPLEMENTED | Baseline still auto-spawns; no claim from new module alone |
| Consumer policy, private LSP/blob and mandatory attachment paths | NOT IMPLEMENTED / NOT RUN | Mandatory stories retained |
| External broker/service lifetime protectors | NOT IMPLEMENTED / NOT RUN | Private helper EOF policy cannot preserve external services |
| Final actual-global tuple, TUI/data/rollback and private admission | BLOCKED | Operator entry missing; final Native/DSH composition unfinished |

## Reproduction

Apply exactly the manifest's six base patches and `0010-execution-ownership.patch` to an owned checkout at the
recorded Native base. Do not modify a running/canonical build. With the pinned Bun, run:

```sh
bun --no-env-file test ./packages/coding-agent/test/execution-ownership-cli.test.ts \
  ./packages/coding-agent/test/execution-ownership-client.test.ts \
  ./packages/coding-agent/test/execution-ownership-contract.test.ts \
  ./packages/coding-agent/test/execution-ownership-dispatcher.test.ts
```

Despite its filename, `execution-ownership-cli.test.ts` imports only `launch/ownership/entry.ts`, which refuses
before any runtime import; it is not actual CLI acceptance. From the Host repository run
`bun --no-env-file scripts/validate-ownership-preparation.ts <owned-native-checkout>` for the public JSON schema.
The focused type-check config includes only `src/launch/ownership/*.ts` and `test/execution-ownership*.ts`, strict
mode, Bun types, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noEmit` and bundler resolution.

## Failed pre-guard entry attempt, retained separately

An initial RED test imported public `runCli(["--execution-dispatcher"])` before that selector existed. It fell through
the ordinary runtime import under inherited HOME, without the required pre-import egress guard or synthetic profile.
The observed result was **FAIL: 0 pass / 1 fail / 1 assertion, 1.460 s**, error
`EROFS: read-only file system, mkdir '/home/agent/.omp'`. That test was removed and no actual CLI restart occurred.

The denied mkdir is not evidence of no earlier reads/dispatch. No filesystem/network trace was captured. A read-only
source audit found the reachable ordinary bootstrap imports proxy/AI/utils code and may eagerly parse home/config/
agent/cwd `.env` paths before later initialization. Exact prior config/credential reads and network/provider dispatch
are **UNKNOWN**. No private contents were inspected during the audit. No global installation or unknown process
was changed/killed. Future entrypoint negatives must launch with the pre-import guard, explicit synthetic HOME/
profile/cwd and an allowlisted environment **before any Native import**, even when testing a missing selector.

## Next bounded slices

Implement authenticated fixed-rendezvous transport and durable dispatcher storage, finish helper registration with
actual helper peer pidfd before START, then remove every compatible client-side broker spawn/reconnect fallback.
Add broker generation publication checks and guard every shared consumer before effects. External protectors need
an explicit preservation policy and independent lifetime protection. The supporting private helper/Host adapter is
owned separately and must be combined/reviewed with this Native contract; a standalone helper result is no private capability.

After source/build preparation, first run bounded harmless OS proofs in a coordinator-cleared window. Actual Native
bash/background/subagents, nested env-i denial, independent external TUI/service preservation, private LSP/blob and
all attachment scenarios precede compatibility admission. Keep actual Windows/WSL2 owner-deferred and unclaimed.
