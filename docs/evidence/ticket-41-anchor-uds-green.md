# #41 signed-anchor public UDS: PASS, drained, used once

The single authorized `/tmp/ownership-server-tracer-bFpAny` attempt passed: **1 test, 10 assertions,
0 failures**, 1208 ms total (1125.84 ms case). Client `506586` awaited independent server `506596` exit 0,
no signal, after closing the client and sending server stdin EOF. Retainer `506580` recorded its exact
strace child `506583` as `CLD_EXITED/0`, then actual `P_ALL/ECHILD`: reaped count 1, signals 0,
`observerFailed: false`, `interrupted: false`. This fixture is **USED_ONCE_PASS_DRAINED; do not rerun**.

The original Root tool call `fcbdf4`, session `21488`, and original poll `96a62c` returned actual exit 0.
Their metadata and actual network permission arguments are preserved in a clearly **Root-transcribed** record,
not an independently retrieved tool archive. Saved `driver.log` and `containment.json` separately contain the
actual kernel wait result. Later read-only checks found exactly those four known PIDs absent; that observation
is separate from the saved waits.

The public loader accepted the protected stable outside anchor and separately signed, domain-separated approval.
Existing `BunOwnershipTransport` verified signed nonce, exact request hash/ID/operation, identity and stable server
generation. The completed fixture path performs eight exchanges: classify, classify, classify, list_scopes,
inspect_broker, classify, classify, list_scopes. This count is **source-backed by the completed test path**, not a
per-request wire log. The inspect assertion follows an awaited authenticated transport exchange and public decode
against the exact request. It observed `ok: false, error: dispatcher_unavailable`; EOF/connect/timeout cannot satisfy
that assertion. Post-refusal classify matched the original registration and scopes remained empty on the same
transport. Empty scope lists are a public observation, not a broker lifetime or publication proof. The separate
dropped-peer regression remained excluded and **NOT RUN**.

The narrow socket trace shows server `506596` accepting fd 8 from client `506586`, then actual `SO_PEERCRED`
(client PID/UID/GID) and `SO_PEERPIDFD` returning fd 9. Earlier fd 5 credentials name server `506596` itself and
return pidfd 7: those belong to its source-backed socketpair ABI probe. They are **separate evidence** from the
accepted client. The trace selector omits `socketpair` itself. It records no AF_INET/AF_INET6, but supplies no
exhaustive syscall, mapped-runtime, provider-dispatch, pidfd-close or packet inventory. Guard counters remain
**UNKNOWN_NOT_EMITTED_OR_PROBED**, never inferred as zero.

Read-only postflight verified all 41 frozen file metadata/hashes, including exact integer inode/device, size,
UID/GID, mode/link count and mtime/ctime; all four launch paths, twelve directory identities and operator pins
matched. Fixture SHA256 `bf1e67ad206f3f3586849bc2604f484f105131953e3b833bdc9bf3a45dd16ad8`, frozen manifest SHA256
`a0d77427f4939f56154534386e58aada7763537c45bc73d3c32c2f561ee2e898` and run-plan SHA256
`a35f6d99adfcbd8ae15648753bd61fd9724b189cc081d14ca3ce423fd5556429` are unchanged. The exact endpoint is absent,
fences are empty, and helper/control-I/O/validator placeholders authorize no executable. Private synthetic signing
key contents were never printed; only metadata and hashes enter the proof.

All 4,398 inventoried Native authoring files, original index, status and HEAD remain unchanged. No stage delta,
export, reapplication or full patches 1–10 composition occurred. All 66 historical UDS/launcher-lock evidence files
and the prior copied-Bun reclamation are preserved. `QTCN2K` remains **SUPERSEDED_NOT_RUN**: its nine inventoried
fixture-root members and frozen/plan bytes are unchanged and no execution logs exist. Original fixture, frozen
manifest, plan and preparation readiness records retain their preparation-time fields. Separate ignored
`vendor/anchor-uds-preparation/usage.json` records consumption.

The finisher performed only file/hash/metadata checks, exact known-PID presence checks, and evidence writing. It
performed no new fixture imports, C/FFI/UDS, tests, Native/CLI, process probes, signals, cleanup or global installation.
This proves synthetic anchor/approval authentication, public wire behavior, actual accepted C peer capture and owned
drainage. Actual Native Agent/worker realms, helper REGISTER/START/extinction, approved control-I/O integration,
broker publication, external protector/service lifetime, final global closure, all-process publication locks and
current-data/TUI/private admission remain **BLOCKED**. Integration `4024c408` was not mutated.

[Structured proof](ticket-41-anchor-uds-green.json) includes sanitized postflight identities, raw log/trace/containment
hashes, actual wait records, Root-provided tool metadata, selected argv/environment and explicit limits.
[Preparation](ticket-41-anchor-uds-preparation.md) and [superseded preparation](ticket-41-anchor-uds-superseded.json)
remain historical snapshots. Next work is the existing approved control-I/O/private-helper and external-protector
source integration described in the outside lead resume; this result authorizes no additional runtime attempt.
