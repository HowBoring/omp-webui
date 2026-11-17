> Historical/source selection from external `bcbc30e9532e404fb27fc63ceb85c07de335c46f`. Results and review claims below apply only to their original artifacts. This new H/P/external composition is unregistered and requires fresh paired review; see [ADR 0027](../adr/0027-unregistered-external-protector-composition.md). No actual runtime or admission proof is supplied.

# External protocol receipt and closed-startup validation (#41)

Status: **SOURCE/PURE/TYPES ONLY**. Kernel, Native, real dispatcher authentication/publication and global/product
admission remain **BLOCKED / NOT RUN**. Linux development only; actual Windows Chrome/WSL2 is owner-deferred.

This addresses all latest review findings on `907e8b17d6c089c70afbb995d1ac0aa3ae293721`, tree
`0c6d22a0b3e0d8e565876ef10ae90f25082c0de1`: zero Standards findings and one P2 Spec finding in
`ticket-41-external-phase-{standards,spec}.md`. The single ROOT_EXIT received during held registration, including
in the HELLO chunk, previously permitted late START and successful readiness despite known closed spawn admission.
Fresh independent reviews of this fix belong to the coordinator.

## Change and preserved contracts

A valid ROOT_EXIT now rejects pending startup readiness with the existing `EXTERNAL_UNRESOLVED` category. It is
neither a malformed frame nor a sticky control failure: it does not destroy healthy control. Independent registration
still finishes, but an already observed root exit suppresses START. If START was already written and its local write
callback is pending, root receipt rejects readiness before that callback can report success. The callback supplies
no peer-delivery or execution proof. Existing receipt state provides the ordering guard; no public API or error code,
timeout constant, force, reconnect or cleanup feature was added.

Startup and terminal completion remain separate. After successful independent verification, ordered COMPLETE,
clean EOF and successful direct protector reap can resolve `completed` even though startup `ready` rejected.
Root exit alone never proves a drained tree. COMPLETE received before verification finishes retains the existing
sticky `EXTERNAL_PROTOCOL` rule, even after a valid ROOT_EXIT; late verification cannot retroactively authenticate
that terminal receipt. The new tests wait for verification before delivering a trusted terminal COMPLETE.

The predecessor's synchronous receipt validation is preserved: all four forbidden private phases, duplicate
HELLO/ROOT_EXIT, identity/sequence errors, premature COMPLETE, incomplete reports and pre-verification EOF/close
remain fail-closed. Normal post-start ROOT_EXIT/COMPLETE/EOF and provisional completion/direct reap remain covered.
The paired JSON preserves the predecessor's exact phase-fix evidence under `previousPhaseFixEvidence`.

The approved public process/socket adapter is the deterministic seam. These are pure state/order tests, not actual
socket, kernel or Native authority evidence. The C pre-exec barrier, independent authenticated registration,
full-flush/sticky-fence finalization, ECHILD requirement and private EOF policy remain necessary and unchanged.

## Red and green

- Genuine RED commit `3a6ca60`: **27 pass, 2 fail, 148 assertions**. Single valid ROOT_EXIT during held verification
  and in the HELLO chunk each released an unwanted START. The test source preceded the implementation change.
- Source implementation `abd9796b539094609b2957ca6598ded1ce53569a`, tree
  `22dc0ec35411e7aba4ce006a9668e3125ffa75e3`.
- Final controller selection: **30 pass, 0 fail, 162 assertions**, 19 ms. New tests capture readiness rejection before
  verification/write completion, prohibit late START, and require terminal COMPLETE/EOF plus controlled-adapter reap.
  The pending-write case observes one already-issued START and prohibits successful readiness or another START.
- Final pure supervision selection: **50 pass, 0 fail, 230 assertions across 7 files**, 49 ms.
- Full Host TypeScript: **PASS**, exit 0. `git diff --check`: **PASS**.
- Explicit merge of CURRENT `mvp/spec-29` at `4024c4084173c102764e0c1e42efa183ba8810d4`: already up to date;
  ancestor check passed. Existing integration dependencies reused by an own ignored symlink; no installation.

With pinned Bun `/workspace/work/rpc-public-module-probe/tooling/bun/package/bin/bun` (1.4.4):

```sh
bun test tests/supervision/control.test.ts tests/supervision/controller.test.ts \
  tests/supervision/session.test.ts tests/supervision/build.test.ts \
  tests/supervision/external/controller.test.ts tests/supervision/external/launch.test.ts \
  tests/supervision/external/build.test.ts
bun run typecheck
git diff --check
```

All nine C/build/fixture paths in the paired JSON were byte-compared with the 907e review base and rehashed unchanged.
Previous strict static C compilation, nine excluded private definitions and limited private assembly comparison
remain historical evidence. No C compilation or executable was run for this TS-only change. Log hashes and exact
source digests are in the paired JSON; these are reported execution results, not independently reviewed results.

## Unrun limits

No actual helper/protector/C executable, kernel fixture, Native/CLI/task, UDS/listener/probe, signal, browser, strace or
dlopen was run. The actual C write-fault fixture remains NOT RUN. No global installation/approval/publication,
old orphan or fence was inspected or changed. No subagents, GitHub/push, other-worktree edits or integration publication
occurred. Fresh coordinator-owned two-axis reviews must precede actual OS proof or integration. This source repair
does not complete #41, #61 or the MVP.
