# Source38 startup Interaction race in Linux Chromium

Two authorized Chromium tabs opened the same synthetic Session through the pinned DSH Session
bundle and the isolated Bun Host. The test held both actual Open requests and released them
together. One real Source38 worker entered StrictStart Continue and asked for a literal value
through a trusted fixture extension. The public StrictStart state returned `opening` with no
confirmed binding. Both tabs rendered the same root Interaction and an empty Conversation.

The driver held two actual DSH answer requests, one from each tab, with different synthetic
values. Both pages completed another normal Interaction poll while those requests were held.
They showed the same Interaction, creation time and original 30-minute deadline. The driver
then released both requests.

| Request | Observed result |
| --- | --- |
| `fixture-alpha` | HTTP 200 with `overloaded`, code `INTERACTION_ANSWER_LIMIT` |
| `fixture-beta` | HTTP 200 with `answered` |

The Native fixture recorded exactly one delivered value, `fixture-beta`. Both Opens resolved
to the same held Native identity, registration and worker generation. The seeded message
rendered once per tab and once again after a warm View refresh. The browser observed three
real DSH WebSockets and three Session follow streams. The test monitored page traffic on the
selected loopback origin. The two Native egress guards reported zero denials and dispatches.

Host shutdown observed settlement, withdrawn queues, two tail notifications and a closed Index
attempt. The original worker and Catalog both exited zero with stdout and stderr EOF, empty
stderr and no termination or force signal.

This run covers one concurrent answer pair through the current isolated Session component and
its Interaction Bridge. The observed losing result is `overloaded`. The product Broker's stale
reply behavior, real timeout and disconnect races, and retained-helper cleanup require further
verification. [Supervised Session #44](https://github.com/HowBoring/omp-webui/issues/44) · [Interactions #47](https://github.com/HowBoring/omp-webui/issues/47)

| Input or observation | Identity |
| --- | --- |
| Host source | `b96d529a7f19cd83d7b3522e885957e0a41ce7fe`, tree `de313267a4afb76d3e8c5b88f1aa36af1a3c9a6a` |
| DSH base and patched source tree | `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`, `d05468939bcb06446ace47045d138f716406c788` |
| DSH client bundle SHA-256 | `9c85868abb920643b1031981d1f5df14b503fd5623f22504a9cc705348182fcb` |
| Browser | Linux x64 Chromium `156.0.8078.79` |
| Source38 stage receipt SHA-256 | `7e22b591a5f63dbeece7631e96f596f89e02b324f41ebae0e3d99957c15f0830` |
| Public schema SHA-256 | `81a3ffc9ebcf5c929c39995cdc6350b56796782353f87a6a9c274153baffe958` |
| Fixture source manifest SHA-256 | `a5bd8216e73f849c75ebce74d39b3f661f76e79dd322fb6a0dbb5ea5412e2b6c` |
| Sanitized result SHA-256 | `46d05ac3f6523ee294766385898b4d5a89f40582608cd3f6cc6576a679176162` |
| Warm-view screenshot SHA-256 | `cb6096efb42d7023fe0c1090fd80fe1abcb4de344538d10831253fee474c66b7` |

Source and asset verification compared 350 Host paths against Git and checked the fixture manifest
before launch. Run `cfc27a` (session `35076`) exited zero. Driver artifacts are under
`/dev/shm/omp-source38-chromium47.j8zDv3xZ` and the result, screenshot and guard reports are under
`/dev/shm/omp-source38-chromium47-run.ezy79Ote`.

## Regression run on the integrated Bridge

After the retained Interaction Bridge changes landed, the same browser script and trusted fixture
extension ran against Host commit `0ffc83ccd62824f6d0c32f05eb148228a11fffa2`, tree
`6872446a757eb9291ba482e497d52489c726b0df`. Verification matched 360 tracked Host paths
and the scoped TypeScript check passed. The same DSH, Chromium and Source38 artifacts were used.

The direct Session path again reported one `answered` and one `overloaded` with
`INTERACTION_ANSWER_LIMIT`. Native received only the accepted value. The two tabs and warm View
shared one worker, and the Host recorded a closed registration after both original Native processes
reached stdout and stderr EOF and exited zero. Both egress guards reported zero denials and dispatches.

Run `ed4f81` (session `80017`) exited zero. The result SHA-256 was
`e3b861f640387aadd6acde9b4cf5f465426df4b94cb8584b75eceaff4290d581`. The proof driver and results
are under `/dev/shm/omp-source38-chromium47-current.oN4UYgn2` and
`/dev/shm/omp-source38-chromium47-run.upfQIx0O`, respectively.
