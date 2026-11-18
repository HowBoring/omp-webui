# Source38 Session component in Linux Chromium

Chromium 156.0.8078.79 ran the pinned DSH Session bundle against the isolated Bun Session
component on an ephemeral loopback origin. A separate Source38 Catalog and a real StrictStart
RPC v2 worker used a fresh synthetic profile with one seeded message.

- An anonymous page received 401. The synthetic bootstrap URL passed through the browser driver's
  stdin. The authorized browser confirmed a directory grant through the UI.
- Two browser tabs sent Open requests together. The Host observed one registration before launch,
  one worker start, and the same registration, worker generation and Native identity in both responses.
  The worker's public StrictStart state confirmed Continue, held ownership and the actual cwd.
- Both tabs rendered the seeded History message once in DSH Conversation. Refresh sent one View
  request, retained the same worker and rendered the same message once again. The run observed
  three real DSH WebSockets and three `session/follow` streams.
- Host shutdown observed native settlement, withdrawn queues, two tail notifications, exit 0 and
  both pipe EOFs. The persisted Host registration recorded a closed attempt. Catalog also reached
  exit 0 and both EOFs. Both Native guards recorded zero dispatches and denials. Browser page traffic
  stayed on the selected loopback origin.

The first launch of this fixture hit Chromium's Unix singleton socket length limit. An independent
`about:blank` smoke reproduced it with the long temporary directory and passed with a short path.
The paired run used a private `/dev/shm/c44.*` profile, removed after the browser exited.

The test covers an authenticated, read-only synthetic Session through the established DSH
Connection and Remote path. Busy-worker cleanup through the retained helper, startup Interaction,
global OMP admission and the support matrix require their corresponding runs. Browser monitoring
covered page traffic and used a dead loopback proxy for other destinations. [Supervised Session #44](https://github.com/HowBoring/omp-webui/issues/44)

## Artifact identities

| Input or observation | Identity |
| --- | --- |
| Host source | `b96d529a7f19cd83d7b3522e885957e0a41ce7fe`, tree `de313267a4afb76d3e8c5b88f1aa36af1a3c9a6a` |
| DSH base | `38a6a5c965aa99ab525161efb7cc5cf1fe62fced` |
| Patched DSH source tree | `d05468939bcb06446ace47045d138f716406c788` |
| DSH asset manifest SHA-256 | `db600bd7051aed523ec1378a06cf9e35d46dd619db4f25cd1c24ae44336fab5d` |
| DSH client bundle SHA-256 | `9c85868abb920643b1031981d1f5df14b503fd5623f22504a9cc705348182fcb` |
| Chromium ELF SHA-256 | `ce1ff960ce428a4a88b1b1c38516bdf1954a57fc24036161b7a0d8d0f8aec511` |
| StrictStart runtime receipt SHA-256 | `7e22b591a5f63dbeece7631e96f596f89e02b324f41ebae0e3d99957c15f0830` |
| Public schema SHA-256 | `81a3ffc9ebcf5c929c39995cdc6350b56796782353f87a6a9c274153baffe958` |
| Host proof driver SHA-256 | `3302d6970a3f0a5adf11221deeba8a8dae77addc68670985ec612b48bb142857` |
| Playwright driver SHA-256 | `6908d060b741bf0ddcee87bb515aa0375e1b810ee13eea4c7ea0a3ced44dfded` |
| Sanitized result SHA-256 | `c7e925e7a5ad87a7c488481c48028d3e1b53f89a3008cae7f20784c5a7ce32e9` |
| Warm-view screenshot SHA-256 | `be496675cf87c310fbf78f4b2209f4d972616a0cb8c09f78533a3e8dcc4943c3` |

Guarded verification compared 350 tracked Host paths with Git before startup. Run `1ffa37`
(session `52931`) exited zero. The result, browser observations, screenshot and guard reports
are under `/dev/shm/omp-source38-chromium44-run.7kMc7qVy`.
