# Source38 History Navigation after immediate process loss

An isolated Linux x64 worker on Bun 1.4.4 used Source38 public RPC v2 to commit History Navigation
with summaries disabled. Its private synthetic Session had one active root user entry. The public
inspection bound that entry and its null parent to the exact native Session and revision pair.
The single `navigate_tree_committed` reply confirmed terminal, local, committed persistence, a null
actual leaf, and an unsent draft. The inline post-tree hook completed without moving the leaf.
The commit ID was `b5717679-0db0-40e7-8f58-67c01bc80b77`.
[Immediate persistence issue #37](https://github.com/HowBoring/omp-webui/issues/37)

Immediately after validating that reply, the fixture sent `SIGKILL` using the original retained
Bun subprocess handle while its stdin remained open. Its command log ends at the commit. The
original worker reported exit 137 and `SIGKILL`, and both pipes reached natural EOF with zero
stderr bytes. Its network guard startup audit recorded zero denials and dispatches, its denial
latch stayed clear, and its normal-exit audit was absent.

Only after the original process and both pipes joined did the successor open the same native
reference through StrictStart Continue. Its only subsequent RPCs queried the original operation
ID and opened, paged, and closed a public Session Tree snapshot. It recovered the exact terminal
receipt. The new Tree worker ID reported a null leaf and the same root entry as inactive.
Protected synthetic files retained the same hashes and metadata across those reads. The Catalog
and successor exited 0 with both pipes at EOF, empty stderr, and network guard totals of 0/0.

| Process | PID | Observed exit |
| --- | --- | --- |
| Catalog | `778818` | Exit 0, stdout and stderr EOF |
| Original worker | `778836` | `SIGKILL`, exit 137, stdout and stderr EOF |
| Successor | `778863` | Exit 0, stdout and stderr EOF |

Run `5ef181` (session `92820`) reached EOF 0. Independent readback checked the artifact hashes,
receipt, command lists, distinct Tree workers, and retained guard files. The 6,594-byte result
and guard files are under `/dev/shm/omp-source38-navigation-crash37.lOdzuEu2/run.aMYnYA/`.

| Input or artifact | Identity |
| --- | --- |
| Host integration commit | `263f8cfffd2db1437d877ab67c4f10984faac1f1` |
| Native source tree | `b102d9db2b9b91e7baa1de484ca901705785993b` |
| Complete-worker stage receipt SHA-256 | `7e22b591a5f63dbeece7631e96f596f89e02b324f41ebae0e3d99957c15f0830` |
| Source38 CLI SHA-256 | `5658c2d6991e86b66761b68c97779189509345c2177bbe04631b8a4494ec37e8` |
| Public RPC schema SHA-256 | `81a3ffc9ebcf5c929c39995cdc6350b56796782353f87a6a9c274153baffe958` |
| Fixture driver SHA-256 | `2f12935eb0606e9d54f70e98376c00d291d32d1ace983be0c341af9d34f08574` |
| Public commit receipt SHA-256, sorted compact UTF-8 JSON | `cbd703d103afe42be1ed02a16ff416b7c469b18fc4561a3baab2cc2a5eb0375c` |
| Result JSON SHA-256 | `2bbf6891719f3012a084c16c4ea23110f620766f627ff0befb57059ea0c03072` |

This run covers the isolated Native RPC process-crash window for one no-summary root position.
Normal-exit marker semantics, write faults, cancellation, unknown outcomes, invalid targets,
summary and other hook effects, the DSH Browser, and Native TUI need separate evidence.
[Clean-reopen run](navigation-runtime.md) · [StrictStart staging](strict-runtime.md)
