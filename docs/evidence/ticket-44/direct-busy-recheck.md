# Direct native worker shutdown recheck

The isolated Session component at Host commit `b96d529a7f19cd83d7b3522e885957e0a41ce7fe`
passed all six existing busy-worker tests in Bun 1.4.4 on Linux x64. The tests use synthetic
profiles, a literal local provider, a synthetic interruptible stream and a synthetic tool that
waits after its abort. The later forced exit targets the direct worker handle stored by the Host.
The guard recorded zero network dispatches.

| Revocation path | Cooperative outcome | Uncooperative outcome |
| --- | --- | --- |
| Directory revoke | Settled and exited 0 at 135 ms | Exited 137 at 35,048 ms after TERM and force |
| Revoke all browsers | Settled and exited 0 at 109 ms | Exited 137 at 35,086 ms after TERM and force |
| Host shutdown | Settled and exited 0 at 57 ms | Exited 137 at 35,043 ms after TERM and force |

All six observed both stdout and stderr EOF, one synthetic provider attempt and an abort.
Cooperative stops withdrew queued input and had eight tail notifications. Uncooperative stops
reported incomplete native settlement and queue withdrawal, with one tail notification. All three
recorded a TERM observation within the tested time window relative to revocation and a subsequent
forced exit. Each run reported 512 stderr bytes.

The first broad run used `TMPDIR` under `/dev/shm`, while the busy fixture requires a private HOME
under `/tmp/session-supervisor-*`. Its six startup refusals preceded the tested shutdown path.
The targeted rerun with `TMPDIR=/tmp` ran all six cases and passed 57 assertions, exit 0
(`ce4afe`, session `88314`). The full suite still has other failures, including storage and
fixture availability failures.

The candidate launcher SHA-256 is `21b202a801bef1f6267b2d782d9fcb344cb2907e7962630f27e73bdf22d96fcb`,
and its schema SHA-256 is `ed446d360feb896fb5575ca9db5e982c31fd3aebd0cd1c4233881250e7553a1f`.
The busy-provider fixture SHA-256 is `4232a878845c9c2935eb8f27705f94ae86a251792fdf75d7a3e521ec4cfeedc6`.
This direct-worker test uses the existing isolated candidate tuple. The Source38 retained-helper
path still requires validation of the shared deadline, independently observed domain completion,
and the selected global installation. [Supervised Session #44](https://github.com/HowBoring/omp-webui/issues/44)
