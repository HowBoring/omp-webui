# Source38 submission recovery after lost acknowledgement delivery

An isolated Linux x64 Source38 RPC v2 run on Bun 1.4.4 sent one synthetic literal prompt with the
stable key `source38-one-undelivered-submit-ack`. The bounded transport received and correlated the
successful `submission_submit` reply. The fixture validated its actual payload, retained it in a
separate side record and delivered `FIXTURE_SUBMISSION_ACK_DELIVERY_LOST` to `SubmissionClient`.
The simulated loss occurred at the fixture's receiving boundary after the real Native response arrived.
The acknowledgement reported a committed reservation, unresolved input and persistence, and no relations.
[Durable submission issue #36](https://github.com/HowBoring/omp-webui/issues/36)

The original worker opened the synthetic Session through StrictStart Continue, read its Tree, issued one
`submission_submit`, then used one public `submission_query` to establish a terminal, successful result
with generated input and committed persistence. The fixture immediately sent `SIGKILL` through its retained
Bun child handle while stdin was open. It observed exit 137 and natural EOF on both pipes with zero stderr
bytes. The original guard startup audit recorded zero denials and dispatches. Its denial latch stayed clear
and its normal-exit audit was absent.

After the original process and pipes joined, a fresh worker continued the same Catalog reference. It issued
one `submission_query` and opened, paged, and closed one public Session Tree snapshot. Its receipt matched
the original query exactly and its Tree worker ID differed. The four retained entries carried the same Native
origin and causal roles as the receipt. Input was `18bb61e3`, execution was `428cf6f1`, and additional entries
were `c88708a7` and `32a3825b`. The seed had the same text as the submitted input and carried no submission
origin. The literal provider's counter recorded one attempt from the original worker and remained unchanged
through the successor's exit.

| Process | PID | Observed exit |
| --- | --- | --- |
| Catalog | `779755` | Exit 0, both pipes at EOF, empty stderr, guard 0/0 |
| Original worker | `779772` | `SIGKILL`, exit 137, both pipes at EOF, empty stderr |
| Successor | `779801` | Exit 0, both pipes at EOF, empty stderr, guard 0/0 |

Run `393bbb` (session `61596`) reached EOF 0. Independent readback checked the receipt equality, command
lists, provider counter, process and guard records, and the hashes of the 6,891-byte result and 1,129-byte
acknowledgement side record retained in `/dev/shm/omp-source38-submission-loss36._4ac2rth/run.L71Nq6/`.

| Input or artifact | Identity |
| --- | --- |
| Host integration commit | `6c482ecc2aa10c1f063bde2609501781ea119cf2` |
| Native source tree | `b102d9db2b9b91e7baa1de484ca901705785993b` |
| Complete-worker stage receipt SHA-256 | `7e22b591a5f63dbeece7631e96f596f89e02b324f41ebae0e3d99957c15f0830` |
| Public RPC schema SHA-256 | `81a3ffc9ebcf5c929c39995cdc6350b56796782353f87a6a9c274153baffe958` |
| Fixture driver SHA-256 | `c7e0a519b4eacc51fc338f071def34d693f65d137233fe486846ae9596017386` |
| `result.json` SHA-256 | `242d2eb9f0182ea948ec65d6da54d9e09ffdbf3d4cc068dfc936d2f2746649f2` |
| `original-undelivered-submit-ack.json` SHA-256 | `1ddd5d19202f49060a37891bba877dca1d126cdd1593bec532429347a2cfb222` |

This unregistered acceptance case covers simulated acknowledgement delivery loss and real direct-worker loss
after a query has observed terminal persistence. Native write faults, transport I/O faults, earlier crash
windows, helper lifetimes, global installation, and browser or TUI flows require separate evidence.
[Clean-reopen submission run](submission-runtime.md) · [StrictStart staging](strict-runtime.md)
