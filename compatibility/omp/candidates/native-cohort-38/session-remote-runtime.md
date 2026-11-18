# Source38 shared Session Remote and idle shutdown

On Linux x64 with Bun 1.4.4, two independently authenticated in-memory DSH Connection clients used the
Session Remote dispatcher with real BrowserAccess, DirectoryGrants, and the SQLite Session Index. A
readonly Catalog child discovered one synthetic Session in a fresh profile. Both clients explicitly
opened it with two requests in flight, then each attached a warm View. All 12 unary calls correlated
with their DSH replies.

The Index was empty during discovery and contained the registration before the worker launch. The two
Opens and warm Views shared one registration, worker ID, and generation. The supervisor launched one
direct Native worker. Public StrictStart state confirmed Continue on the same source, instance, and
native Session ID with held ownership and the authorized synthetic cwd. Public Session state confirmed
native settlement before shutdown.

The existing supervisor Host shutdown recorded native settlement, queued-input withdrawal, and UI
cancellation confirmation. It observed four validated notifications, of which two arrived after
shutdown began. The original worker handle resolved exit 0, both pipes reached EOF, and the Index
reported the same registration closed. Catalog and worker had empty stderr and no termination or force
signal. The runner and both children reported zero network denials and zero dispatches.

## Artifact identities

| Artifact | Identity |
| --- | --- |
| Host source | `263f8cfffd2db1437d877ab67c4f10984faac1f1` |
| Source38 native source tree | `b102d9db2b9b91e7baa1de484ca901705785993b` |
| Bun executable SHA-256 | `10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235` |
| Unregistered StrictStart runtime receipt SHA-256 | `7e22b591a5f63dbeece7631e96f596f89e02b324f41ebae0e3d99957c15f0830` |
| StrictStart CLI SHA-256 | `5658c2d6991e86b66761b68c97779189509345c2177bbe04631b8a4494ec37e8` |
| Catalog inventory SHA-256 | `7810144736c74ae8e19d7b1981400183be94e5f1eb6f7409c6678adc2b55cea2` |
| Driver SHA-256 | `a073adf36df8096b6882d7c47fee3f359db96f8e64bbce59b303879d14f48389` |
| Guarded invocation SHA-256 | `1d0ed045ae67650b653b49e8308178088e3255ed3baae61247806ea5f9407d95` |
| Serialized result SHA-256 | `f7408ba0b600cbcb808e2ce5e247056f3a2889a8e0574666642c5db6a1d8cff0` |
| Raw Catalog guard audit SHA-256, PID 777964 | `6401081e1a94e648d62e7d0a83e63514e768475294fce01292b3d8688325aef7` |
| Raw worker guard audit SHA-256, PID 777981 | `8428af32ebfba218ed3d6c0e18cc7c2a98985a5adb82f656b825503610804188` |

The driver passed strict TypeScript and guarded static input checks before run `369ac5`
(session `8654`) exited 0. The driver and invocation were staged under
`/dev/shm/omp-source38-session-remote44.Y3xpZC2M`. The serialized result and both guard audit files were
read back independently from `/dev/shm/omp-source38-session-remote44-run.V0vQSnq8`.

This is isolated in-memory carrier and direct-child idle evidence. Real Chromium, retained private helper
ownership, the single 30+5-second busy shutdown budget, and product admission require separate evidence.
[Session supervision #44](https://github.com/HowBoring/omp-webui/issues/44)
