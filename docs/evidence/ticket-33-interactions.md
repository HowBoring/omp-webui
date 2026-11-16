# Ticket 33 — public explicit interactions, isolated Linux acceptance

All five #33 acceptance criteria are implemented on the real candidate native
paths. This slice remains S0 isolated: no product private Session admission,
global OMP installation, real provider/model call or Windows acceptance is claimed.
Windows is explicitly deferred. Native source froze at
`13fd5508440af24e877ec9cbb607e983962b1bc2`; subsequent changes cover Host bounds,
shared carrier/build machinery, fixtures/evidence and current-integration DSH
source verification. The final branch includes
integration `2118454e02ac1e5db40847fec62f812308698309`, including the accepted
#39 catalog candidate build gate.

| Acceptance criterion | Implementation and actual evidence |
| --- | --- |
| 1. Public effective guarantee before dependent UI/timers | Import-free frozen native policy, mandatory safe-preflight report, ready policy before extension init, generated wire/validators and public RpcClient cache/methods. Fixture compares preflight source/patch/schema/runtime before ordinary spawn. Actual public-client test holds root UI unanswered while v2 negotiation and policy request acknowledge. |
| 2. Root and Session interactions through public DSH | Actual Chromium → public root Slot/contribution → Connection/typed Remote/Gateway → real rpc-ui extension. Startup requires no Session. Later identity comes from native public get_state. Strict-absence public session-maybe binding creates no fake Session controller. Default/configured browser runs pass 10/11 cases. |
| 3. Atomic answer/cancel/expiry/late settlement | Native shared dialog primitive validates before release and checks monotonic deadline before replies. Actual worker races valid answers after invalid input; public client rejects wrong tool/URI family correlation. Native ask expires; real HTML fallback and actual SDK builtin AskTool cancel partial forms with no defaults. |
| 4. Original wait target, no renewal/default submission | Host defaults to 1,800,000 ms; operator target and earlier native timeout use their minimum. Browser refresh and all-viewer disconnect preserve IDs/deadline. Configured 4-second Host expiry occurs while no viewer exists. Native cancellation/abort acknowledge; compound fallback retries/editors share one original deadline. |
| 5. Separate clocks/workers/races/exits | Controlled-clock child, real native helper timers, actual rpc-ui workers, public RpcClient, actual SDK/tool loop, syscall trace and Linux browser evidence are separate. Normal TUI regressions remain green. Actual exit/drain and blocked metadata attempts are retained independently. |

## Native behavior and boundaries

The authoritative additive wire lives in native `wire/interactions.ts`; generated
TypeScript/Python/Go/Rust artifacts and native/Host validators consume the same
source. Public commands are `get_interaction_policy` and acknowledged `respond_ui`.
The tagged answer union prevents confusing confirm/value/ask/cancel families.
Invalid business input stays pending; one valid answer/cancellation wins and later
answers return stale. Existing unacknowledged extension_ui_response stays compatible.
Existing negotiate_protocol is startup-fast, using the already-created encoder.
No raw/deferred negotiation extension was added to the shared process carrier.

The pure policy reaches the real rpc-ui UI context and builtin AskTool. Native
expiry cancels; it never chooses recommended options. HTML fallback keeps one
monotonic deadline across select/input/prefilled editor/validation retries; partial
values, late answers and timedOut form results cannot submit defaults. Cancel/expiry
abort the tool turn. Ordinary TUI contexts lack this RPC policy and retain their
prior behavior, including ordinary TUI form timeout semantics.

The actual SDK proof uses the public provider registration seam for an explicitly
labelled literal-message stream fixture, then public set_model after ordinary
OpenAI bootstrap. Prompt execution uses the actual AgentSession's builtin AskTool
and actual core ToolContextStore. It answers the first HTML field after 200 ms and
leaves a prefilled editor silent; the remaining native timeout is shorter than the
original 1 second, tool execution ends in error, expiry reason is observed and no
default answer appears. This is controlled provider-boundary evidence; it is not
evidence of real model inference. The separate extension/tool fixture exercises
public native AskTool with live worker UI and session/model context.

Controlled time replaces only clock/timer boundaries in its guarded child. It
checks exactly 30 minutes, invalid answers without renewal, reply after deadline
before timer callback, timeout/cancel/abort/duplicates, confirm false, immutable
question snapshots, compound fallback remaining budget, timedOut form result and
output-failure cleanup. Its manual UI policy flag is limited to component tests;
the actual worker/SDK tests establish source policy propagation.

