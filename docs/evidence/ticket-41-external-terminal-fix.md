> Historical/source selection from external `bcbc30e9532e404fb27fc63ceb85c07de335c46f`. Results and review claims below apply only to their original artifacts. This new H/P/external composition is unregistered and requires fresh paired review; see [ADR 0027](../adr/0027-unregistered-external-protector-composition.md). No actual runtime or admission proof is supplied.

# External receipt-time admission fence (#41)

Status: **SOURCE/PURE/TYPES ONLY**. Kernel, Native, real dispatcher authentication/publication and global/product
admission remain **BLOCKED / NOT RUN**. Linux development only; actual Windows Chrome/WSL2 is owner-deferred.

This fixes the one P2 Spec finding in the external review of `904f3e859aecdf00d3f8e442dca71ef1fb97cf7d`
(tree `d4b0c3dea196232713fb71673b1164648ad77efc`); that review reported zero Standards findings.
Independent fresh review of this fix belongs to the coordinator and has not run as part of this evidence.

## Change and preserved contracts

An actual control `end` or `close` observed before independent registration finishes now fails immediately.
Any decoded `STATE incomplete` also fails immediately, rather than waiting behind the registration promise.
Failure stays sticky, rejects readiness, retains the owning handle and direct reap promise, and prevents a late START
when registration later resolves. After registration, EOF/close processing remains ordered behind previously received
frames; queued ROOT_EXIT and COMPLETE can still establish provisional completion followed by successful direct reap.

The public process/socket adapter is the already approved deterministic test seam. It supplies controlled external OS
events and registration delay, without mocking controller internals. These are pure state/order tests, not real sockets
or kernel/Native authority evidence. The C pre-exec barrier and actual authenticated dispatcher registration remain
required. No new public API, timeout, recovery, tombstone or cleanup policy was added.

Private supervision policy/API, C full-flush/sticky-fence finalization, separate protector identities and shared builder
mechanics are unchanged. All C/build/fixture paths listed in the JSON were byte-compared with the base and rehashed.
Their previous strict compilation, nine excluded private definitions and limited private-assembly equality remain
historical evidence from the base; C was not recompiled or executed for this TS-only fix.

## Red and green

- Genuine RED commit `1098fcaaa116ba1b3bfb18008ea0e2c1830dd243`: controller **11 pass, 3 fail, 47 assertions**. Each new
  `end`, `close`, and `incomplete` case demonstrated the actual unwanted START after held verification was released.
- Implementation `b3e6d2a6adeebcfef3809876547b0449d65bafcf`, tree `709363edb0aeb7982cd1038d7c1723e957992345`.
  Explicit merge of CURRENT `mvp/spec-29` at `4024c4084173c102764e0c1e42efa183ba8810d4`: already up to date.
- Final pure supervision selection: **35 pass, 0 fail, 128 assertions across 7 files**, 59 ms. Includes all three new
  receipt variants, rejected readiness before and after verification, no START, retained unresolved ownership until
  direct reap, and a positive split-frame ROOT_EXIT/COMPLETE followed immediately by end+close.
- Full Host TypeScript: **PASS**, exit 0. `git diff --check`: **PASS**.

With pinned Bun `/workspace/work/rpc-public-module-probe/tooling/bun/package/bin/bun`:

```sh
bun test tests/supervision/control.test.ts tests/supervision/controller.test.ts \
  tests/supervision/session.test.ts tests/supervision/build.test.ts \
  tests/supervision/external/controller.test.ts tests/supervision/external/launch.test.ts \
  tests/supervision/external/build.test.ts
bun run typecheck
```

The own ignored `node_modules` link points to the existing integration dependencies; no installation was performed.
Exact source/log digests and commands are in the paired JSON. Logs remain outside Git in `/tmp`.

## Unrun limits

No actual helper/protector/C executable, kernel fixture, Native/CLI/task, UDS/listener/probe, signal, browser, strace or
dlopen was run. The staged actual C backpressure/write-error fixture remains NOT RUN. No global installation/approval,
old orphan or fence was inspected or changed. No GitHub/push, child agents, frozen worktree mutation or integration
publication occurred. This source repair does not complete #41, #61 or the MVP.
