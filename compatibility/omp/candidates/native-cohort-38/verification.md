# Native Source38 source verification

## Successful Linux checks

- Fresh detached checkout of the pinned OMP base under isolated scratch. Git applied all 12 selected patches to its index and worktree. A separate private index replay matched the complete manifest tree sequence. The Source38 stage reached `2f2591e6c69240007c7b8fd8a0a683ebaf17e93c`. The final tree was `b102d9db2b9b91e7baa1de484ca901705785993b`.
- Bun 1.4.4 ran `packages/coding-agent/scripts/gen-rpc/index.ts` with the exact no-provider preload and both cache flags. It generated the JSON Schema and TypeScript, Go, Python and Rust wire outputs. Only those five tracked files changed after patch application. Their sizes and hashes are recorded in [candidate.json](candidate.json).
- The direct command `bun --no-env-file test --preload "$guard" packages/coding-agent/test/rpc-wire/generated.test.ts` passed one test and five assertions. The test regenerates all five public artifacts in memory and compares their bytes. This invocation used the same isolated environment and the two cache flags.
- TypeScript 6.0.3 on Node 24.22.1 returned exit 0 in strict, no-emit mode. Its checked entries were the `gen-rpc` entry, source and generated wire, submission, navigation and attachment callback clients, and the Branch Inspection callback client, wire and handler. Full Native runtime typechecking, standalone runtime validator regeneration and SDK compilation are outside these results.
- The generated command table includes `submission_submit`, `submission_query`, `navigation_inspect`, `navigate_tree_committed`, `navigation_query`, `attachment_prepare`, `attachment_cancel` and `branch_inspect`. The offline ModelRegistry postimage SHA-256 is `4170d9c10d12626e0bc2833282f120529b66a6b5ee5ed129309723baaa4327f5`, the reviewed Source45 value.
- An independent run of the corrected tracked `replay.py --verify-wire` reached EOF with exit 0 in tool session `80766` (`5a829f` to `076c58`). It materialized the same 12-patch tree under `/dev/shm/omp-webui-native-replay-RUarVWQb/checked/native`, matched all five generated hashes, ran the single built-in test with five assertions and passed scoped strict TypeScript.

## Interrupted wrapper attempt

The first wrapper attempt regenerated all five wire artifacts, then used this argv.

```text
/workspace/work/tooling/node_modules/bun/bin/bun.exe
--no-env-file --no-install --preload /dev/shm/omp-native-cohort-38.QHDq2n7Q/verified/no-provider.ts
test packages/coding-agent/test/rpc-wire/generated.test.ts
```

With that option order, Bun resolved `test` to the upstream package script. The original tool output recorded `bun scripts/ci-test-ts.ts local packages/coding-agent/test/rpc-wire/generated.test.ts`, a plan for 242 commands, and a concurrency limit of four. Four child test processes were observed with `bun test --only-failures --parallel=2 --timeout=30000` in their argv. The scratch scope had a separate HOME, a restricted network sandbox and only the selected typecheck dependencies.

The attempt was stopped. The outer tool session `45312` reached EOF with exit 130. The final observed members of its process group were defunct and had been reparented. Original descendant waits and per-child reader EOF were unavailable. The checked-in recipe uses the scoped argument order from the successful direct command and the separate independent replay.