The Host imports only the public pure frame decoder from OMP. Its bundle gate
rejects SDK/session/public-client import closures. Native public RpcClient runs
only inside synthetic guarded children. The browser receives neither raw RPC nor
executable/argv/extension-path controls. All product Session API paths return 501.
The normal carrier reuses the reviewed bounded stdio core/write queue, validates
known drain notifications, fences retired generations and observes actual exits.

## Isolation and network evidence

Every native child receives allowlisted environment, synthetic HOME/profile/XDG/
TMPDIR and cwd, `--no-env-file`, `--offline`, disabled implicit/bundled providers,
and a BEFORE-import preload guard. Actual initial state is verified OpenAI/gpt-4o;
this avoids Anthropic's credentialless HEAD prewarm branch. No real inference is
requested. The guard denies audited fetch/preconnect, WebSocket, Bun.connect,
Node TCP/TLS/HTTP/HTTP2 and datagram entrypoints. Only Unix sockets contained by the
synthetic HOME are permitted. Fifteen injected boundary calls throw before dispatch.

Native public-client and actual SDK-loop observers each assert **3 blocked metadata
fetch attempts**. These are attempts, not requests sent. The final independent
strace recorded **2001 lines, 20 execves, 63 AF_UNIX socketpairs, zero INET syscalls
and zero INET dispatch syscalls**. Browser loopback traffic is tested separately.
Normal worker stderr is bounded and never returned through the browser.

The first unguarded native attempt was rejected by automatic approval review over
provider/network risk. It was not bypassed. Source audit, before-import guards,
verified OpenAI selection and safe boundary tests established the changed scope;
the coordinator confirmed existing authorization for local stdio/loopback tests.
No real provider contact was authorized or performed. An earlier trace run was
invalidated by an owned-source reset while it was running (generated validators
temporarily absent); the final trace was rerun sequentially after clean rebuild.
The initial scripted-provider fixture also failed before ready because CLI resolves
models before extension registration; public set_model after bootstrap fixed that
fixture ordering without changing the native source contract.

## Build tuple and commands

OMP base: `7c49c11aa5bbaf3f418406583096168ad5b8c6dc`.
Clean ordered 0001 → reviewed 0002 → 0003 application reproduced:

- Native source SHA-256: `9387aee5beda5f2843e0558eed9a9ce1ebfe1251ff4286da2e2dc7d7cad7d6ae`
- Cumulative patch SHA-256: `b69f38c5fd03046fb3dad417a84297a8f8292bbb1546bcd5be334c31219cf858`
- Schema SHA-256: `67cd13dea944971fd5c6885674d507fd6c3c25f385376207a0a9c4250c03b753`

Final browser builds consume the reviewed canonical DSH candidate from the
read-only shared `/workspace/work/omp-webui-ticket-39-final-fix/vendor/dsh-final`,
base `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`, authored tree
`c0b09e15c170a82894608c397a363a7a96e5d05c`. The canonical declared-patch source gate
passes. Earlier baseline DSH runs were replaced by current-candidate browser
records. Exactly one React/ReactDOM 18.3.1 realm serves both DSH and the app.
All native source/build outputs and dependencies are owned ignored files; shared
DSH source/dependencies were reused read-only and no global installation changed.

Commands use Bun 1.4.4 at
`/workspace/work/rpc-public-module-probe/tooling/bun/package/bin/bun`; native
compiler/build commands ran with `env -i`, explicit PATH and synthetic HOME,
PI_CODING_AGENT_DIR, TMPDIR and XDG_CONFIG_HOME/XDG_CACHE_HOME before imports.

```sh
bun run compat:prepare --reset
bun run compat:build
bun scripts/build-compatibility.ts --check
bun scripts/check-interactions-native.ts
bun run interactions:build
bun run diagnostics:build
bun run diagnostics:enroll
bun run check
BUN_EXECUTABLE=/absolute/path/to/bun python3 scripts/trace-interactions.py
python3 tests/browser/interactions-browser.py --bun /absolute/path/to/bun
python3 tests/browser/interactions-browser.py --bun /absolute/path/to/bun \
  --port 3184 --wait-ms 4000 --evidence vendor/interactions-browser-configured-final
python3 scripts/retain-interactions-evidence.py
```

