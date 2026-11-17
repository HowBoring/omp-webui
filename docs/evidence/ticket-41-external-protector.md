> Historical/source selection from external `bcbc30e9532e404fb27fc63ceb85c07de335c46f`. Results and review claims below apply only to their original artifacts. This new H/P/external composition is unregistered and requires fresh paired review; see [ADR 0027](../adr/0027-unregistered-external-protector-composition.md). No actual runtime or admission proof is supplied.

# #41 external protector — source-only increment

Status: source preparation; runtime/global/private admission BLOCKED. No protector, Native executable, dispatcher,
listener, browser, process probe, signal delivery or lifecycle fixture was run. Existing orphan/fence was not inspected
or touched. This increment does not complete #41, #48, #61 or the MVP.

Implemented at the preapproved supervision process/socket and operator-build seams:

- Separate `omp-external-protector` compile-time broker-tree policy, fixed verified Native public broker selector,
  shared lease/fence/framing/wait mechanics, independent external wire/version/operation IDs.
- No external signal delivery/escalation/private cleanup command/candidate enumeration definitions after preprocessing.
  External EOF/dispatcher/parent loss does not kill services; incomplete remains sticky and retains protection.
- Fixed dispatcher-only typed launch construction, retained owning handle, registration before START, no force API,
  and completion requiring healthy protocol receipt plus successful direct protector reap.
- Independent source builder and approval member contract; exclusive publication, separate external provenance,
  enrolled/existing destination refusals and finite error codes. No Native0010 patch changes.

TDD evidence: initial controller, launch and builder tests each failed on the missing public module before minimal
implementation; an additional incomplete→complete fault failed because completion resolved, then passed after the
controller made incomplete sticky. Current tests also exercise pending-registration disconnect, root-only false
completion, forbidden private escalation, missing control after spawn, independent registration failure, canonical
construction and enrolled/existing build refusal. Pure tests are controlled OS adapter evidence, not real processes.

## Reproduction

From this worktree, with existing read-only root dependencies and pinned Bun1.4.4:

```bash
/workspace/work/rpc-public-module-probe/tooling/bun/package/bin/bun test tests/supervision/external tests/supervision/control.test.ts tests/supervision/session.test.ts tests/supervision/controller.test.ts tests/supervision/build.test.ts
./node_modules/.bin/tsc --noEmit -p tsconfig.json
python3 scripts/check-external-protector-static.py
```

The static script uses `/usr/bin/gcc -std=c11 -Wall -Wextra -Werror -O2 -static` with a clearly nonlaunched synthetic
configuration. It creates only temporary compiler output and deletes it. Neither target is executed. It compares
private optimized assembly against `5608b676da265c59870949425367b6e980643609` using identical compiler stdin invocation
and current includes. This is limited static code-generation equivalence for that configuration, not a runtime or
final source/binary identity equivalence claim. Changed private shared-source/candidate bytes still require final
review, source identity, operator approval and rebuild. See the adjacent JSON for exact source/static results.

## Recorded source/static results

Source commit `0313aa37f455ac61a384fe6c6e424d8fbda5205e`, tree
`374db3d9f4cb2161898aacae42142b7611ce5998`. Current integration
`4024c4084173c102764e0c1e42efa183ba8810d4` was already an ancestor; explicit merge was up to date. Checks below were
repeated afterward. Subsequent evidence-only documentation commits do not change those implementation bytes.

| Check | Observed |
| --- | --- |
| Pure supervision tests,7 files |27 PASS /0 FAIL /89 assertions;11 external tests |
| Full `tsc --noEmit -p tsconfig.json` |PASS |
| Static C policies |2 strict `-static` compiles PASS; neither executed |
| External preprocessed private definitions |9 excluded |
| Private optimized assembly vs5608 |Byte-identical under the recorded synthetic configuration |
| ABI fixture |Strict compile to object PASS; never linked/executed |
| Static verifier and existing containment Python |2 AST parses PASS; containment never imported/executed |
| `git diff --check` |PASS |

Additional static commands:

```bash
/usr/bin/gcc -std=c11 -Wall -Wextra -Werror -O2 -c tests/supervision/fixtures/abi-check.c -o /tmp/omp-external-static/abi-check.o
python3 - <<'PYTHON'
import ast
from pathlib import Path
for path in ['scripts/check-external-protector-static.py', 'tests/supervision/fixtures/contain.py']:
    ast.parse(Path(path).read_text())
PYTHON
```

## Genuine unmet gates

NOT RUN: actual external pre-exec/startup protection, SO_PEERPIDFD/direct dispatcher ancestry/binary authentication,
prepared scope and server durable fence, real all-child __WALL/adoption/extinction (including broker early exit and
surviving services), lease/fence durability and observer/resource faults, control/dispatcher/parent-loss preservation,
Native publication before effects and legacy-hint refusal, independently approved actual global composition,
private cleanup preserving an independent external TUI/service, Native mandatory tools/attachments and final matched
product semantic acceptance. Runtime test authorization remains with the coordinator; this increment grants none.
Windows Chrome/WSL2 is owner-deferred and NOT RUN.
