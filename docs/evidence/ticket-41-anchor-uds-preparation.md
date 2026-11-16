# #41 stable-anchor public UDS fixture: READY, NOT RUN

Source fix `a17e1dd14a9086180a0cd1fddbe1d414085335cc`, tree
`80d4fdf58fa6ff41af1c8a37eb85852f66f0194c`, adds an owned fixture and changes the preparation entry
without editing the ignored Native source. Current integration `4024c4084173c102764e0c1e42efa183ba8810d4`
was merged before the source commit: already up to date. Focused strict types and parsing of 20 TypeScript
sources pass; the unchanged retainer was AST parsed only. No runtime red/green result is claimed.

The reviewed flaw was that `OwnershipClient.inspectBroker` reports `dispatcher_unavailable` for both a signed
negative response and EOF/connect/timeout. A same-client follow-up cannot distinguish them: this client closes
after every error, including a signed refusal. The owned fixture now shares the existing public
`BunOwnershipTransport` with `OwnershipClient`. After public classify/reclassify and empty scopes, it constructs
the exact inspect request, **awaits `transport.exchange`**, then passes the resolved authenticated frame and
that exact request to public `decodeOwnershipResponse`. Only then does it assert the negative response body.
The transport verifies approval, signature, nonce, exact request hash/ID/operation, identity and stable server
generation before resolving. Transport rejection is never caught as a valid negative body. Subsequent public
classify must equal the original registration and public scope listing must remain empty on the same transport.
No product API, error semantics or test-only provenance hook changed. The no-create observation is the empty
scope listing before and after inspection; it is not broker lifetime or publication acceptance.

The separate opt-in `compatibility/omp/fixtures/ownership-transport-drop.test.ts` describes a real public Bun
UDS peer that signs classify/list replies and sends EOF on the next request. It requires the authenticated
exchange/decode chain to reject. It is source/type checked, **NOT RUN**, and is not imported by the one-attempt
tracer entry. Its separate environment selector is absent from that plan. Do not run it against a used fixture.

The new marked synthetic fixture is `/tmp/ownership-server-tracer-bFpAny/fixture.json`, SHA256
`bf1e67ad206f3f3586849bc2604f484f105131953e3b833bdc9bf3a45dd16ad8`.
The protected stable anchor and domain-separated signed approval are outside the synthetic release. Approval
and dispatcher reply keys are distinct synthetic keys; pure Ed25519 verification passed without Native imports
or reading private-key contents. The endpoint is inside its synthetic HOME at `home/state/socket`.
Helper/validator/control-I/O paths authorize no actual executable. Preparation used file/crypto operations
under `env -i` with the existing provider-denial preload before imports. No production keys were accessed.

Its `frozen-inputs.json`, SHA256
`a0d77427f4939f56154534386e58aada7763537c45bc73d3c32c2f561ee2e898`, freezes 41 selected
files, including 35 declared inputs, with exact integer device/inode, ownership/mode/link count, size,
mtime/ctime and SHA256. Four launch paths and twelve directories are recorded and verified. Private signing-key
files contribute only metadata and hashes to this sanitized inventory. This is not a production release closure
or mapped-runtime inventory.

The exact `run-plan.json` SHA256 is
`a35f6d99adfcbd8ae15648753bd61fd9724b189cc081d14ca3ce423fd5556429`.
Owned ignored copies remain `vendor/anchor-uds-preparation/{ready,run-plan,revalidation}.json`.
Immediately before launch Root must revalidate every frozen file metadata/hash, launch-path identity and directory,
then retain the original tool handle. This preparation authorizes no runtime execution; separate Root GO is required.
The prospective command, under the plan's network-enabled sandbox, is:

```text
/usr/bin/env -i PATH=/usr/bin:/bin TMPDIR=/tmp
  /opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3 -I -S
  /workspace/work/omp-webui-ticket-41/scripts/retain-ownership-server-tracer.py
  /tmp/ownership-server-tracer-bFpAny/fixture.json
  bf1e67ad206f3f3586849bc2604f484f105131953e3b833bdc9bf3a45dd16ad8
```

One attempt admits one traced Bun test and its independent server, with eight expected authenticated exchanges.
Before its sole spawn the unchanged retainer verifies actual subreaper status and initial `P_ALL/ECHILD`, retains
its exact child pidfd and verifies `P_PIDFD/WNOWAIT` waitability. It alone drains `P_ALL/__WALL` to actual `ECHILD`.
The test has a 10-second budget, the client has 1-second connect/10-second request budgets, and server idle is
30 seconds. Readiness and final child/stderr awaits have no independent cancellation. The 30-second parent marker
and test timeout prove no extinction; unresolved outcomes retain the parent and original handle. No retry, process
scan, automatic signal, cancellation or cleanup is allowed.

Runtime success would additionally require actual C kernel-peer capture (separate from its socketpair ABI probe),
signed inspect refusal and postchecks, client close, server stdin EOF, awaited real exit0/no signal, and retainer
`P_ALL/ECHILD`. Recheck frozen inputs, operator pins, absent own socket and empty fences; save raw output, narrow
socket trace, containment hashes and actual top-level completion. Guard counters were neither emitted nor probed
and remain **UNKNOWN**. A preload and narrow trace do not establish a finite 16-deny/0-dispatch probe result.

Existing bridge source `e6e71c13cd5144c9bac2636fad16ef9a9449c9229a7184d4480c163f5e8e1b49` and artifact
`127353f7ccb35605e56f9fbbaf6d28fab3050404bccadef0699f7091a9e428e3` remain unchanged and were only read/copied.
All 4,398 Native file identities/bytes and the real index/status are unchanged. Inactive 0010 remains patch
`a9aa3f47`, prepared source `59cb6078`, schema `7233cf78`, stable patches 1–6 plus 0010 only; no export,
reapplication or full 1–10 composition occurred. Retainer bytes and retention policy are unchanged.

Old fixture `QTCN2K` is **SUPERSEDED_NOT_RUN**, never executed. Its frozen manifest and run-plan bytes and all nine
fixture-root file identities/metadata/hashes, including synthetic key metadata, are preserved. Its original sanitized
preparation is archived in [`ticket-41-anchor-uds-superseded.json`](ticket-41-anchor-uds-superseded.json).
Its selected preparation source changed intentionally for the new fixture; never rerun its stale plan.
All 66 inventoried historical UDS/launcher-lock files are unchanged. Historical plain-record UDS and launcher-lock
proofs remain separate; they grant no anchor/envelope runtime proof. No new C compile/load/execution, FFI, UDS,
retainer, Native/CLI, process probe, signal, browser or global installation occurred. Global/final-closure,
Native/worker-realm, helper, broker/protector/service lifetime, publication and current-data/TUI gates remain BLOCKED.

Full sanitized identities, exact argv/environment and finite plan are in
[`ticket-41-anchor-uds-preparation.json`](ticket-41-anchor-uds-preparation.json).
