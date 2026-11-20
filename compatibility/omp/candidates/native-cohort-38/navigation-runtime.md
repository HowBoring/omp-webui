# Source38 History Navigation after a clean worker exit

On Linux x64 with Bun 1.4.4, an isolated, unregistered Source38 StrictStart worker committed History Navigation
with summaries disabled. The original worker queried its receipt before closing stdin. A new worker continued the
same synthetic Native Session through its public Catalog reference, then recovered the identical receipt and opened a
fresh public History tree. This is the ordinary clean-restart case for [durable History Navigation #37](https://github.com/HowBoring/omp-webui/issues/37).

## Observed public behavior

- The private profile contained one synthetic root user entry, initially the active leaf. `navigation_inspect`
  returned the exact native target binding, null parent, and target and context revisions.
- A separate stable key with an altered context revision received `NAVIGATION_STALE_CONTEXT`. A query found
  no reservation or result for that key. The next inspection and public tree agreed with the original preview
  and tree, and the protected synthetic files retained identical hashes and metadata.
- The worker submitted both original revisions with `summarize: false` and fresh key
  `source38-root-committed`. The terminal result reported committed reservation, outcome and persistence,
  local admission, requested root user entry, null target parent and null actual leaf. The receipt carried the
  original revision pair, commit ID `457910d4-6a17-4ede-bc44-71ddd3f58a8a`, and an unsent inline draft
  offer bound to the original user entry. The same-process `navigation_query` returned the exact receipt.
- The before-tree hook flags were false, the post-tree hook invocation and completion flags were true, and
  `hookChangedLeaf` was false. The pinned runtime loads an inline autoresearch extension with a
  `session_tree` handler even when extension discovery is disabled. The receipt omitted summary facts.
- After the original process exited, the successor used only `navigation_query` and History snapshot open,
  page and close after StrictStart Continue. Its single query returned the exact original receipt. Its separate
  History worker ID and new tree cut showed a null leaf and the same root user entry as inactive. The
  protected synthetic files had identical hashes, inodes, sizes, modification times and change times around these reads.

| Process | PID | Observed exit |
| --- | --- | --- |
| Catalog | `769983` | Exit 0, stdout and stderr EOF |
| Original worker | `770000` | Exit 0, stdout and stderr EOF |
| Reopened worker | `770024` | Exit 0, stdout and stderr EOF |

All three children negotiated RPC v2 and closed through stdin EOF with empty stderr and no termination or force
signal. The three network guard audits each recorded zero denials and zero dispatches.

## Artifact identities and limits

Run `0b1d6a`, session `98614`, reached EOF 0. Its 7,254-byte sanitized result is retained at
`/dev/shm/omp-webui-navigation-goal.3jh47NgW/output/result.json` with SHA-256
`aa17102261fd23143e41674fba961cf812811fdadd98acd7d6eff45b36d9040d`. Independent readback checked the
three raw guard audits, exact receipt and confirmation binding, reopened tree, and query-only command sequence.

| Input | Identity |
| --- | --- |
| Host integration commit | `6878bdd1009309078185cb840b7f96f642738198` |
| Native source tree | `b102d9db2b9b91e7baa1de484ca901705785993b` |
| Bun executable SHA-256 | `10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235` |
| StrictStart runtime receipt SHA-256 | `9c0ae64d63cb6dffe8658d1fb593af09acab753111675cc41f4062c768131a1c` |
| StrictStart CLI SHA-256 | `5658c2d6991e86b66761b68c97779189509345c2177bbe04631b8a4494ec37e8` |
| Catalog inventory SHA-256 | `7810144736c74ae8e19d7b1981400183be94e5f1eb6f7409c6678adc2b55cea2` |
| Compiler receipt SHA-256 | `f6fe0fbaa86d596da52df2de94c4f1d8b4af404f1c343c222fcad3faf017ded6` |
| Public schema SHA-256 | `81a3ffc9ebcf5c929c39995cdc6350b56796782353f87a6a9c274153baffe958` |
| Sorted hash manifest of 81 generated files, SHA-256 | `c50a5900eb19a6f0448adf0f91f517d06c3bede5725b3f8fb3b72d99ace0ea27` |

The scratch driver `/dev/shm/omp-source38-navigation-proof.DFbTYCeH/prove-navigation.ts` has SHA-256
`53807b8e814864b682492853ca89d6c0f7907188d82c1c5a78c7c828f8dd80e9`. Its static input check passed without
opening a Native process. The earlier isolated run `4d9862`, session `59447`, reached EOF 1 after a terminal
committed null-leaf reply. Its driver incorrectly expected false post-tree flags and stopped on that assertion
before reopening. The distinct first-run log SHA-256 is
`801878692b17147c22341dbbf74bac6dfd8f78e39fd5346ff1fa9c54266cd763`.

Crash before clean exit, conditional exit markers, write failures, lost replies, cancellation, invalid targets,
summaries and extension effects require separate evidence. Native TUI, actual global installation and authorized
DSH Browser acceptance remain open. [StrictStart staging](strict-runtime.md) · [Compiler staging](compiler.md) ·
[Matched preflight evidence](preflight-evidence.md)
