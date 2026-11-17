# #41 H/public-P prerequisite source validation

Base: `f604c2d3f9473ec22ffd98956d87c0c86d5d2e50`. Branch: `source/ticket-41-h-public-prerequisites`.
This is an unregistered source candidate for fresh composed review. It does not establish actual runtime compatibility, final public delivery, or completion of #41/#61.

## Seams and TDD

The already reviewed public control-byte stream, private control/session/controller and retained-owner system boundaries are reused. Injected descriptor/library/process/scheduler systems are pure fakes. The production-constructor negative test rejects the deliberately absent approved manifest entries before pin/open/load; no actual file descriptor or library is involved. The selected test import closure was inspected before execution. Current H filesystem verifier regression sources are preserved but are NOT RUN under this narrower pure/static window.

RED: before selecting production sources, `bun test tests/supervision/control-io-public.test.ts` exited 1: missing `packages/control-io/index.ts`; 0 pass, 1 fail, 1 import error.

GREEN on the new composed source:

```sh
bun test tests/supervision/control-io-public.test.ts tests/supervision/control.test.ts tests/supervision/session.test.ts tests/supervision/controller.test.ts tests/supervision/owned-control-io.test.ts tests/supervision/approved-helper-owner.test.ts
```

Bun 1.4.4: **42 PASS, 0 FAIL, 164 assertions**, 6 files. Original reviewed test bytes are unchanged. Coverage includes clean/truncated/close-only EOF, original fake reap, one-attempt untransferred close, retained uncertain load/disposal, denied loader substitution, controlled backpressure/callback disposal, concurrent owner handles and selection failure propagation. These are controlled semantics, not actual kernel/FFI results.

## Static checks

- `bun run typecheck`: **PASS**, normal full `tsconfig.json`, TypeScript 6.0.3, using an ignored symlink to integration's original `node_modules`. Initial attempts failed because sparse checkout omitted unchanged base `compatibility/omp/fixtures/live-worker.ts`; materializing the unchanged base fixture directory resolved all diagnostics. No dependency sources/configuration were edited and no fixture was executed.
- `bun docs/evidence/source-checks/ticket-41-h-public-static.ts`: **PASS**. TypeScript AST only; 37 transitive TS sources, 147 import/export edges, 20 modules in selected pure tests' static runtime closure. No static `bun:ffi` or maintenance import in that executed closure. The [graph](ticket-41-h-public-static-closure.json) records type-only and dynamic imports explicitly. Dynamic FFI loading remains present in source and unexecuted.
- `gcc -std=c11 -Wall -Wextra -Werror -Wconversion -Wsign-conversion -Wshadow -Wformat=2 -fsyntax-only compatibility/control-io/owned-control-io.c`: **PASS**.
- `gcc -std=c11 -Wall -Wextra -Werror -fsyntax-only -include /tmp/ticket-41-prerequisite-configuration.h compatibility/supervision/private-helper.c`: **PASS**. The exact inert macro header is preserved as `source-checks/ticket-41-private-helper-configuration.h`; substitute that path to reproduce. No source binary/library/object was emitted or loaded.

The syntax checks use the available system compiler/headers and do not establish a distributable toolchain/runtime identity. Public and private builders were inspected, never invoked. Root package/lock provenance would be fresh if a later builder is authorized: integration's root package differs from H/P only by four preexisting workspaces scripts, with identical dependency/toolchain pins. Historical isolated build/proof identities are not reused.

The exact path allowlist audit selected 52 files; all implementation/test/build/C/header bytes match their recorded source commits, and every integration preimage is absent. `git diff --cached --check` reports one inherited extra blank line at EOF in exact H `tests/delivery/fixtures.ts`; it is retained to keep source selection byte-exact. No other whitespace diagnostic was reported.

## Review and outstanding gates

Read the public adapter pair (`87182bb...f30936d`), nominal-preparation pair (`f30936d...416a0c2`), earlier C-I/O lifetime pair (`3e11e6b...b8a00ea`) and external clean-EOF pair (`5608b676...285eeb8`) from the outside review archive. Their coverage is historical and scoped. The current H verifier is selected exactly; the new H/P composition requires a fresh two-axis full-delta review. No review result is relabeled as covering this tuple.

`bun run check` and the full test suite are **NOT RUN** because they include Native/Host/runtime families outside the assignment. Actual C execution, library/FFI loading, maintenance locking, kernel/process/signal/socket/fence inspection, native actors, seed/browser/staging/keys/global install and GitHub/push/integration mutation were not performed. No external-controller files, Native patches, vendor, emitted artifacts, signed inventory or root registration were selected. Product Session admission stays blocked.
