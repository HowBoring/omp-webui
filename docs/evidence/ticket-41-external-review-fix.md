> Historical/source selection from external `bcbc30e9532e404fb27fc63ceb85c07de335c46f`. Results and review claims below apply only to their original artifacts. This new H/P/external composition is unregistered and requires fresh paired review; see [ADR 0027](../adr/0027-unregistered-external-protector-composition.md). No actual runtime or admission proof is supplied.

# #41 external protector review fixes — source-only

Status: all three findings from the source reviews of8011 are addressed in source. Actual kernel, Native,
external dispatcher authentication/publication, global installation and product admission remain **BLOCKED / NOT RUN**.
This does not complete #41, #61 or the MVP. No protector/helper target, Native/CLI, listener, browser, probe, signal,
strace or dlopen fixture was run. The existing orphan and fences were not inspected or touched.

Implementation commit `1918af15d1aa8f5bf93bcf871b69665eb65ebc19`, tree
`c3a0a3c383644a259b9f5f9ac9057cc50efc276d`, contains the preserved predecessor ordering fix and both remaining fixes.
An explicit merge of CURRENT `mvp/spec-29` at `4024c4084173c102764e0c1e42efa183ba8810d4` was already up to date.
All checks below ran afterward on clean implementation sources. Later evidence-only commits do not change these bytes.
Exact digests, history and check results are in [the adjacent JSON](ticket-41-external-review-fix.json).

- Ordering: COMPLETE before HELLO, before ROOT_EXIT, and during held independent registration cannot produce false
  completion. Receipt-time validation prevents a queued COMPLETE from releasing a late START. The owning handle
  remains retained and completion waits for direct reap. Predecessor RED `9e18c25` had9 PASS/1 FAIL; its dirty fix was
  snapshotted on restore, reproduced GREEN10/36 and committed `ce11ced`. Final tests also cover a provisional COMPLETE
  followed by unsuccessful protector reap. These are public process/socket controlled-adapter tests, not real C proof.
- Shared build mechanics: one implementation validates release/path/inodes, serializes pinned configuration,
  compiles/exclusively publishes and performs temporary/maintenance-lease cleanup. Private and external entry points
  explicitly retain separate executable, provenance/configuration names and error categories. Independent approval
  contracts remain distinct. No build or approval fallback was added.
- External finalization: COMPLETE is queued once while fence and lease remain held. EAGAIN/partial delivery returns
  to polling. Write failure keeps sticky incomplete health and retained protection; it cannot turn an emptied queue
  into exit0. After the full flush, health/control is checked again before successful fence removal/fsync and exit0.
  Controller completion remains provisional until successful direct protector reap. Private EOF mandatory cleanup
  and its intentional completion policy are unchanged; private optimized assembly remains identical to5608.

| Final check | Actual result |
| --- | --- |
| Pure supervision,7 files |31 PASS /0 FAIL /106 assertions /133ms |
| Full Host TypeScript |PASS, exit0 |
| Strict static C policies |2 compiles PASS; neither target executed |
| External private definitions |9 excluded after preprocessing |
| Private optimized assembly vs5608 |Byte-identical; SHA256 `8fe051fbc3e34832aee2089ab0e872f258799b171b1c68d34ce2c95eba23ea40` |
| ABI and staged synthetic root |Strict object compilation PASS; never linked/executed |
| Static verifier, containment, staged fault fixture Python |3 AST parses PASS; fixture code never imported/executed |
| `git diff --check` |PASS |

Reproduction (existing pinned tools/dependencies only):

```bash
/workspace/work/rpc-public-module-probe/tooling/bun/package/bin/bun test tests/supervision/control.test.ts tests/supervision/controller.test.ts tests/supervision/session.test.ts tests/supervision/build.test.ts tests/supervision/external
/workspace/work/rpc-public-module-probe/tooling/bun/package/bin/bun run typecheck
python3 scripts/check-external-protector-static.py
/usr/bin/gcc -std=c11 -Wall -Wextra -Werror -O2 -c tests/supervision/fixtures/abi-check.c -o /tmp/abi-check.o
```

The static verifier supplies one nonlaunched synthetic configuration, compares private optimized assembly against5608
and deletes compiler output. This is limited code-generation evidence, not final binary/source approval equivalence.
The changed shared C source and build mechanics require fresh final review, source inventory, approval and rebuild;
no old binary or proof should be enrolled as this candidate.

`tests/supervision/fixtures/external-write-fault.py` stages actual raw fd3 backpressure and EPIPE cases with a synthetic
root and fake external-system dispatcher. **Both cases are NOT RUN**, including against the failing baseline. The
fixture fills the actual socket queue before the complete ACK; it checks live retained protector/fence/lease, then
allows successful drainage or observes sticky write failure. Existing independent retaining Python containment owns
fixture cleanup and leaves failed fences intact. No C send/wait result is mocked. Each case needs a fresh coordinator
runtime window. Fake ACKs do not prove Native ancestry, independent binary approval or pre-effect publication.

All actual runtime gates remain unmet: kernel all-child/adoption/extinction and durability/resource faults, genuine
SO_PEERPIDFD/direct-parent/executable approval, authenticated Native publication, actual global composition, external
TUI/service preservation alongside private cleanup, and final matched product semantics. Windows Chrome/WSL2 remains
owner-deferred. Earlier8011 results in `ticket-41-external-protector.md` are historical, not final-source results.
