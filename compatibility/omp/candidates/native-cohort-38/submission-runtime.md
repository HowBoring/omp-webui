# Source38 submission recovery after a clean worker exit

On Linux x64 with Bun 1.4.4, an unregistered Source38 StrictStart worker submitted one literal prompt to a synthetic
OMP Session. A public `submission_query` confirmed its committed result before the worker retired. A second
worker continued the same Session through the public Catalog reference and recovered the same result using only
read requests after opening. The Catalog and both Session workers used the pinned guard and isolated profile.
This is one native RPC acceptance case for [durable submission #36](https://github.com/HowBoring/omp-webui/issues/36)
and [candidate admission #41](https://github.com/HowBoring/omp-webui/issues/41).

## Observed public result

The submitted client key was `source38-one-literal-submission`. Its acknowledgement reported a committed
reservation, an unresolved input and persistence outcome, unknown operation outcome, and no relations.
The subsequent query of that key in the original worker reported a terminal receipt with
`operationOutcome: succeeded`, `inputOutcome: generated`, and `persistence: committed`. The new worker's
query returned the identical receipt, including the same source, physical instance and native Session target,
original key and all four retained relations. The receipt fit in one bounded page.

| Native causal role | Retained entry ID |
| --- | --- |
| Additional | `110e53c3` |
| Input | `3f3824fb` |
| Additional | `45628d5f` |
| Execution | `8e5dae43` |

Each entry ID matched a public Session Tree item in the reopened worker with the same origin and causal role.
The seed item had the same literal text as the submitted prompt and bore no submission origin. The synthetic
provider's append-only counter recorded exactly one attempt belonging to the original PID. The second worker
sent one `submission_query`. Its other requests were protocol negotiation, StrictStart state and Continue,
Session state, and History snapshot open, page and close. The owned synthetic native files had the same hashes,
inodes, sizes, modification times and change times on either side of the second worker's query.

| Original process | PID | Observed end |
| --- | --- | --- |
| Catalog | `766581` | Exit 0, stdout and stderr EOF, empty stderr |
| Submission worker | `766597` | Exit 0, stdout and stderr EOF, empty stderr |
| Reopened worker | `766626` | Exit 0, stdout and stderr EOF, empty stderr |

Both Session workers reported distinct public History worker IDs. All three children closed through stdin EOF
without a termination or force signal. Each pre-import guard reported zero denials and zero dispatches.
The scope was one ordinary successful input and clean reopen. Delayed first writes, extension-transformed input,
handled builtins, lost acknowledgements, crash-before-query, short writes, copy/branch provenance, metadata
rollback and reader compatibility are covered by [submission-fault-runtime.md](submission-fault-runtime.md) and the
committed `tests/compatibility/submission-native.test.ts` fixture. Native TUI, actual global installation and
authorized DSH browser flows require separate evidence. The candidate remains unregistered and both tickets remain
open.

## Execution and artifact identities

The original launch was tool result `74ab3a`, session `90925`, and reached EOF 0. The 6,682-byte sanitized
result is retained locally at `/dev/shm/omp-webui-submission-goal.qFhRh6iG/output/result.json` with SHA-256
`ed8182384a9f78fe1e307e990fb6faa8eb91ee9da2e081de15095138a9665c45`. The three 27-byte guard audit files each
have SHA-256 `4ebfcde225764cc663096193f3a9b5f203d9b7097426d282cc4c167fa5f3c4d3`.

| Input | Identity |
| --- | --- |
| Host integration commit | `1922f3582fa4dca14952bba8745d09257dfe155a` |
| Native source tree | `b102d9db2b9b91e7baa1de484ca901705785993b` |
| StrictStart runtime receipt SHA-256 | `9c0ae64d63cb6dffe8658d1fb593af09acab753111675cc41f4062c768131a1c` |
| StrictStart CLI SHA-256 | `5658c2d6991e86b66761b68c97779189509345c2177bbe04631b8a4494ec37e8` |
| Public schema SHA-256 | `81a3ffc9ebcf5c929c39995cdc6350b56796782353f87a6a9c274153baffe958` |
| Compiler receipt SHA-256 | `f6fe0fbaa86d596da52df2de94c4f1d8b4af404f1c343c222fcad3faf017ded6` |
| Catalog inventory SHA-256 | `7810144736c74ae8e19d7b1981400183be94e5f1eb6f7409c6678adc2b55cea2` |
| Bun executable SHA-256 | `10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235` |

The reviewed execution sources remain in `/dev/shm/omp-source38-submission-proof.qerQn2sM`. The separate
`--check` run verified the runtime inputs and matched generated validators without opening a Native process
(`2756a6`, EOF 0). The scoped strict type check and the two pure submission query tests passed
(`c84992`, two tests and nine assertions).

| Selected execution source | SHA-256 |
| --- | --- |
| `prove-reopen.ts` | `3c90a0ab6f8dee809b7d97bea67d63ebf41cbfe44a25fd1664c7c9d8147bcce1` |
| `literal-provider.ts` | `31e63cde1dc2ca989ed94eb4a52efa69ca5442d6eb00f515b4be07fdcc83e6d1` |
| `audit-preload.ts` | `5c8c3600dfa0061b68ade0604039f00e127644085861d29628e6706d8a961330` |
| `recovery-check.ts` | `9cc559006884940d7e022165bebf84773dd22ad77665f1af9511b73ef9c65c4c` |
| `recovery-check.test.ts` | `7af6e87402e961977afd6bd6bfa11cf9b7b06eb018f7d7c51c91f0065872ae02` |
| `config.yml` | `bd63772837529de9e09f812f0b7a78e1e64bcf0472ada9c00b7f0e5424f59d30` |

## Reproducing on a new staging layout

The retained driver pins the actual stage and compiler receipts and uses the exact scratch paths above. A
portable driver should take independently verified StrictStart, Catalog and compiler stage directories, check
their shared Native source and schema identities and load the matching generated validators from the supplied
compiler output. It should reuse the existing Host bounded stdio transport and public RPC clients. The isolated
profile, trusted literal model, bundled extension resolver, and guard must stay confined to the synthetic run.
Preserve the one-submit and query-only successor command allowlists, original drains, exact provenance equality,
and provider counter. [Catalog staging](catalog-runtime.md) · [Compiler staging](compiler.md) ·
[Preflight evidence](preflight-evidence.md)
