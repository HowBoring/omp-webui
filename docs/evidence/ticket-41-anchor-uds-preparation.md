# #41 stable-anchor public UDS fixture: READY, NOT RUN

The exact optional review cleanup was fast-forwarded into the lead at
`18ba9e49c2fbf8f09fc0932a8d0c6ed1efc664c4`, tree `d67010f80863beaee24e5d8a345e146a94625527`.
Beyond `813e6b05a691b16fe7f41f3e7d96f06e9a5d0539`, only the tracer preparation script changed:
`anchorPin` names the stable anchor and local `writeAndPin` shares exclusive protected-file creation.
Integration `4024c4084173c102764e0c1e42efa183ba8810d4` is already an ancestor.
Focused strict types, TypeScript parsing and diff checks pass. No new tests were added for this review cleanup.

The new synthetic fixture is `/tmp/ownership-server-tracer-QTCN2K/fixture.json`, SHA256
`f29d3092cc5316ecdea6c858c35c57405718fffc9035b80b5b81ab7667352dff`.
Its protected stable anchor and domain-separated signed approval are outside the synthetic release.
Approval and dispatcher reply keys are distinct synthetic keys; no production key or installation was accessed.
The endpoint is `/tmp/ownership-server-tracer-QTCN2K/home/state/socket`, inside the marked synthetic HOME.
The helper/validator/control-I/O paths deliberately authorize no actual executable.

The reviewed preparation script ran only file/crypto preparation under `env -i` and the existing provider-denial
preload, before preparation imports. Independent pure crypto checked the envelope signature, installation and
key roles without Native imports; 22 selected TypeScript sources parsed successfully. The retainer was AST parsed
only and has never run for this fixture. The existing strict-compiled bridge is byte-identical and was reused:
source `e6e71c13cd5144c9bac2636fad16ef9a9449c9229a7184d4480c163f5e8e1b49`, artifact
`127353f7ccb35605e56f9fbbaf6d28fab3050404bccadef0699f7091a9e428e3`. No new C compile/load/execution,
socket, Native/CLI, browser, process probe, signal or global installation occurred.

`/tmp/ownership-server-tracer-QTCN2K/frozen-inputs.json`, SHA256
`64bc5496399b81190aac95d0e844087bd49c9b594c03143aff4b702e323f2625`, freezes 40 selected
source/tool/artifact/fixture/key files with exact integer device/inode, ownership/mode/link count, size,
mtime/ctime and SHA256; four launch paths and twelve directory identities are also recorded.
Only hashes and metadata of the private-key file are recorded. This is an explicit fixture inventory,
not a production release closure or mapped-runtime inventory.

The exact one-attempt plan is `/tmp/ownership-server-tracer-QTCN2K/run-plan.json`, SHA256
`2bd60b1746e06622a91bece5ae54a64fbc677fd6a68bba3888ac6abd07b81ec0`.
Owned ignored copies are under `vendor/anchor-uds-preparation/{ready,run-plan,revalidation}.json`.
Root must revalidate the frozen manifest immediately before launch and retain the original tool handle.
No actual execution is authorized by this preparation; a separate Root GO is required.

The prospective command, under the plan's network-enabled sandbox, is:

```text
/usr/bin/env -i PATH=/usr/bin:/bin TMPDIR=/tmp
  /opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3 -I -S
  /workspace/work/omp-webui-ticket-41/scripts/retain-ownership-server-tracer.py
  /tmp/ownership-server-tracer-QTCN2K/fixture.json
  f29d3092cc5316ecdea6c858c35c57405718fffc9035b80b5b81ab7667352dff
```

Before its single `posix_spawn`, the retainer must set and verify actual subreaper status and receive initial
`P_ALL/ECHILD`. It retains the exact strace child pidfd and checks `P_PIDFD` waitability with `WNOWAIT`.
It alone reaps with `P_ALL/__WALL` until authoritative `ECHILD`. The guarded Bun test has a 10-second test budget;
the public client uses 1-second connect and 10-second request budgets. The server idle budget is 30 seconds.
The parent's 30-second unresolved marker is diagnostic only. No automatic retry, process scan, signals,
cancellation or cleanup is allowed; unresolved failure retains the parent and original tool handle.

The one actual case would verify stable-anchor/signed-approval loading, public Bun UDS connection to an independent
server, actual C kernel-peer capture, signed classify/reclassify with stable registration, empty scope listing,
and missing-generation inspection refusal without creation. Distinguish the bridge socketpair ABI self-probe
from actual accept/SO_PEERPIDFD evidence. Close the client, send server stdin EOF, await real exit0/no signal,
then require the retainer's actual `P_ALL/ECHILD`. Recheck all frozen inputs and pins, absent own socket and empty
fences; save raw stdout/stderr/trace/containment hashes and actual top-level tool completion. Do not infer missing
guard counters, process exits or extinction from time or presence checks.

All 4,398 ignored Native file identities/bytes, Native status and real index SHA256
`bd7f72091e2a8ada55857c52c03d16f8ca55c8e16758ae1317e7cd500adb867c` remained unchanged.
The before inventory is `vendor/anchor-uds-preparation/native-authoring.before.json`, SHA256
`014bf91134e0b193a3501bd6dfaf32e5f45643d1cab29818e1454c0167aaca60`.
No export, reset or patch reapplication occurred. Inactive 0010 remains patch `a9aa3f47`, prepared source
`59cb6078`, schema `7233cf78`, stable patches 1–6 plus 0010 only; no full 1–10 composition is claimed.

All 66 inventoried files in the historical failed/green UDS and launcher-lock roots remain unchanged.
The earlier `286d17d` actual public UDS pass used the previous plain-record tuple; it does not establish runtime
evidence for this anchor/envelope path. The actual launcher-lock pass and copied-Bun reclamation remain separate,
preserved evidence. Old fixtures must not be rerun. The new fixture has no execution logs and remains NOT RUN.
Global/final-closure, Native/worker-realm, private helper, broker/protector/service lifetime, publication and
current-data/TUI gates remain BLOCKED.

Full sanitized identities, validation and exact argv/environment are in
[`ticket-41-anchor-uds-preparation.json`](ticket-41-anchor-uds-preparation.json).