The full required check at merged integration e65f0a8 passed **117 tests / 941
assertions**, strict root TypeScript and Host build. Selected affected upstream
native/TUI contracts passed **31 tests / 85 assertions**, with 9 unrelated native
integration cases explicitly filtered out. Native interaction policy/settlement/
wire modules and public RpcClient pass their real upstream strict TypeScript
configuration; unrelated upstream diagnostics are excluded, not reported green.
After current integration 9d5e5eb, source-gate fault checks passed **3 tests / 5
assertions** on an owned source-only DSH clone. Root strict TypeScript,
diagnostic/interaction builds and current-candidate Linux browser runs cover the
changed DSH inputs; unchanged native stress cases were not repeated.

Retained [tuple and sanitized browser/native summaries](../../apps/interactions/evidence/README.md)
bind Bun executable, source/patch/schema, Host bundle/input set, DSH source/lock/
client assets and fixture/guard hashes. Both Chromium 156.0.8078.79 runs have no
browser errors and Host/native exit 0, no forced kill, complete stdout drain and
acknowledged native abort commands. Raw Playwright traces/screenshots/logs remain
ignored outputs whose hashes are retained. Broker #47, complete durable delivery,
product Session authority/admission and Windows remain outside this slice.


## Independent review fixes

The unbounded Host answer tail was removed. Retained capacity is one answer per
interaction and eight per worker, checked before retaining the payload or creating
continuations. Excess attempts receive the typed Host-only
`INTERACTION_ANSWER_LIMIT` result; the native acknowledgement schema and patch
0003/source freeze are unchanged. Cancellation has sixteen reserved worker slots,
duplicates share one request, and one coalesced abort runs independently of answer
acknowledgements. Native `invalid` keeps the original request and deadline; delayed
`answered`, `cancelled`, `expired` and `stale` results remain native facts.

The public controlled-port regression holds the head acknowledgement and floods
512 answers, verifies immediate overload and exactly one admitted attempt, then
observes invalid/retry, delayed native success, late staleness, cancellation bypass,
512 duplicate cancels, per-worker bounds, expiry progress and disposal. A separate
controlled monotonic-clock case reaches the deadline before its timer callback;
it sends native cancellation/abort and returns a real `stale` acknowledgement,
proving elapsed time alone cannot fabricate an `expired` result. Public DSH Remote
validation accepts the Host overload union while the native result schema rejects
it. Original red logs remain under
[review-fix](../../apps/interactions/evidence/review-fix/bridge-red.json), alongside
[the deadline red](../../apps/interactions/evidence/review-fix/deadline-red.json).

Shared build identity collection now covers diagnostics, interactions and catalog.
Each retains its actual-resolved-source candidate verification. The #39 catalog
child-workspace harness copies the shared collector and still exercises a real
successful candidate build, as well as baseline/partial/wrong-ancestry/unrecorded
source rejection. The shared bounded DSH events carrier owns peer/stream admission,
origin mechanics, cancellation, backpressure and disposal; slice routes, validators
and authorization remain explicit. There is no general browser-to-native RPC path.

The new default/configured Linux browser runs use the rebuilt Host and canonical
DSH candidate, retain 10/11 passing cases, and observe native/Host exit 0 without
forced termination or unread stdout. The existing native-only syscall trace is
explicitly reused, after checking unchanged native source identity and guard,
extension, public-client and core-loop fixture hashes; it is not a new trace run.
Native source mutation checks run only on owned OMP/DSH source clones. Shared
candidate builds, runtime dependencies and DSH source remain read-only.

Review validation commands and exact results are retained in
[review validation](../../apps/interactions/evidence/review-fix/validation.json).
Setup failures are retained there: missing PATH/.bin tooling, missing React type
links, and the React realm guard rejecting the initial incorrect React 19
dependency link. A test-only widened TypeScript literal also failed the final
check and was corrected with a const literal; its diagnostic is retained. The links were corrected to the pinned React 18.3.1
realm before final builds and browser runs. No failed attempt is counted as PASS.

Final review-fix integration validation on the merged 2118454 combination passed
**128 tests / 1,001 assertions across 29 files in 132.74 seconds**, root strict
TypeScript and Host build. The preliminary pre-deadline/Remote run passed
126 tests / 1,041 assertions; the final run includes both additional cases.
Each count is the observed output of its own run; all 128 final cases passed. The affected public source gates passed 5 tests / 7
assertions; the actual catalog build gate passed 2 tests / 32 assertions.
No native patch, generated wire contract or retained native syscall trace changed.
